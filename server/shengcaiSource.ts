import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { load } from 'cheerio'
import { chromium, type Page } from 'playwright'

import { listCollectedSourceItemIds, readRawSourceSettings } from './storage'
import { summarizeSourceItems } from './sourceSummarizer'
import type { SourceCollector, SourceItem } from './types'

const maxItems = 10
const maxCandidates = 40

type ShengcaiTopic = {
  title: string
  authorName: string
  publishedAt?: string
  originalUrl: string
  rawText: string
  likes?: number
}

export const collectShengcaiSource: SourceCollector = async ({ date, dataDir, lastSuccessAt }) => {
  const settings = await readRawSourceSettings(dataDir)
  const steps = [
    '步骤 1：打开生财有术专用浏览器窗口。',
    '步骤 1.5：如果出现微信扫码登录页，会等待你扫码；登录完成后继续采集。',
    '步骤 2：进入生财首页，按“全部 + 精华 + 最新发布”读取官网接口返回的精华帖。',
    '步骤 3：只保留 scys.com/articleDetail/xq_topic/ 形式的帖子，过滤导航、飞书文档、榜单等非帖子链接。',
    '步骤 4：本次最多采集 10 篇，然后交给 DeepSeek 做摘要和精华总结。',
  ]
  const seenIds = await listCollectedSourceItemIds('shengcai', dataDir)
  const topics = await extractShengcaiEssenceTopics({
    url: settings.shengcai.entryUrl,
    profileDir: settings.shengcai.browserProfileDir,
  })
  const selectedTopics = topics
    .filter((topic) => !seenIds.has(stableItemId('shengcai', topic.originalUrl)))
    .slice(0, maxItems)

  const summaries = await summarizeSourceItems(
    selectedTopics.map((topic) => ({
      sourceName: '生财有术',
      itemId: stableItemId('shengcai', topic.originalUrl),
      title: topic.title,
      authorName: topic.authorName,
      publishedAt: topic.publishedAt,
      originalUrl: topic.originalUrl,
      rawText: topic.rawText,
    })),
    { sourceName: '生财有术', dataDir },
  )
  const summaryById = new Map(summaries.map((summary) => [summary.itemId, summary]))

  const items: SourceItem[] = selectedTopics.map((topic) => {
    const itemId = stableItemId('shengcai', topic.originalUrl)
    const summary = summaryById.get(itemId)
    return {
      sourceKey: 'shengcai',
      itemId,
      title: topic.title,
      authorName: topic.authorName,
      publishedAt: topic.publishedAt,
      originalUrl: topic.originalUrl,
      likes: topic.likes,
      contentSummary: summary?.contentSummary || topic.rawText.slice(0, 180),
      essenceSummary: summary?.essenceSummary || 'AI 总结暂不可用，建议打开原文查看。',
      summaryStatus: summary?.summaryStatus ?? 'success',
      summaryError: summary?.summaryError,
      collectedAt: new Date().toISOString(),
    }
  })

  return {
    sourceKey: 'shengcai',
    date,
    generatedAt: new Date().toISOString(),
    warnings: [
      ...steps,
      `本次从官网接口读取到 ${topics.length} 个候选精华帖，跳过已采集内容后选择 ${selectedTopics.length} 篇。`,
      lastSuccessAt ? `上次成功采集时间：${lastSuccessAt}` : '这是首次采集或尚无成功采集记录。',
    ],
    items,
  }
}

async function extractShengcaiEssenceTopics(input: { url: string; profileDir: string }): Promise<ShengcaiTopic[]> {
  await mkdir(path.resolve(input.profileDir), { recursive: true })
  const context = await chromium.launchPersistentContext(path.resolve(input.profileDir), {
    headless: false,
    viewport: { width: 1280, height: 900 },
  })
  const page = await context.newPage()
  const topicMap = new Map<string, ShengcaiTopic>()

  page.on('response', async (response) => {
    if (!response.url().includes('/shengcai-web/client/homePage/searchTopic')) {
      return
    }

    try {
      const payload = (await response.json()) as ShengcaiSearchResponse
      for (const topic of normalizeShengcaiSearchResponse(payload)) {
        if (!topicMap.has(topic.originalUrl)) {
          topicMap.set(topic.originalUrl, topic)
        }
      }
    } catch {
      // Ignore malformed or non-JSON responses from unrelated browser activity.
    }
  })

  try {
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await waitForWechatLogin(page)
    await page.getByText('精华', { exact: true }).click({ timeout: 10_000 }).catch(() => undefined)
    await page.waitForTimeout(3000)

    for (let index = 0; index < 3 && topicMap.size < maxCandidates; index += 1) {
      await page.evaluate(() => {
        const browserWindow = globalThis as unknown as { scrollBy: (x: number, y: number) => void; innerHeight: number }
        browserWindow.scrollBy(0, Math.round(browserWindow.innerHeight * 0.85))
      })
      await page.waitForTimeout(1200)
    }

    return Array.from(topicMap.values()).slice(0, maxCandidates)
  } finally {
    await context.close()
  }
}

async function waitForWechatLogin(page: Page): Promise<void> {
  const startedAt = Date.now()
  const timeoutMs = 120_000

  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = (await page.textContent('body').catch(() => '')) ?? ''
    const isWechatLogin = page.url().includes('open.weixin.qq.com') || bodyText.includes('使用微信扫一扫登录')
    if (!isWechatLogin) {
      return
    }
    await page.waitForTimeout(3000)
  }

  throw new Error('需要先在弹出的浏览器里完成生财有术微信扫码登录，登录后再重新点击开始采集。')
}

type ShengcaiSearchResponse = {
  data?: {
    items?: Array<{
      topicDTO?: {
        entityType?: string
        entityId?: string
        topicId?: string
        showTitle?: string
        articleContent?: string
        aiSummaryContent?: string
        gmtCreate?: number
        likeCount?: number
      }
      topicUserDTO?: {
        name?: string
      }
    }>
  }
}

function normalizeShengcaiSearchResponse(payload: ShengcaiSearchResponse): ShengcaiTopic[] {
  return (payload.data?.items ?? [])
    .map((item): ShengcaiTopic | null => {
      const topic = item.topicDTO
      if (!topic || topic.entityType !== 'xq_topic' || !topic.entityId || !topic.showTitle) {
        return null
      }

      const articleText = htmlToText(topic.articleContent ?? '')
      const aiSummaryText = htmlToText(topic.aiSummaryContent ?? '')
      const normalizedTopic: ShengcaiTopic = {
        title: topic.showTitle.trim(),
        authorName: item.topicUserDTO?.name?.trim() || '生财有术',
        publishedAt: topic.gmtCreate ? new Date(topic.gmtCreate * 1000).toISOString() : undefined,
        originalUrl: `https://scys.com/articleDetail/xq_topic/${topic.entityId}`,
        rawText: [topic.showTitle, articleText, aiSummaryText].filter(Boolean).join('\n\n'),
        likes: topic.likeCount,
      }
      return normalizedTopic
    })
    .filter((topic): topic is ShengcaiTopic => Boolean(topic))
}

function htmlToText(html: string): string {
  return load(html).text().replace(/\s+/g, ' ').trim()
}

export function selectUnseenEssenceLinks(
  links: Array<{ title: string; url: string }>,
  seenIds: Set<string>,
  limit: number,
): Array<{ title: string; url: string }> {
  return links.filter((link) => !seenIds.has(stableItemId('shengcai', link.url))).slice(0, limit)
}

export function stableItemId(source: string, value: string): string {
  return `${source}:${createHash('sha256').update(value).digest('base64url').slice(0, 32)}`
}
