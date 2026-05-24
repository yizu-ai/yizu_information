import express from 'express'

import { collectSources, createDefaultCollectors } from './sourceCollector'
import {
  deleteReport,
  deleteSourceReport,
  listFavoriteItems,
  listNotedItems,
  listReportDates,
  listSourceReportDates,
  readReport,
  readRawSourceSettings,
  readSettings,
  readSourceReport,
  readSourceSettings,
  upsertFeedback,
  upsertNote,
  upsertRating,
  writeSettings,
  writeSourceSettings,
} from './storage'
import type { FeedbackValue, SourceKey, SourceSettingsPatch } from './types'

type CreateAppOptions = {
  dataDir?: string
}

const allowedFeedback = new Set<FeedbackValue>(['favorite', 'ignore', 'irrelevant'])
const allowedSources = new Set<SourceKey>(['shengcai', 'wechat', 'x', 'github'])

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const dataDir = options.dataDir

  app.use(express.json())

  app.get('/api/bootstrap', async (_request, response, next) => {
    try {
      const dates = await listReportDates(dataDir)
      const activeDate = dates[0] ?? null
      const report = activeDate ? await readReport(activeDate, dataDir) : null
      response.json({ dates, activeDate, report })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/report', async (request, response, next) => {
    try {
      const date = String(request.query.date ?? '')
      const report = await readReport(date, dataDir)
      if (!report) {
        response.status(404).json({ error: 'Report not found' })
        return
      }
      response.json({ report })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/source-bootstrap', async (request, response, next) => {
    try {
      const source = parseSource(request.query.source)
      if (!source) {
        response.status(400).json({ error: 'Invalid source' })
        return
      }
      const dates = await listSourceReportDates(source, dataDir)
      const activeDate = dates[0] ?? null
      const report = activeDate ? await readSourceReport(source, activeDate, dataDir) : null
      response.json({ dates, activeDate, report })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/source-report', async (request, response, next) => {
    try {
      const source = parseSource(request.query.source)
      const date = String(request.query.date ?? '')
      if (!source || !date) {
        response.status(400).json({ error: 'Invalid source report request' })
        return
      }
      const report = await readSourceReport(source, date, dataDir)
      if (!report) {
        response.status(404).json({ error: 'Source report not found' })
        return
      }
      response.json({ report })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/report', async (request, response, next) => {
    try {
      const date = String(request.query.date ?? '')
      if (!isReportDate(date)) {
        response.status(400).json({ error: 'Invalid report date' })
        return
      }

      const deleted = await deleteReport(date, dataDir)
      if (!deleted) {
        response.status(404).json({ error: 'Report not found' })
        return
      }
      await deleteSourceReport('github', date, dataDir)
      response.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  app.delete('/api/source-report', async (request, response, next) => {
    try {
      const source = parseSource(request.query.source)
      const date = String(request.query.date ?? '')
      if (!source || !isReportDate(date)) {
        response.status(400).json({ error: 'Invalid source report request' })
        return
      }

      const deleted = await deleteSourceReport(source, date, dataDir)
      if (!deleted) {
        response.status(404).json({ error: 'Source report not found' })
        return
      }
      response.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/collect', async (_request, response, next) => {
    try {
      const date = new Date().toISOString().slice(0, 10)
      const sourceSettings = await readRawSourceSettings(dataDir)
      const sourceOrder = (['shengcai', 'wechat', 'github', 'x'] as const).filter(
        (source) => sourceSettings.enabledSources[source],
      )
      const result = await collectSources({
        date,
        dataDir,
        collectors: createDefaultCollectors(),
        sourceOrder,
      })
      response.json({ result })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/reports/:date', async (request, response, next) => {
    try {
      const report = await readReport(request.params.date, dataDir)
      if (!report) {
        response.status(404).json({ error: 'Report not found' })
        return
      }
      response.json({ report })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/feedback', async (request, response, next) => {
    try {
      const repo = String(request.body?.repo ?? '')
      const feedback = request.body?.feedback as FeedbackValue | null | undefined

      if (!repo || (feedback !== null && (!feedback || !allowedFeedback.has(feedback)))) {
        response.status(400).json({ error: 'Invalid feedback payload' })
        return
      }

      const feedbackMap = await upsertFeedback(
        repo,
        feedback === null ? null : { feedback, updatedAt: new Date().toISOString() },
        dataDir,
      )
      response.json({ feedback: feedbackMap[repo] ?? null })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/favorites', async (_request, response, next) => {
    try {
      response.json({ items: await listFavoriteItems(dataDir) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/notes', async (_request, response, next) => {
    try {
      response.json({ items: await listNotedItems(dataDir) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/notes', async (request, response, next) => {
    try {
      const repo = String(request.body?.repo ?? '')
      const note = String(request.body?.note ?? '')

      if (!repo) {
        response.status(400).json({ error: 'Invalid note payload' })
        return
      }

      const feedbackMap = await upsertNote(repo, note, dataDir)
      response.json({ feedback: feedbackMap[repo] ?? null })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/rating', async (request, response, next) => {
    try {
      const repo = String(request.body?.repo ?? '')
      const rawRating = request.body?.rating
      const rating = rawRating === null ? null : Number(rawRating)

      if (!repo || (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5))) {
        response.status(400).json({ error: 'Invalid rating payload' })
        return
      }

      const feedbackMap = await upsertRating(repo, rating, dataDir)
      response.json({ feedback: feedbackMap[repo] ?? null })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/settings', async (_request, response, next) => {
    try {
      response.json({ settings: await readSettings(dataDir) })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/source-settings', async (_request, response, next) => {
    try {
      response.json({ settings: await readSourceSettings(dataDir) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/source-settings', async (request, response, next) => {
    try {
      const settings = request.body?.settings as SourceSettingsPatch | undefined
      if (!settings || typeof settings !== 'object') {
        response.status(400).json({ error: 'Invalid source settings payload' })
        return
      }
      response.json({ settings: await writeSourceSettings(settings, dataDir) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/settings', async (request, response, next) => {
    try {
      const settings = await writeSettings(
        {
          providerName: String(request.body?.providerName ?? ''),
          baseUrl: String(request.body?.baseUrl ?? ''),
          apiKey: String(request.body?.apiKey ?? ''),
        },
        dataDir,
      )
      response.json({ settings })
    } catch (error) {
      next(error)
    }
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    void next
    const message = error instanceof Error ? error.message : 'Unknown server error'
    response.status(500).json({ error: message })
  })

  return app
}

function parseSource(value: unknown): SourceKey | null {
  const source = String(value ?? '') as SourceKey
  return allowedSources.has(source) ? source : null
}

function isReportDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}
