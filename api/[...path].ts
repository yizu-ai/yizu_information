// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const bundledDataRoot = path.resolve(process.cwd(), 'data')
const runtimeDataRoot = process.env.VERCEL ? path.join('/tmp', 'yizu-information-data') : bundledDataRoot
const allowedFeedback = new Set(['favorite', 'ignore', 'irrelevant'])

export default async function handler(request, response) {
  try {
    const route = parseRoute(request.url)
    const method = request.method ?? 'GET'

    if (method === 'GET' && route[0] === 'bootstrap') {
      const dates = await listReportDates()
      const activeDate = dates[0] ?? null
      const report = activeDate ? await readReport(activeDate) : null
      sendJson(response, 200, { dates, activeDate, report })
      return
    }

    if (method === 'GET' && route[0] === 'reports' && route[1]) {
      const report = await readReport(decodeURIComponent(route[1]))
      if (!report) {
        sendJson(response, 404, { error: 'Report not found' })
        return
      }
      sendJson(response, 200, { report })
      return
    }

    if (method === 'GET' && route[0] === 'favorites') {
      sendJson(response, 200, { items: await listFavoriteItems() })
      return
    }

    if (method === 'GET' && route[0] === 'notes') {
      sendJson(response, 200, { items: await listNotedItems() })
      return
    }

    if (method === 'GET' && route[0] === 'settings') {
      sendJson(response, 200, { settings: await readSettings() })
      return
    }

    if (method === 'POST' && route[0] === 'feedback') {
      const body = await readRequestBody(request)
      const repo = String(body?.repo ?? '')
      const feedback = body?.feedback ?? null

      if (!repo || (feedback !== null && !allowedFeedback.has(feedback))) {
        sendJson(response, 400, { error: 'Invalid feedback payload' })
        return
      }

      const feedbackMap = await upsertFeedback(
        repo,
        feedback === null ? null : { feedback, updatedAt: new Date().toISOString() },
      )
      sendJson(response, 200, { feedback: feedbackMap[repo] ?? null })
      return
    }

    if (method === 'POST' && route[0] === 'notes') {
      const body = await readRequestBody(request)
      const repo = String(body?.repo ?? '')
      const note = String(body?.note ?? '')

      if (!repo) {
        sendJson(response, 400, { error: 'Invalid note payload' })
        return
      }

      const feedbackMap = await upsertNote(repo, note)
      sendJson(response, 200, { feedback: feedbackMap[repo] ?? null })
      return
    }

    if (method === 'POST' && route[0] === 'rating') {
      const body = await readRequestBody(request)
      const repo = String(body?.repo ?? '')
      const rawRating = body?.rating
      const rating = rawRating === null || rawRating === undefined ? null : Number(rawRating)

      if (!repo || (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5))) {
        sendJson(response, 400, { error: 'Invalid rating payload' })
        return
      }

      const feedbackMap = await upsertRating(repo, rating)
      sendJson(response, 200, { feedback: feedbackMap[repo] ?? null })
      return
    }

    if (method === 'POST' && route[0] === 'settings') {
      const body = await readRequestBody(request)
      const settings = await writeSettings({
        providerName: String(body?.providerName ?? ''),
        baseUrl: String(body?.baseUrl ?? ''),
        apiKey: String(body?.apiKey ?? ''),
      })
      sendJson(response, 200, { settings })
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error'
    sendJson(response, 500, { error: message })
  }
}

function parseRoute(url) {
  const { pathname } = new URL(url ?? '/', 'http://localhost')
  const normalized = pathname.replace(/^\/api\/?/, '/')
  return normalized.split('/').filter(Boolean)
}

async function listReportDates() {
  await ensureRuntimeDataDir()
  try {
    const files = await readdir(path.join(bundledDataRoot, 'reports'))
    return files
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .map((file) => file.replace('.json', ''))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

async function readReport(date) {
  try {
    const report = JSON.parse(await readFile(path.join(bundledDataRoot, 'reports', `${date}.json`), 'utf8'))
    const feedback = await readFeedback()
    return { ...report, items: applyFeedback(report.items ?? [], feedback) }
  } catch {
    return null
  }
}

async function listFavoriteItems() {
  const feedback = await readFeedback()
  const reports = new Map((await readAllReportItems()).map((item) => [item.repo, item]))
  return Object.entries(feedback)
    .filter(([, entry]) => entry.feedback === 'favorite')
    .map(([repo, entry]) => ({
      ...fallbackSavedItem(repo),
      ...reports.get(repo),
      feedback: 'favorite',
      note: entry.note,
      rating: entry.rating,
    }))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name))
}

async function listNotedItems() {
  const feedback = await readFeedback()
  const reports = new Map((await readAllReportItems()).map((item) => [item.repo, item]))
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

async function readAllReportItems() {
  const dates = await listReportDates()
  const seen = new Set()
  const items = []

  for (const date of dates) {
    const report = await readReport(date)
    for (const item of report?.items ?? []) {
      if (!seen.has(item.repo)) {
        seen.add(item.repo)
        items.push(item)
      }
    }
  }

  return items
}

function applyFeedback(items, feedback) {
  return items.map((item) => ({
    ...item,
    feedback: feedback[item.repo]?.feedback ?? null,
    note: feedback[item.repo]?.note,
    rating: feedback[item.repo]?.rating,
  }))
}

async function readFeedback() {
  await ensureRuntimeDataDir()
  try {
    return JSON.parse(await readFile(path.join(runtimeDataRoot, 'feedback.json'), 'utf8'))
  } catch {
    return {}
  }
}

async function upsertFeedback(repo, value) {
  const feedback = await readFeedback()
  if (value === null) {
    if (feedback[repo]?.note || feedback[repo]?.rating) {
      delete feedback[repo].feedback
      delete feedback[repo].updatedAt
    } else {
      delete feedback[repo]
    }
  } else {
    feedback[repo] = { ...feedback[repo], ...value }
  }
  await writeJson(path.join(runtimeDataRoot, 'feedback.json'), feedback)
  return feedback
}

async function upsertNote(repo, note) {
  const feedback = await readFeedback()
  const trimmed = note.trim()

  if (!trimmed) {
    if (feedback[repo]?.feedback || feedback[repo]?.rating) {
      delete feedback[repo].note
      delete feedback[repo].noteUpdatedAt
    } else {
      delete feedback[repo]
    }
  } else {
    feedback[repo] = { ...feedback[repo], note: trimmed, noteUpdatedAt: new Date().toISOString() }
  }

  await writeJson(path.join(runtimeDataRoot, 'feedback.json'), feedback)
  return feedback
}

async function upsertRating(repo, rating) {
  const feedback = await readFeedback()

  if (rating === null) {
    if (feedback[repo]?.feedback || feedback[repo]?.note) {
      delete feedback[repo].rating
      delete feedback[repo].ratingUpdatedAt
    } else {
      delete feedback[repo]
    }
  } else {
    feedback[repo] = { ...feedback[repo], rating, ratingUpdatedAt: new Date().toISOString() }
  }

  await writeJson(path.join(runtimeDataRoot, 'feedback.json'), feedback)
  return feedback
}

async function readRawSettings() {
  try {
    const settings = JSON.parse(await readFile(path.join(runtimeDataRoot, 'settings.local.json'), 'utf8'))
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

async function readSettings() {
  const settings = await readRawSettings()
  return {
    providerName: settings?.providerName ?? '',
    baseUrl: settings?.baseUrl ?? '',
    hasApiKey: Boolean(settings?.apiKey),
  }
}

async function writeSettings(settings) {
  await ensureRuntimeDataDir()
  const existing = await readRawSettings()
  const next = {
    providerName: settings.providerName.trim(),
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: settings.apiKey.trim() || existing?.apiKey || '',
  }

  if (!next.providerName || !next.baseUrl || !next.apiKey) {
    throw new Error('Provider name, Base URL and APIK are required')
  }

  await writeJson(path.join(runtimeDataRoot, 'settings.local.json'), next)
  return {
    providerName: next.providerName,
    baseUrl: next.baseUrl,
    hasApiKey: true,
  }
}

function fallbackSavedItem(repo) {
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

async function readRequestBody(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body
  }

  if (typeof request.body === 'string') {
    return request.body ? JSON.parse(request.body) : {}
  }

  if (Buffer.isBuffer(request.body)) {
    const raw = request.body.toString('utf8')
    return raw ? JSON.parse(raw) : {}
  }

  const raw = await new Promise((resolve, reject) => {
    let value = ''
    request.on('data', (chunk) => {
      value += chunk
    })
    request.on('end', () => resolve(value))
    request.on('error', reject)
  })

  return raw ? JSON.parse(raw) : {}
}

async function ensureRuntimeDataDir() {
  await mkdir(runtimeDataRoot, { recursive: true })
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sendJson(response, status, payload) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}
