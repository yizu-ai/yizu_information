import { mkdir } from 'node:fs/promises'
import path from 'node:path'

type BrowserContext = {
  close: () => Promise<void>
  newPage: () => Promise<BrowserPage>
}

type BrowserPage = {
  goto: (url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<unknown>
  title: () => Promise<string>
  url: () => string
  textContent: (selector: string) => Promise<string | null>
  waitForTimeout: (timeout: number) => Promise<void>
  getByText: (text: string, options?: { exact?: boolean }) => {
    click: (options?: { timeout?: number }) => Promise<void>
  }
  evaluate: (fn: () => unknown) => Promise<unknown>
  $$eval: <T>(selector: string, fn: (nodes: AnchorLike[]) => T) => Promise<T>
}

type AnchorLike = {
  textContent: string | null
  href: string
}

export type ExtractedLink = {
  title: string
  url: string
}

export async function extractLinksWithBrowser(input: {
  url: string
  profileDir: string
  limit: number
  visible?: boolean
  clickText?: string
  scrollRounds?: number
  waitForLoginText?: string
  waitForLoginTimeoutMs?: number
  waitForLoginUrlIncludes?: string[]
}): Promise<ExtractedLink[]> {
  const { context, page } = await openPage(input.url, input.profileDir, Boolean(input.visible))
  try {
    await waitForInteractiveLogin(page, input)

    if (input.clickText) {
      await page.getByText(input.clickText, { exact: true }).click({ timeout: 10_000 }).catch(() => undefined)
      await page.waitForTimeout(1500)
    }

    const links: ExtractedLink[] = []
    const rounds = input.scrollRounds ?? 0
    for (let round = 0; round <= rounds; round += 1) {
      links.push(...(await readPageLinks(page)))
      if (round < rounds) {
        await page.evaluate(() => {
          const browserWindow = globalThis as unknown as { scrollBy: (x: number, y: number) => void; innerHeight: number }
          browserWindow.scrollBy(0, Math.round(browserWindow.innerHeight * 0.8))
        })
        await page.waitForTimeout(1200)
      }
    }
    const seen = new Set<string>()
    return links
      .filter((link) => {
        if (seen.has(link.url)) {
          return false
        }
        seen.add(link.url)
        return true
      })
      .slice(0, input.limit)
  } finally {
    await context.close()
  }
}

async function waitForInteractiveLogin(
  page: BrowserPage,
  input: {
    visible?: boolean
    waitForLoginText?: string
    waitForLoginTimeoutMs?: number
    waitForLoginUrlIncludes?: string[]
  },
): Promise<void> {
  if (!input.visible || (!input.waitForLoginText && !input.waitForLoginUrlIncludes?.length)) {
    return
  }

  const startedAt = Date.now()
  const timeoutMs = input.waitForLoginTimeoutMs ?? 120_000
  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = (await page.textContent('body').catch(() => '')) ?? ''
    const isLoginTextVisible = Boolean(input.waitForLoginText && bodyText.includes(input.waitForLoginText))
    const isLoginUrl = Boolean(input.waitForLoginUrlIncludes?.some((urlPart) => page.url().includes(urlPart)))
    if (!isLoginTextVisible && !isLoginUrl) {
      await page.waitForTimeout(2000)
      return
    }
    await page.waitForTimeout(3000)
  }

  throw new Error('需要先在弹出的浏览器里完成扫码登录，登录后再重新点击开始采集。')
}

async function readPageLinks(page: BrowserPage): Promise<ExtractedLink[]> {
  return page.$$eval('a', (nodes) =>
    nodes
      .map((node) => ({
        title: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
        url: node.href,
      }))
      .filter((link) => link.title.length >= 6 && /^https?:\/\//.test(link.url)),
  )
}

export async function extractArticleWithBrowser(input: {
  url: string
  profileDir: string
  visible?: boolean
}): Promise<{ title: string; url: string; text: string }> {
  const { context, page } = await openPage(input.url, input.profileDir, Boolean(input.visible))
  try {
    const [title, bodyText] = await Promise.all([page.title(), page.textContent('body')])
    return {
      title: title.trim(),
      url: page.url(),
      text: (bodyText ?? '').replace(/\s+/g, ' ').trim(),
    }
  } finally {
    await context.close()
  }
}

export function formatBrowserError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const ansiColorPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
  const message = rawMessage.replace(ansiColorPattern, '')

  if (message.includes('user-data-dir') || message.includes('已有') || message.includes('Existing browser session')) {
    return '浏览器登录目录正在被另一个采集窗口占用。请关闭弹出的自动化浏览器窗口后重试。'
  }

  if (message.includes('antispider') || message.includes('验证码')) {
    return '搜索页触发验证码，需要在弹出的浏览器里手动完成验证后重试。'
  }

  return message.split('\n')[0]?.slice(0, 240) || '浏览器采集失败'
}

async function openPage(
  url: string,
  profileDir: string,
  visible: boolean,
): Promise<{ context: BrowserContext; page: BrowserPage }> {
  await mkdir(path.resolve(profileDir), { recursive: true })
  const playwright = (await dynamicImport('playwright').catch(() => null)) as
    | { chromium?: { launchPersistentContext: (profileDir: string, options: object) => Promise<BrowserContext> } }
    | null

  if (!playwright?.chromium) {
    throw new Error('缺少 Playwright 浏览器运行时，请先安装 playwright 并安装 Chromium。')
  }

  const context = await playwright.chromium.launchPersistentContext(path.resolve(profileDir), {
    headless: !visible,
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  return { context, page }
}

function dynamicImport(specifier: string): Promise<unknown> {
  const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>
  return importer(specifier)
}
