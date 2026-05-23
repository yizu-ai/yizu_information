export type FeedbackValue = 'favorite' | 'ignore' | 'irrelevant'

export type ReportItem = {
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

export type DailyReport = {
  date: string
  generatedAt: string
  source: string
  warnings: string[]
  items: ReportItem[]
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

export type SavedItem = ReportItem & {
  note?: string
  savedAt?: string
}
