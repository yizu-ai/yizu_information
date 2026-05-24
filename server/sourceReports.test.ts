import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  listFavoriteItems,
  listSourceReportDates,
  deleteSourceReport,
  readSourceSettings,
  readSourceReport,
  saveSourceReport,
  upsertFeedback,
  upsertNote,
  upsertRating,
  writeSourceSettings,
} from './storage'
import type { SourceReport } from './types'

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true })
    tempDir = undefined
  }
})

describe('source settings storage', () => {
  it('persists per-source collection switches', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-settings-'))

    await expect(readSourceSettings(tempDir)).resolves.toMatchObject({
      enabledSources: {
        shengcai: true,
        wechat: true,
        x: true,
        github: true,
      },
    })

    await writeSourceSettings(
      { enabledSources: { shengcai: true, wechat: false, x: true, github: true } },
      tempDir,
    )

    await expect(readSourceSettings(tempDir)).resolves.toMatchObject({
      enabledSources: {
        shengcai: true,
        wechat: false,
        x: true,
        github: true,
      },
    })
  })

  it('stores the Dajiala key locally without exposing it in public settings', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-settings-'))

    await writeSourceSettings({ wechat: { accounts: ['测试公众号'], dajialaApiKey: 'JZL-test-dajiala-key' } }, tempDir)

    await expect(readSourceSettings(tempDir)).resolves.toMatchObject({
      wechat: {
        accounts: ['测试公众号'],
        hasDajialaApiKey: true,
      },
    })
    await expect(readSourceSettings(tempDir)).resolves.not.toHaveProperty('wechat.dajialaApiKey')
  })

  it('rejects X Bearer Tokens saved as Dajiala keys', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-settings-'))

    await expect(
      writeSourceSettings({ wechat: { accounts: ['测试公众号'], dajialaApiKey: 'FAKE-X-BEARER-TOKEN-VALUE' } }, tempDir),
    ).rejects.toThrow('极致了 API Key 格式不对')
  })

  it('deletes one source report date without touching other dates', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-report-delete-'))
    const makeReport = (date: string): SourceReport => ({
      sourceKey: 'wechat',
      date,
      generatedAt: `${date}T10:00:00+08:00`,
      warnings: [],
      items: [],
    })

    await saveSourceReport(makeReport('2026-05-23'), tempDir)
    await saveSourceReport(makeReport('2026-05-24'), tempDir)

    await expect(deleteSourceReport('wechat', '2026-05-23', tempDir)).resolves.toBe(true)
    await expect(readSourceReport('wechat', '2026-05-23', tempDir)).resolves.toBeNull()
    await expect(listSourceReportDates('wechat', tempDir)).resolves.toEqual(['2026-05-24'])
  })
})

describe('source report storage', () => {
  it('stores independent source reports and applies feedback by source item id', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-report-storage-'))
    const report: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: [],
      items: [
        {
          sourceKey: 'wechat',
          itemId: 'wechat:ai-weekly:article-1',
          title: 'AI 周报',
          authorName: 'AI Weekly',
          publishedAt: '2026-05-24',
          originalUrl: 'https://mp.weixin.qq.com/s/article-1',
          contentSummary: '本周 AI 工具更新概览。',
          essenceSummary: '重点关注 Agent 工作流和开源工具。',
          summaryStatus: 'success',
          collectedAt: '2026-05-24T10:00:00+08:00',
        },
      ],
    }

    await saveSourceReport(report, tempDir)
    await upsertFeedback('wechat:ai-weekly:article-1', { feedback: 'favorite', updatedAt: report.generatedAt }, tempDir)
    await upsertRating('wechat:ai-weekly:article-1', 5, tempDir)
    await upsertNote('wechat:ai-weekly:article-1', '后续深入研究 Agent 工作流', tempDir)

    await expect(readSourceReport('wechat', '2026-05-24', tempDir)).resolves.toMatchObject({
      sourceKey: 'wechat',
      items: [
        {
          itemId: 'wechat:ai-weekly:article-1',
          feedback: 'favorite',
          rating: 5,
          note: '后续深入研究 Agent 工作流',
        },
      ],
    })
    await expect(listFavoriteItems(tempDir)).resolves.toMatchObject([
      {
        sourceKey: 'wechat',
        itemId: 'wechat:ai-weekly:article-1',
        feedback: 'favorite',
        rating: 5,
      },
    ])
  })
})
