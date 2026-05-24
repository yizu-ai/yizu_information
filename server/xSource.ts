import { readRawSourceSettings } from './storage'
import { summarizeSourceItems } from './sourceSummarizer'
import type { SourceCollector, SourceItem, XPost, XSelectedPost, XTopicSearchResult } from './types'

export function selectTopXPostsByTopic(
  topics: XTopicSearchResult[],
  options: { dailyLimit: number; perTopicLimit: number },
): XSelectedPost[] {
  let remaining = options.dailyLimit
  const selected: XSelectedPost[] = []

  for (const topic of topics) {
    if (remaining <= 0) {
      break
    }

    const candidates = topic.posts
      .filter((post) => !post.isRetweet && !post.isReply)
      .slice(0, remaining)
      .sort((a, b) => b.likeCount - a.likeCount)
      .slice(0, options.perTopicLimit)
      .map((post) => ({
        ...post,
        topicKey: topic.topicKey,
        topicName: topic.topicName,
      }))

    selected.push(...candidates)
    remaining -= topic.posts.length
  }

  return selected
}

export const collectXSource: SourceCollector = async ({ date, dataDir }) => {
  const settings = await readRawSourceSettings(dataDir)
  if (!settings.x.bearerToken) {
    throw new Error('X.com Bearer Token 未配置。')
  }

  const posts = await searchRecentPosts({
    bearerToken: settings.x.bearerToken,
    keywords: uniqueKeywords(settings.x.topics.flatMap((topic) => topic.keywords)),
    maxResults: settings.x.dailyLimit,
  })
  const topicResults = settings.x.topics.map((topic) => ({
    topicKey: topic.key,
    topicName: topic.name,
    posts: posts.filter((post) => matchesTopic(post.text, topic.keywords)),
  }))
  const selected = selectTopXPostsByTopic(topicResults, {
    dailyLimit: settings.x.dailyLimit,
    perTopicLimit: 3,
  })
  const summaries = await summarizeSourceItems(
    selected.map((post) => ({
      sourceName: 'X.com',
      itemId: `x:${post.id}`,
      title: `${post.topicName} / ${post.authorName}`,
      authorName: post.authorName,
      publishedAt: post.createdAt,
      originalUrl: post.url,
      rawText: post.text,
    })),
    { sourceName: 'X.com', dataDir },
  )
  const summaryById = new Map(summaries.map((summary) => [summary.itemId, summary]))

  const items: SourceItem[] = selected.map((post) => {
    const itemId = `x:${post.id}`
    const summary = summaryById.get(itemId)
    return {
      sourceKey: 'x',
      itemId,
      title: `${post.topicName} / ${post.authorName}`,
      authorName: post.authorName,
      publishedAt: post.createdAt,
      originalUrl: post.url,
      likes: post.likeCount,
      contentSummary: summary?.contentSummary || post.text.slice(0, 180),
      essenceSummary: summary?.essenceSummary || 'AI 总结暂不可用，建议打开原推文判断价值。',
      summaryStatus: summary?.summaryStatus ?? 'success',
      summaryError: summary?.summaryError,
      collectedAt: new Date().toISOString(),
    }
  })

  return {
    sourceKey: 'x',
    date,
    generatedAt: new Date().toISOString(),
    warnings: [],
    items,
  }
}

async function searchRecentPosts(input: {
  bearerToken: string
  keywords: string[]
  maxResults: number
}): Promise<XPost[]> {
  const query = `(${input.keywords.map((keyword) => `"${keyword}"`).join(' OR ')}) -is:retweet -is:reply`
  const url = new URL('https://api.x.com/2/tweets/search/recent')
  url.searchParams.set('query', query)
  url.searchParams.set('max_results', String(normalizeXMaxResults(input.maxResults)))
  url.searchParams.set('tweet.fields', 'created_at,public_metrics,author_id,referenced_tweets')
  url.searchParams.set('expansions', 'author_id')
  url.searchParams.set('user.fields', 'name,username')

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${input.bearerToken}`,
    },
  })
  if (!response.ok) {
    throw new Error(await formatXApiError(response))
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id: string
      text: string
      author_id?: string
      created_at?: string
      public_metrics?: { like_count?: number }
      referenced_tweets?: Array<{ type: string }>
    }>
    includes?: {
      users?: Array<{ id: string; name?: string; username?: string }>
    }
  }
  const users = new Map((payload.includes?.users ?? []).map((user) => [user.id, user]))
  return (payload.data ?? []).map((tweet) => {
    const user = tweet.author_id ? users.get(tweet.author_id) : undefined
    const username = user?.username ? `@${user.username}` : tweet.author_id ?? 'unknown'
    return {
      id: tweet.id,
      text: tweet.text,
      authorName: user?.name ? `${user.name} (${username})` : username,
      createdAt: tweet.created_at ?? '',
      likeCount: tweet.public_metrics?.like_count ?? 0,
      url: `https://x.com/${user?.username ?? 'i'}/status/${tweet.id}`,
      isRetweet: Boolean(tweet.referenced_tweets?.some((reference) => reference.type === 'retweeted')),
      isReply: Boolean(tweet.referenced_tweets?.some((reference) => reference.type === 'replied_to')),
    }
  })
}

export function normalizeXMaxResults(value: number): number {
  if (!Number.isFinite(value)) {
    return 20
  }
  return Math.min(100, Math.max(10, Math.floor(value)))
}

function uniqueKeywords(keywords: string[]): string[] {
  return Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)))
}

function matchesTopic(text: string, keywords: string[]): boolean {
  const normalizedText = text.toLowerCase()
  return keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase()))
}

export async function formatXApiError(response: Response): Promise<string> {
  const status = response.status
  const statusText = response.statusText
  const details = await response.text().catch(() => '')
  const suffix = details ? `；接口返回：${details.slice(0, 240)}` : ''
  if (status === 402) {
    return `X API 请求失败：402 Payment Required。这个 X 开发者账号当前没有可用 API 额度或未开通计费；需要在 X Developer Console 开通付费/额度后才能采集${suffix}`
  }

  if (status === 401) {
    return `X API 请求失败：401 Unauthorized。Bearer Token 无效、已撤销或复制不完整，请重新生成并保存${suffix}`
  }

  if (status === 403) {
    return `X API 请求失败：403 Forbidden。当前 App 没有 Recent Search 接口权限，请检查 X API 套餐和 App 权限${suffix}`
  }

  if (status === 400) {
    return `X API 请求失败：400 Bad Request。通常是查询参数不符合 X API 要求，例如 max_results 必须在 10 到 100 之间，或搜索 query 过长${suffix}`
  }

  if (status === 429) {
    return `X API 请求失败：429 Too Many Requests。已达到 X API 频率限制，请稍后重试${suffix}`
  }

  return `X API 请求失败：${status} ${statusText}${suffix}`
}
