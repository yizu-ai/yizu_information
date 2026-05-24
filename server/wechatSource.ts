import { createHash } from 'node:crypto'

import { load } from 'cheerio'

import { readRawSourceSettings } from './storage'
import { summarizeSourceItems } from './sourceSummarizer'
import type { SourceCollector, SourceItem } from './types'

const postConditionUrl = 'https://www.dajiala.com/fbmain/monitor/v3/post_condition'
const articleHtmlUrl = 'https://www.dajiala.com/fbmain/monitor/v3/article_html'
const dajialaRates = {
  postCondition: { label: '公众号当日发文查询', min: 0.06, max: 0.08 },
  articleHtml: { label: '文章正文读取', min: 0.04, max: 0.04 },
}

type WechatPostCandidate = {
  account: string
  title: string
  url: string
  publishedAt?: string
}

type WechatArticle = WechatPostCandidate & {
  text: string
  error?: string
}

type DajialaDailyPost = {
  title?: string
  url?: string
  post_time?: number | string
  post_time_str?: string
  msg_status?: number | string
  is_deleted?: number | string | boolean
}

type DajialaDailyResponse = {
  code?: number
  msg?: string
  data?: unknown
  mp_nickname?: string
}

type DajialaArticleResponse = {
  code?: number
  msg?: string
  msk?: string
  data?: {
    title?: string
    article_url?: string
    nickname?: string
    author?: string
    post_time?: number | string
    post_time_str?: string
    desc?: string
    html?: string
    content?: string
  }
  title?: string
  article_url?: string
  nickname?: string
  author?: string
  post_time?: number | string
  post_time_str?: string
  desc?: string
  content?: string
}

export const collectWechatSource: SourceCollector = async ({ date, dataDir }) => {
  const settings = await readRawSourceSettings(dataDir)
  const settingsFingerprint = wechatSettingsFingerprint(settings.wechat.accounts)
  if (settings.wechat.accounts.length === 0) {
    return {
      sourceKey: 'wechat',
      date,
      generatedAt: new Date().toISOString(),
      warnings: ['还没有配置公众号名称。'],
      settingsFingerprint,
      items: [],
    }
  }

  if (!settings.wechat.dajialaApiKey) {
    return {
      sourceKey: 'wechat',
      date,
      generatedAt: new Date().toISOString(),
      warnings: ['还没有配置极致了 API Key，无法查询公众号当天更新。'],
      settingsFingerprint,
      items: [],
    }
  }

  const warnings: string[] = [
    '微信公众号使用极致了 API 查询当天发文；只有查到新文章时才会临时读取正文并交给 DeepSeek 总结，正文不会长期保存。',
  ]
  const candidates: WechatPostCandidate[] = []
  const accountErrors: string[] = []
  let postConditionRequests = 0
  let articleHtmlRequests = 0

  for (const account of settings.wechat.accounts) {
    try {
      postConditionRequests += 1
      const dailyResponse = await postDajiala<DajialaDailyResponse>(postConditionUrl, {
        biz: '',
        url: '',
        name: account,
        key: settings.wechat.dajialaApiKey,
        verifycode: '',
      })
      const posts = normalizeDajialaDailyPosts(dailyResponse, account)
      candidates.push(...posts)
      warnings.push(posts.length > 0 ? `${account} 今日更新 ${posts.length} 篇。` : `${account} 今日没有新文章。`)
    } catch (error) {
      const message = `${account} 查询失败：${formatDajialaError(error)}`
      accountErrors.push(message)
      warnings.push(message)
    }
  }

  const uniqueCandidates = dedupeCandidates(candidates)
  if (uniqueCandidates.length === 0) {
    return {
      sourceKey: 'wechat',
      date,
      generatedAt: new Date().toISOString(),
      warnings: [...warnings, accountErrors.length > 0 ? '本次没有成功查询到可总结的公众号文章。' : '今日没有新文章'],
      emptyReason: accountErrors.length > 0 ? undefined : 'no_updates',
      settingsFingerprint,
      cost: buildWechatCollectionCost(postConditionRequests, articleHtmlRequests),
      items: [],
    }
  }

  const articles: WechatArticle[] = []
  for (const candidate of uniqueCandidates) {
    try {
      articleHtmlRequests += 1
      articles.push(
        await fetchDajialaArticle({
          candidate,
          apiKey: settings.wechat.dajialaApiKey,
        }),
      )
    } catch (error) {
      articles.push({
        ...candidate,
        text: '',
        error: formatDajialaError(error),
      })
    }
  }

  const summaries = await summarizeSourceItems(
    articles.map((article) => ({
      sourceName: '微信公众号',
      itemId: stableItemId('wechat', article.url),
      title: article.title,
      authorName: article.account,
      publishedAt: article.publishedAt,
      originalUrl: article.url,
      rawText: article.text,
    })),
    { sourceName: '微信公众号', dataDir },
  )
  const summaryById = new Map(summaries.map((summary) => [summary.itemId, summary]))

  const items: SourceItem[] = articles.map((article) => {
    const itemId = stableItemId('wechat', article.url)
    const summary = summaryById.get(itemId)
    return {
      sourceKey: 'wechat',
      itemId,
      title: article.title,
      authorName: article.account,
      publishedAt: article.publishedAt,
      originalUrl: article.url,
      contentSummary: summary?.contentSummary || '正文提取失败，建议打开原文查看。',
      essenceSummary: summary?.essenceSummary || '正文提取失败，暂无法生成精华总结。',
      summaryStatus: article.text ? summary?.summaryStatus ?? 'success' : 'failed',
      summaryError: article.error || summary?.summaryError,
      collectedAt: new Date().toISOString(),
    }
  })

  return {
    sourceKey: 'wechat',
    date,
    generatedAt: new Date().toISOString(),
    warnings,
    settingsFingerprint,
    cost: buildWechatCollectionCost(postConditionRequests, articleHtmlRequests),
    items,
  }
}

function buildWechatCollectionCost(postConditionRequests: number, articleHtmlRequests: number) {
  const details = [
    buildCostDetail(dajialaRates.postCondition, postConditionRequests),
    buildCostDetail(dajialaRates.articleHtml, articleHtmlRequests),
  ].filter((detail) => detail.requests > 0)
  const estimatedMin = roundMoney(details.reduce((sum, detail) => sum + detail.subtotalMin, 0))
  const estimatedMax = roundMoney(details.reduce((sum, detail) => sum + detail.subtotalMax, 0))
  return {
    currency: 'CNY' as const,
    estimatedMin,
    estimatedMax,
    details,
    note: '按极致了接口页单价估算，实际扣费以极致了后台账单为准；不含 DeepSeek 模型费用。',
  }
}

function buildCostDetail(rate: { label: string; min: number; max: number }, requests: number) {
  return {
    label: rate.label,
    requests,
    unitPriceMin: rate.min,
    unitPriceMax: rate.max,
    subtotalMin: roundMoney(requests * rate.min),
    subtotalMax: roundMoney(requests * rate.max),
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function wechatSettingsFingerprint(accounts: string[]): string {
  const normalizedAccounts = Array.from(new Set(accounts.map((account) => account.trim()).filter(Boolean))).sort()
  return createHash('sha256').update(JSON.stringify(normalizedAccounts)).digest('base64url').slice(0, 24)
}

export function normalizeDajialaDailyPosts(payload: DajialaDailyResponse, fallbackAccount: string): WechatPostCandidate[] {
  assertDajialaSuccess(payload)
  const posts = Array.isArray(payload.data) ? (payload.data as DajialaDailyPost[]) : []
  const account = payload.mp_nickname?.trim() || fallbackAccount

  return posts
    .filter(isNormalWechatPost)
    .map((post): WechatPostCandidate | null => {
      const normalizedLink = normalizeWechatArticleLink({
        title: post.title?.trim() || '公众号文章',
        url: post.url ?? '',
      })
      if (!normalizedLink) {
        return null
      }
      return {
        account,
        title: normalizedLink.title,
        url: normalizedLink.url,
        publishedAt: parseDajialaPublishedAt(post.post_time_str, post.post_time),
      }
    })
    .filter((post): post is WechatPostCandidate => Boolean(post))
}

export function normalizeWechatArticleLink(link: { title: string; url: string }): { title: string; url: string } | null {
  const articleUrl = extractWechatArticleUrl(link.url)
  if (!articleUrl) {
    return null
  }

  return {
    title: link.title || '公众号文章',
    url: articleUrl,
  }
}

async function fetchDajialaArticle(input: {
  candidate: WechatPostCandidate
  apiKey: string
}): Promise<WechatArticle> {
  const payload = await postDajiala<DajialaArticleResponse>(articleHtmlUrl, {
    url: input.candidate.url,
    key: input.apiKey,
    verifycode: '',
  })
  assertDajialaSuccess(payload)
  const data = payload.data ?? payload
  const originalUrl = normalizeDirectWechatArticleUrl(decodeHtmlEntity(data.article_url ?? '')) ?? input.candidate.url
  const html = 'html' in data ? data.html : data.content
  const textParts = [data.desc, htmlToText(html ?? '')].map((text) => text?.trim()).filter(Boolean)

  return {
    account: data.nickname?.trim() || input.candidate.account,
    title: data.title?.trim() || input.candidate.title,
    url: originalUrl,
    publishedAt: parseDajialaPublishedAt(data.post_time_str, data.post_time) ?? input.candidate.publishedAt,
    text: textParts.join('\n\n'),
  }
}

async function postDajiala<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`极致了 API 请求失败：${response.status} ${response.statusText}`)
  }
  return payload as T
}

function assertDajialaSuccess(payload: { code?: number; msg?: string; msk?: string }): void {
  if (payload.code === undefined || payload.code === 0) {
    return
  }
  throw new Error(`极致了 API 返回错误 ${payload.code}：${redactSensitiveText(payload.msg ?? payload.msk ?? '未知错误')}`)
}

function isNormalWechatPost(post: DajialaDailyPost): boolean {
  const status = Number(post.msg_status)
  const isDeleted = String(post.is_deleted ?? '0') === '1' || post.is_deleted === true
  return Boolean(post.url) && !isDeleted && ![6, 7, 104, 105].includes(status)
}

function dedupeCandidates(candidates: WechatPostCandidate[]): WechatPostCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    if (seen.has(candidate.url)) {
      return false
    }
    seen.add(candidate.url)
    return true
  })
}

function extractWechatArticleUrl(rawUrl: string): string | null {
  const directUrl = normalizeDirectWechatArticleUrl(rawUrl)
  if (directUrl) {
    return directUrl
  }

  for (const embeddedUrl of extractEmbeddedUrls(rawUrl)) {
    const articleUrl = normalizeDirectWechatArticleUrl(embeddedUrl)
    if (articleUrl) {
      return articleUrl
    }
  }

  return null
}

function normalizeDirectWechatArticleUrl(rawUrl: string): string | null {
  try {
    const parsedUrl = new URL(decodeHtmlEntity(rawUrl))
    if (parsedUrl.hostname !== 'mp.weixin.qq.com') {
      return null
    }
    if (parsedUrl.pathname !== '/s' && !parsedUrl.pathname.startsWith('/s/')) {
      return null
    }
    parsedUrl.hash = ''
    return parsedUrl.toString()
  } catch {
    return null
  }
}

function extractEmbeddedUrls(rawUrl: string): string[] {
  const candidates: string[] = []
  try {
    const parsedUrl = new URL(rawUrl)
    for (const value of parsedUrl.searchParams.values()) {
      candidates.push(value)
      const decodedBingUrl = decodeBingWrappedUrl(value)
      if (decodedBingUrl) {
        candidates.push(decodedBingUrl)
      }
    }
  } catch {
    // Fall through to regex extraction below.
  }

  const decodedRawUrl = safeDecodeURIComponent(rawUrl)
  candidates.push(decodedRawUrl)
  candidates.push(...(decodedRawUrl.match(/https?:\/\/mp\.weixin\.qq\.com\/s[/?][^"'<>\\\s]+/g) ?? []))

  return candidates
}

function decodeBingWrappedUrl(value: string): string | null {
  const encodedValue = value.startsWith('a1') ? value.slice(2) : value
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(encodedValue)) {
    return null
  }
  try {
    return Buffer.from(encodedValue, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseDajialaPublishedAt(dateText?: string, timestamp?: number | string): string | undefined {
  if (dateText) {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(dateText.trim())
    if (match) {
      const [, year, month, day, hour, minute, second = '00'] = match
      return `${year}-${month}-${day}T${hour}:${minute}:${second}.000+08:00`
    }
  }

  const numericTimestamp = Number(timestamp)
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
    return new Date(numericTimestamp * 1000).toISOString()
  }
  return undefined
}

function htmlToText(html: string): string {
  return load(html).text().replace(/\s+/g, ' ').trim()
}

function decodeHtmlEntity(value: string): string {
  return value.replace(/&amp;/g, '&')
}

function formatDajialaError(error: unknown): string {
  return redactSensitiveText(error instanceof Error ? error.message : '未知错误')
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(当前输入key值为\s*)\S+/gi, '$1[已隐藏]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[已隐藏]')
    .replace(/\bJZL[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]')
    .replace(/\bA{10,}[A-Za-z0-9%._~+-]{20,}\b/g, '[已隐藏]')
}

function stableItemId(source: string, value: string): string {
  return `${source}:${createHash('sha256').update(value).digest('base64url').slice(0, 32)}`
}
