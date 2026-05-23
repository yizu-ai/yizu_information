import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  listFavoriteItems,
  listNotedItems,
  readFeedback,
  readSettings,
  upsertFeedback,
  upsertNote,
  upsertRating,
  writeFeedback,
  writeSettings,
} from './storage'

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true })
    tempDir = undefined
  }
})

describe('feedback storage', () => {
  it('creates feedback.json and reads saved feedback back', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'daily-report-agent-'))

    await writeFeedback(tempDir, {
      'owner/repo': {
        feedback: 'favorite',
        updatedAt: '2026-05-23T10:00:00+08:00',
      },
    })

    await expect(readFeedback(tempDir)).resolves.toEqual({
      'owner/repo': {
        feedback: 'favorite',
        updatedAt: '2026-05-23T10:00:00+08:00',
      },
    })
  })

  it('removes feedback when the value is null', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'daily-report-agent-'))

    await upsertFeedback(
      'owner/repo',
      {
        feedback: 'favorite',
        updatedAt: '2026-05-23T10:00:00+08:00',
      },
      tempDir,
    )
    await upsertFeedback('owner/repo', null, tempDir)

    await expect(readFeedback(tempDir)).resolves.toEqual({})
  })

  it('keeps notes when toggling feedback and lists favorites and noted items', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'daily-report-agent-'))

    await upsertFeedback(
      'owner/repo',
      {
        feedback: 'favorite',
        updatedAt: '2026-05-23T10:00:00+08:00',
      },
      tempDir,
    )
    await upsertNote('owner/repo', '值得研究它的工作流设计', tempDir)

    await expect(readFeedback(tempDir)).resolves.toMatchObject({
      'owner/repo': {
        feedback: 'favorite',
        note: '值得研究它的工作流设计',
      },
    })

    await expect(listFavoriteItems(tempDir)).resolves.toMatchObject([
      { repo: 'owner/repo', note: '值得研究它的工作流设计' },
    ])
    await expect(listNotedItems(tempDir)).resolves.toMatchObject([
      { repo: 'owner/repo', note: '值得研究它的工作流设计' },
    ])
  })

  it('keeps ratings and sorts favorites from high to low', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'daily-report-agent-'))

    await upsertFeedback('owner/low', { feedback: 'favorite', updatedAt: '2026-05-23T10:00:00+08:00' }, tempDir)
    await upsertFeedback('owner/high', { feedback: 'favorite', updatedAt: '2026-05-23T10:00:00+08:00' }, tempDir)
    await upsertRating('owner/low', 2, tempDir)
    await upsertRating('owner/high', 5, tempDir)

    await expect(listFavoriteItems(tempDir)).resolves.toMatchObject([
      { repo: 'owner/high', rating: 5 },
      { repo: 'owner/low', rating: 2 },
    ])
  })

  it('stores API settings locally and masks the API key when reading', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'daily-report-agent-'))

    await writeSettings(
      {
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'secret-key',
      },
      tempDir,
    )

    await expect(readSettings(tempDir)).resolves.toEqual({
      providerName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      hasApiKey: true,
    })
  })
})
