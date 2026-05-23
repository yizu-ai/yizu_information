import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createApp } from './app'
import { readFeedback, saveReport } from './storage'
import type { DailyReport } from './types'

type BootstrapPayload = {
  dates: string[]
  report: DailyReport
}

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true })
    tempDir = undefined
  }
})

describe('local report API', () => {
  it('returns available report dates and saves feedback', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'daily-report-agent-api-'))
    const report: DailyReport = {
      date: '2026-05-23',
      generatedAt: '2026-05-23T10:00:00+08:00',
      source: 'GitHub Trending',
      warnings: [],
      items: [
        {
          rank: 1,
          repo: 'owner/repo',
          name: 'repo',
          url: 'https://github.com/owner/repo',
          description: 'Agent workflow toolkit',
          language: 'TypeScript',
          stars: 100,
          todayStars: 20,
          score: 120,
          matchedTracks: ['个人 AI 系统'],
          nameZh: '智能体工作流工具',
          brief: '用于搭建 Agent 工作流。',
          useAdvice: '建议先看它的工具调用设计。',
          feedback: null,
        },
      ],
    }
    await saveReport(report, tempDir)

    const app = createApp({ dataDir: tempDir })
    const server = app.listen(0)
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a local test port')
    }

    try {
      const baseUrl = `http://127.0.0.1:${address.port}`
      const bootstrap = (await fetch(`${baseUrl}/api/bootstrap`).then((res) =>
        res.json(),
      )) as BootstrapPayload

      expect(bootstrap.dates).toEqual(['2026-05-23'])
      expect(bootstrap.report.items[0].repo).toBe('owner/repo')

      const feedbackResponse = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'owner/repo',
          feedback: 'favorite',
        }),
      })

      expect(feedbackResponse.status).toBe(200)
      await expect(readFeedback(tempDir)).resolves.toMatchObject({
        'owner/repo': { feedback: 'favorite' },
      })

      const clearResponse = await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'owner/repo',
          feedback: null,
        }),
      })

      expect(clearResponse.status).toBe(200)
      await expect(readFeedback(tempDir)).resolves.toEqual({})

      const settingsResponse = await fetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          apiKey: 'secret-key',
        }),
      })
      expect(settingsResponse.status).toBe(200)

      const settings = (await fetch(`${baseUrl}/api/settings`).then((res) => res.json())) as {
        settings: { providerName: string; baseUrl: string; hasApiKey: boolean; apiKey?: string }
      }
      expect(settings.settings).toEqual({
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        hasApiKey: true,
      })

      await fetch(`${baseUrl}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'owner/repo',
          feedback: 'favorite',
        }),
      })
      await fetch(`${baseUrl}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'owner/repo',
          note: '后续研究它的 Agent 设计',
        }),
      })
      const ratingResponse = await fetch(`${baseUrl}/api/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: 'owner/repo',
          rating: 5,
        }),
      })
      expect(ratingResponse.status).toBe(200)
      const favorites = (await fetch(`${baseUrl}/api/favorites`).then((res) => res.json())) as {
        items: Array<{ repo: string; note?: string; rating?: number }>
      }
      const notes = (await fetch(`${baseUrl}/api/notes`).then((res) => res.json())) as {
        items: Array<{ repo: string; note?: string }>
      }

      expect(favorites.items).toMatchObject([{ repo: 'owner/repo', note: '后续研究它的 Agent 设计', rating: 5 }])
      expect(notes.items).toMatchObject([{ repo: 'owner/repo', note: '后续研究它的 Agent 设计' }])
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})
