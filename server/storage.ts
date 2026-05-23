import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { defaultProfile } from './profile'
import { applyFeedback } from './reportEngine'
import type { ApiSettings, DailyReport, FeedbackMap, PublicApiSettings, RankedProject, UserProfile } from './types'

const bundledDataRoot = path.resolve(process.cwd(), 'data')
const dataRoot = process.env.VERCEL ? path.join('/tmp', 'daily-report-agent-data') : bundledDataRoot

export function getDataDir(customDir?: string): string {
  return customDir ?? dataRoot
}

export async function ensureDataDir(baseDir = dataRoot): Promise<void> {
  await mkdir(path.join(baseDir, 'reports'), { recursive: true })
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
  const next: ApiSettings = {
    providerName: settings.providerName.trim(),
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: settings.apiKey.trim() || existing?.apiKey || '',
  }

  if (!next.providerName || !next.baseUrl || !next.apiKey) {
    throw new Error('Provider name, Base URL and APIK are required')
  }

  await writeJson(path.join(baseDir, 'settings.local.json'), next)
  return {
    providerName: next.providerName,
    baseUrl: next.baseUrl,
    hasApiKey: true,
  }
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

  return items
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
