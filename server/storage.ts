import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { defaultProfile } from './profile'
import { applyFeedback } from './reportEngine'
import type {
  ApiSettings,
  DailyReport,
  FeedbackMap,
  PublicApiSettings,
  PublicSourceSettings,
  RankedProject,
  SourceItem,
  SourceKey,
  SourceReport,
  SourceSettings,
  SourceSettingsPatch,
  UserProfile,
} from './types'

const bundledDataRoot = path.resolve(process.cwd(), 'data')
const dataRoot = process.env.VERCEL ? path.join('/tmp', 'daily-report-agent-data') : bundledDataRoot
const defaultSourceSettings: SourceSettings = {
  enabledSources: {
    shengcai: true,
    wechat: true,
    x: true,
    github: true,
  },
  shengcai: {
    entryUrl: 'https://scys.com/?filter=essence',
    browserProfileDir: path.join(bundledDataRoot, 'browser-profiles', 'shengcai'),
  },
  wechat: {
    accounts: [],
    browserProfileDir: path.join(bundledDataRoot, 'browser-profiles', 'wechat'),
  },
  x: {
    dailyLimit: 20,
    topics: [
      { key: 'codex', name: 'Codex', keywords: ['codex', 'openai codex', 'codex cli'] },
      { key: 'agent', name: 'Agent', keywords: ['ai agent', 'agent development', 'agent framework'] },
      { key: 'opensource', name: '开源', keywords: ['github', 'open source ai', 'ai open source'] },
      { key: 'solo-ai-company', name: 'AI 一人公司', keywords: ['solo founder ai', 'one person business ai', 'ai startup'] },
    ],
  },
}

export function getDataDir(customDir?: string): string {
  return customDir ?? dataRoot
}

export async function ensureDataDir(baseDir = dataRoot): Promise<void> {
  await mkdir(path.join(baseDir, 'reports'), { recursive: true })
  await mkdir(path.join(baseDir, 'source-reports'), { recursive: true })
  if (process.env.VERCEL && baseDir === dataRoot) {
    await seedReportsForServerless(baseDir)
  }
}

export async function readProfile(baseDir = dataRoot): Promise<UserProfile> {
  await ensureDataDir(baseDir)
  const profilePath = path.join(baseDir, 'profile.json')

  try {
    return JSON.parse(await readFile(profilePath, 'utf8')) as UserProfile
  } catch {
    await writeJson(profilePath, defaultProfile)
    return defaultProfile
  }
}

export async function readFeedback(baseDir = dataRoot): Promise<FeedbackMap> {
  await ensureDataDir(baseDir)
  const feedbackPath = path.join(baseDir, 'feedback.json')

  try {
    return JSON.parse(await readFile(feedbackPath, 'utf8')) as FeedbackMap
  } catch {
    return {}
  }
}

export async function readRawSettings(baseDir = dataRoot): Promise<ApiSettings | null> {
  const settingsPath = path.join(baseDir, 'settings.local.json')

  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as Partial<ApiSettings>
    if (!settings.providerName || !settings.baseUrl || !settings.apiKey) {
      return null
    }
    return {
      providerName: settings.providerName,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
    }
  } catch {
    if (process.env.DEEPSEEK_API_KEY) {
      return {
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: process.env.DEEPSEEK_API_KEY,
      }
    }
    return null
  }
}

async function readLocalSettings(baseDir = dataRoot): Promise<Partial<ApiSettings> & { sources?: SourceSettingsPatch }> {
  try {
    return JSON.parse(await readFile(path.join(baseDir, 'settings.local.json'), 'utf8')) as Partial<ApiSettings> & {
      sources?: SourceSettingsPatch
    }
  } catch {
    return {}
  }
}

export async function readSettings(baseDir = dataRoot): Promise<PublicApiSettings> {
  const settings = await readRawSettings(baseDir)
  return {
    providerName: settings?.providerName ?? '',
    baseUrl: settings?.baseUrl ?? '',
    hasApiKey: Boolean(settings?.apiKey),
  }
}

export async function writeSettings(settings: ApiSettings, baseDir = dataRoot): Promise<PublicApiSettings> {
  await ensureDataDir(baseDir)
  const existing = await readRawSettings(baseDir)
  const localSettings = await readLocalSettings(baseDir)
  const next: ApiSettings = {
    providerName: settings.providerName.trim(),
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: settings.apiKey.trim() || existing?.apiKey || '',
  }

  if (!next.providerName || !next.baseUrl || !next.apiKey) {
    throw new Error('Provider name, Base URL and APIK are required')
  }

  await writeJson(path.join(baseDir, 'settings.local.json'), { ...localSettings, ...next })
  return {
    providerName: next.providerName,
    baseUrl: next.baseUrl,
    hasApiKey: true,
  }
}

export async function readRawSourceSettings(baseDir = dataRoot): Promise<SourceSettings> {
  await ensureDataDir(baseDir)
  const localSettings = await readLocalSettings(baseDir)
  return mergeSourceSettings(localSettings.sources)
}

export async function readSourceSettings(baseDir = dataRoot): Promise<PublicSourceSettings> {
  const settings = await readRawSourceSettings(baseDir)
  return {
    enabledSources: settings.enabledSources,
    shengcai: settings.shengcai,
    wechat: {
      accounts: settings.wechat.accounts,
      browserProfileDir: settings.wechat.browserProfileDir,
      hasDajialaApiKey: Boolean(settings.wechat.dajialaApiKey),
    },
    x: {
      dailyLimit: settings.x.dailyLimit,
      topics: settings.x.topics,
      hasBearerToken: Boolean(settings.x.bearerToken),
    },
  }
}

export async function writeSourceSettings(
  settings: SourceSettingsPatch,
  baseDir = dataRoot,
): Promise<PublicSourceSettings> {
  await ensureDataDir(baseDir)
  const localSettings = await readLocalSettings(baseDir)
  const existing = await readRawSourceSettings(baseDir)
  const incomingDajialaApiKey = settings.wechat?.dajialaApiKey?.trim()
  if (incomingDajialaApiKey && !isDajialaApiKey(incomingDajialaApiKey)) {
    throw new Error('极致了 API Key 格式不对：请填写以 JZL 开头的极致了 key，不要填写 X Bearer Token。')
  }
  const next = mergeSourceSettings({
    enabledSources: { ...existing.enabledSources, ...settings.enabledSources },
    shengcai: { ...existing.shengcai, ...settings.shengcai },
    wechat: {
      ...existing.wechat,
      ...settings.wechat,
      dajialaApiKey: incomingDajialaApiKey || existing.wechat.dajialaApiKey,
    },
    x: {
      ...existing.x,
      ...settings.x,
      bearerToken: settings.x?.bearerToken?.trim() || existing.x.bearerToken,
      topics: settings.x?.topics ?? existing.x.topics,
    },
  })

  await writeJson(path.join(baseDir, 'settings.local.json'), { ...localSettings, sources: next })
  return readSourceSettings(baseDir)
}

function isDajialaApiKey(value: string): boolean {
  return /^JZL/i.test(value)
}

export async function writeFeedback(baseDir: string, feedback: FeedbackMap): Promise<void> {
  await ensureDataDir(baseDir)
  await writeJson(path.join(baseDir, 'feedback.json'), feedback)
}

export async function upsertFeedback(
  repo: string,
  value: FeedbackMap[string] | null,
  baseDir = dataRoot,
): Promise<FeedbackMap> {
  const feedback = await readFeedback(baseDir)
  if (value === null) {
    if (feedback[repo]?.note) {
      delete feedback[repo].feedback
      delete feedback[repo].updatedAt
    } else {
      delete feedback[repo]
    }
  } else {
    feedback[repo] = {
      ...feedback[repo],
      ...value,
    }
  }
  await writeFeedback(baseDir, feedback)
  return feedback
}

export async function upsertNote(repo: string, note: string, baseDir = dataRoot): Promise<FeedbackMap> {
  const feedback = await readFeedback(baseDir)
  const trimmed = note.trim()

  if (!trimmed) {
    if (feedback[repo]?.feedback) {
      delete feedback[repo].note
      delete feedback[repo].noteUpdatedAt
    } else {
      delete feedback[repo]
    }
  } else {
    feedback[repo] = {
      ...feedback[repo],
      note: trimmed,
      noteUpdatedAt: new Date().toISOString(),
    }
  }

  await writeFeedback(baseDir, feedback)
  return feedback
}

export async function upsertRating(repo: string, rating: number | null, baseDir = dataRoot): Promise<FeedbackMap> {
  const feedback = await readFeedback(baseDir)

  if (rating === null) {
    if (feedback[repo]?.feedback || feedback[repo]?.note) {
      delete feedback[repo].rating
      delete feedback[repo].ratingUpdatedAt
    } else {
      delete feedback[repo]
    }
  } else {
    feedback[repo] = {
      ...feedback[repo],
      rating,
      ratingUpdatedAt: new Date().toISOString(),
    }
  }

  await writeFeedback(baseDir, feedback)
  return feedback
}

export async function saveReport(report: DailyReport, baseDir = dataRoot): Promise<void> {
  await ensureDataDir(baseDir)
  await writeJson(path.join(baseDir, 'reports', `${report.date}.json`), report)
}

export async function readReport(date: string, baseDir = dataRoot): Promise<DailyReport | null> {
  try {
    const report = JSON.parse(
      await readFile(path.join(baseDir, 'reports', `${date}.json`), 'utf8'),
    ) as DailyReport
    const feedback = await readFeedback(baseDir)
    return { ...report, items: applyFeedback(report.items, feedback) }
  } catch {
    return null
  }
}

export async function deleteReport(date: string, baseDir = dataRoot): Promise<boolean> {
  if (!isReportDate(date)) {
    return false
  }

  try {
    await rm(path.join(baseDir, 'reports', `${date}.json`), { force: false })
    return true
  } catch {
    return false
  }
}

export async function saveSourceReport(report: SourceReport, baseDir = dataRoot): Promise<void> {
  await ensureDataDir(baseDir)
  await writeJson(sourceReportPath(report.sourceKey, report.date, baseDir), report)
}

export async function readSourceReport(
  sourceKey: SourceKey,
  date: string,
  baseDir = dataRoot,
): Promise<SourceReport | null> {
  try {
    const report = JSON.parse(await readFile(sourceReportPath(sourceKey, date, baseDir), 'utf8')) as SourceReport
    const feedback = await readFeedback(baseDir)
    return {
      ...report,
      items: report.items.map((item) => ({
        ...item,
        feedback: feedback[item.itemId]?.feedback ?? null,
        note: feedback[item.itemId]?.note,
        rating: feedback[item.itemId]?.rating,
      })),
    }
  } catch {
    return null
  }
}

export async function deleteSourceReport(sourceKey: SourceKey, date: string, baseDir = dataRoot): Promise<boolean> {
  if (!isReportDate(date)) {
    return false
  }

  try {
    await rm(sourceReportPath(sourceKey, date, baseDir), { force: false })
    return true
  } catch {
    return false
  }
}

export async function listSourceReportDates(sourceKey: SourceKey, baseDir = dataRoot): Promise<string[]> {
  await ensureDataDir(baseDir)
  try {
    const files = await readdir(path.join(baseDir, 'source-reports', sourceKey))
    return files
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .map((file) => file.replace('.json', ''))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

function isReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export async function listCollectedSourceItemIds(sourceKey: SourceKey, baseDir = dataRoot): Promise<Set<string>> {
  const dates = await listSourceReportDates(sourceKey, baseDir)
  const ids = new Set<string>()
  for (const date of dates) {
    const report = await readSourceReport(sourceKey, date, baseDir)
    for (const item of report?.items ?? []) {
      ids.add(item.itemId)
    }
  }
  return ids
}

export async function listFavoriteItems(baseDir = dataRoot): Promise<RankedProject[]> {
  const feedback = await readFeedback(baseDir)
  const reports = new Map((await readAllReportItems(baseDir)).map((item) => [item.repo, item]))
  return Object.entries(feedback)
    .filter(([, entry]) => entry.feedback === 'favorite')
    .map(([repo, entry]) => ({
      ...fallbackSavedItem(repo),
      ...reports.get(repo),
      feedback: 'favorite' as const,
      note: entry.note,
      rating: entry.rating,
    }))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name))
}

export async function listNotedItems(baseDir = dataRoot): Promise<RankedProject[]> {
  const feedback = await readFeedback(baseDir)
  const reports = new Map((await readAllReportItems(baseDir)).map((item) => [item.repo, item]))
  return Object.entries(feedback)
    .filter(([, entry]) => Boolean(entry.note))
    .map(([repo, entry]) => ({
      ...fallbackSavedItem(repo),
      ...reports.get(repo),
      feedback: entry.feedback ?? null,
      note: entry.note,
      rating: entry.rating,
    }))
}

export async function listReportDates(baseDir = dataRoot): Promise<string[]> {
  await ensureDataDir(baseDir)
  const files = await readdir(path.join(baseDir, 'reports'))
  return files
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map((file) => file.replace('.json', ''))
    .sort()
    .reverse()
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sourceReportPath(sourceKey: SourceKey, date: string, baseDir = dataRoot): string {
  return path.join(baseDir, 'source-reports', sourceKey, `${date}.json`)
}

function mergeSourceSettings(settings: SourceSettingsPatch | undefined): SourceSettings {
  const xSettings = settings?.x
  const xDailyLimit =
    Number.isInteger(xSettings?.dailyLimit) && (xSettings?.dailyLimit ?? 0) > 0 ? (xSettings?.dailyLimit ?? 20) : 20
  const xTopics =
    Array.isArray(xSettings?.topics) && xSettings.topics.length > 0
      ? xSettings.topics
      : defaultSourceSettings.x.topics
  return {
    enabledSources: {
      ...defaultSourceSettings.enabledSources,
      ...(settings?.enabledSources ?? {}),
    },
    shengcai: {
      entryUrl: settings?.shengcai?.entryUrl?.trim() || defaultSourceSettings.shengcai.entryUrl,
      browserProfileDir:
        settings?.shengcai?.browserProfileDir?.trim() || defaultSourceSettings.shengcai.browserProfileDir,
    },
    wechat: {
      accounts: Array.isArray(settings?.wechat?.accounts)
        ? settings.wechat.accounts.map((account) => account.trim()).filter(Boolean)
        : defaultSourceSettings.wechat.accounts,
      browserProfileDir: settings?.wechat?.browserProfileDir?.trim() || defaultSourceSettings.wechat.browserProfileDir,
      dajialaApiKey: settings?.wechat?.dajialaApiKey?.trim() || undefined,
    },
    x: {
      bearerToken: settings?.x?.bearerToken?.trim() || undefined,
      dailyLimit: xDailyLimit,
      topics: xTopics,
    },
  }
}

async function seedReportsForServerless(baseDir: string): Promise<void> {
  try {
    const files = await readdir(path.join(bundledDataRoot, 'reports'))
    await Promise.all(
      files
        .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
        .map(async (file) => {
          const target = path.join(baseDir, 'reports', file)
          try {
            await readFile(target, 'utf8')
          } catch {
            await copyFile(path.join(bundledDataRoot, 'reports', file), target)
          }
        }),
    )
  } catch {
    // A deployment can still boot without bundled reports; the UI will show an empty state.
  }
}

async function readAllReportItems(baseDir = dataRoot): Promise<RankedProject[]> {
  const dates = await listReportDates(baseDir)
  const seen = new Set<string>()
  const items: RankedProject[] = []

  for (const date of dates) {
    const report = await readReport(date, baseDir)
    for (const item of report?.items ?? []) {
      if (!seen.has(item.repo)) {
        seen.add(item.repo)
        items.push(item)
      }
    }
  }

  for (const sourceKey of ['shengcai', 'wechat', 'x', 'github'] as SourceKey[]) {
    const sourceDates = await listSourceReportDates(sourceKey, baseDir)
    for (const date of sourceDates) {
      const report = await readSourceReport(sourceKey, date, baseDir)
      for (const item of report?.items ?? []) {
        if (!seen.has(item.itemId)) {
          seen.add(item.itemId)
          items.push(sourceItemToRankedProject(item))
        }
      }
    }
  }

  return items
}

function sourceItemToRankedProject(item: SourceItem): RankedProject {
  return {
    ...item,
    repo: item.itemId,
    name: item.title,
    url: item.originalUrl,
    description: item.contentSummary,
    language: item.sourceKey,
    stars: item.likes ?? 0,
    todayStars: 0,
    score: item.likes ?? 0,
    matchedTracks: [],
    brief: item.contentSummary,
    summary: item.contentSummary,
    useAdvice: item.essenceSummary,
    relevanceReason: item.essenceSummary,
  }
}

function fallbackSavedItem(repo: string): RankedProject {
  const name = repo.split('/').at(-1) ?? repo
  return {
    repo,
    name,
    url: `https://github.com/${repo}`,
    description: '',
    language: '',
    stars: 0,
    todayStars: 0,
    score: 0,
    matchedTracks: [],
  }
}
