export type SourceKey = 'shengcai' | 'wechat' | 'x' | 'github'

export type FeedbackValue = 'favorite' | 'ignore' | 'irrelevant'

export type FeedbackMap = Record<
  string,
  {
    feedback?: FeedbackValue
    updatedAt?: string
    note?: string
    noteUpdatedAt?: string
    rating?: number
    ratingUpdatedAt?: string
  }
>

export type ProfileTrack = {
  name: string
  keywords: string[]
}

export type UserProfile = {
  tracks: ProfileTrack[]
}

export type TrendingProject = {
  repo: string
  name: string
  url: string
  description: string
  homepage?: string
  language: string
  stars: number
  todayStars: number
  updatedAt?: string
  topics?: string[]
  readmeExcerpt?: string
}

export type RankedProject = TrendingProject & {
  rank?: number
  score: number
  matchedTracks: string[]
  summary?: string
  purpose?: string
  relevanceReason?: string
  nameZh?: string
  brief?: string
  useAdvice?: string
  feedback?: FeedbackValue | null
  note?: string
  rating?: number
}

export type DailyReport = {
  date: string
  generatedAt: string
  source: string
  items: RankedProject[]
  warnings: string[]
}

export type SourceItem = {
  sourceKey: SourceKey
  itemId: string
  title: string
  authorName?: string
  publishedAt?: string
  originalUrl: string
  likes?: number
  contentSummary: string
  essenceSummary: string
  summaryStatus: 'success' | 'failed'
  summaryError?: string
  collectedAt: string
  feedback?: FeedbackValue | null
  note?: string
  rating?: number
}

export type SourceReport = {
  sourceKey: SourceKey
  date: string
  generatedAt: string
  warnings: string[]
  emptyReason?: 'no_updates'
  settingsFingerprint?: string
  cost?: SourceCost
  items: SourceItem[]
}

export type SourceCost = {
  currency: 'CNY'
  estimatedMin: number
  estimatedMax: number
  details: Array<{
    label: string
    requests: number
    unitPriceMin: number
    unitPriceMax: number
    subtotalMin: number
    subtotalMax: number
  }>
  note: string
}

export type SourceRunStatus = 'success' | 'failed' | 'skipped'

export type SourceRunResult = {
  sourceKey: SourceKey
  status: SourceRunStatus
  itemCount?: number
  message?: string
  lastSuccessAt?: string
}

export type CollectSourcesResult = {
  date: string
  startedAt: string
  finishedAt: string
  results: SourceRunResult[]
}

export type SourceCollector = (input: {
  date: string
  dataDir?: string
  lastSuccessAt?: string
}) => Promise<SourceReport>

export type XPost = {
  id: string
  text: string
  authorName: string
  createdAt: string
  likeCount: number
  url: string
  isRetweet: boolean
  isReply: boolean
}

export type XTopicSearchResult = {
  topicKey: string
  topicName: string
  posts: XPost[]
}

export type XSelectedPost = XPost & {
  topicKey: string
  topicName: string
}

export type SourceSettings = {
  enabledSources: Record<SourceKey, boolean>
  shengcai: {
    entryUrl: string
    browserProfileDir: string
  }
  wechat: {
    accounts: string[]
    browserProfileDir: string
    dajialaApiKey?: string
  }
  x: {
    bearerToken?: string
    dailyLimit: number
    topics: Array<{
      key: string
      name: string
      keywords: string[]
    }>
  }
}

export type SourceSettingsPatch = {
  enabledSources?: Partial<Record<SourceKey, boolean>>
  shengcai?: Partial<SourceSettings['shengcai']>
  wechat?: Partial<SourceSettings['wechat']>
  x?: Partial<SourceSettings['x']>
}

export type PublicSourceSettings = Omit<SourceSettings, 'wechat' | 'x'> & {
  wechat: Omit<SourceSettings['wechat'], 'dajialaApiKey'> & {
    hasDajialaApiKey: boolean
  }
  x: Omit<SourceSettings['x'], 'bearerToken'> & {
    hasBearerToken: boolean
  }
}

export type ApiSettings = {
  providerName: string
  baseUrl: string
  apiKey: string
}

export type PublicApiSettings = {
  providerName: string
  baseUrl: string
  hasApiKey: boolean
}
