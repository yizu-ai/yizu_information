export type FeedbackValue = 'favorite' | 'ignore' | 'irrelevant'
export type SourceKey = 'shengcai' | 'wechat' | 'x' | 'github'

export type ReportItem = {
  sourceKey?: SourceKey
  itemId?: string
  title?: string
  authorName?: string
  publishedAt?: string
  originalUrl?: string
  likes?: number
  contentSummary?: string
  essenceSummary?: string
  summaryStatus?: 'success' | 'failed'
  summaryError?: string
  collectedAt?: string
  rank?: number
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

export type DailyReport = {
  date: string
  generatedAt: string
  source: string
  warnings: string[]
  items: ReportItem[]
}

export type SourceBootstrapResponse = {
  dates: string[]
  activeDate: string | null
  report: SourceReport | null
}

export type SourceRunResult = {
  sourceKey: SourceKey
  status: 'success' | 'failed' | 'skipped'
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

export type BootstrapResponse = {
  dates: string[]
  activeDate: string | null
  report: DailyReport | null
}

export type PublicApiSettings = {
  providerName: string
  baseUrl: string
  hasApiKey: boolean
}

export type PublicSourceSettings = {
  enabledSources: Record<SourceKey, boolean>
  shengcai: {
    entryUrl: string
    browserProfileDir: string
  }
  wechat: {
    accounts: string[]
    browserProfileDir: string
    hasDajialaApiKey: boolean
  }
  x: {
    hasBearerToken: boolean
    dailyLimit: number
    topics: Array<{
      key: string
      name: string
      keywords: string[]
    }>
  }
}

export type SavedItem = ReportItem & {
  note?: string
  savedAt?: string
}
