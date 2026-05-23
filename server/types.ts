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
