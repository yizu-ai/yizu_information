import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { collectSources } from './sourceCollector'
import { readSourceReport, writeSourceSettings } from './storage'
import type { SourceCollector, SourceReport } from './types'
import { wechatSettingsFingerprint } from './wechatSource'

let tempDir: string | undefined

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true })
    tempDir = undefined
  }
})

function report(sourceKey: SourceReport['sourceKey'], itemId: string, count = 1): SourceReport {
  return {
    sourceKey,
    date: '2026-05-24',
    generatedAt: '2026-05-24T10:00:00+08:00',
    warnings: [],
    items: Array.from({ length: count }, (_, index) => ({
        sourceKey,
        itemId: count === 1 ? itemId : `${itemId}-${index}`,
        title: count === 1 ? itemId : `${itemId}-${index}`,
        originalUrl: `https://example.com/${count === 1 ? itemId : `${itemId}-${index}`}`,
        contentSummary: '1. 内容摘要',
        essenceSummary: '精华总结',
        summaryStatus: 'success',
        collectedAt: '2026-05-24T10:00:00+08:00',
      })),
  }
}

describe('collectSources', () => {
  it('continues after one source fails and skips successful sources on rerun', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    const github: SourceCollector = vi.fn(async () => report('github', 'github:repo', 20))
    const x: SourceCollector = vi.fn(async () => report('x', 'x:post'))
    const shengcai: SourceCollector = vi.fn(async () => {
      throw new Error('需要重新登录生财有术')
    })

    const firstRun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { github, x, shengcai },
      sourceOrder: ['github', 'x', 'shengcai'],
    })

    expect(firstRun.results).toMatchObject([
      { sourceKey: 'github', status: 'success', itemCount: 20 },
      { sourceKey: 'x', status: 'success', itemCount: 1 },
      { sourceKey: 'shengcai', status: 'failed', message: '需要重新登录生财有术' },
    ])
    await expect(readSourceReport('x', '2026-05-24', tempDir)).resolves.toMatchObject({ sourceKey: 'x' })

    const secondRun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { github, x, shengcai },
      sourceOrder: ['github', 'x', 'shengcai'],
    })

    expect(secondRun.results).toMatchObject([
      { sourceKey: 'github', status: 'skipped' },
      { sourceKey: 'x', status: 'skipped' },
      { sourceKey: 'shengcai', status: 'failed' },
    ])
    expect(github).toHaveBeenCalledTimes(1)
    expect(x).toHaveBeenCalledTimes(1)
    expect(shengcai).toHaveBeenCalledTimes(2)
  })

  it('retries same-day WeChat reports that only contain non-article links', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    const staleReport: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: [],
      items: [
        {
          sourceKey: 'wechat',
          itemId: 'wechat:sogou-home',
          title: 'Sogou home',
          originalUrl: 'https://weixin.sogou.com/',
          contentSummary: 'not an article',
          essenceSummary: 'not an article',
          summaryStatus: 'success',
          collectedAt: '2026-05-24T10:00:00+08:00',
        },
      ],
    }
    const fixedReport: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:05:00+08:00',
      warnings: [],
      items: [
        {
          sourceKey: 'wechat',
          itemId: 'wechat:article',
          title: 'Article',
          originalUrl: 'https://mp.weixin.qq.com/s/abc123',
          contentSummary: 'summary',
          essenceSummary: 'essence',
          summaryStatus: 'success',
          collectedAt: '2026-05-24T10:05:00+08:00',
        },
      ],
    }
    const staleWechat: SourceCollector = vi.fn(async () => staleReport)
    const fixedWechat: SourceCollector = vi.fn(async () => fixedReport)

    await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat: staleWechat },
      sourceOrder: ['wechat'],
    })
    const rerun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat: fixedWechat },
      sourceOrder: ['wechat'],
    })

    expect(rerun.results).toMatchObject([{ sourceKey: 'wechat', status: 'success', itemCount: 1 }])
    await expect(readSourceReport('wechat', '2026-05-24', tempDir)).resolves.toMatchObject({
      items: [{ originalUrl: 'https://mp.weixin.qq.com/s/abc123' }],
    })
  })

  it('skips same-day WeChat reports when the API already confirmed no updates', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    await writeSourceSettings({ wechat: { accounts: ['测试公众号'] } }, tempDir)
    const noUpdateReport: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: ['今日没有新文章'],
      emptyReason: 'no_updates',
      settingsFingerprint: wechatSettingsFingerprint(['测试公众号']),
      items: [],
    }
    const wechat: SourceCollector = vi.fn(async () => noUpdateReport)

    const firstRun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat },
      sourceOrder: ['wechat'],
    })
    const secondRun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat },
      sourceOrder: ['wechat'],
    })

    expect(firstRun.results).toMatchObject([
      { sourceKey: 'wechat', status: 'success', itemCount: 0, message: '今日没有新文章' },
    ])
    expect(secondRun.results).toMatchObject([{ sourceKey: 'wechat', status: 'skipped', itemCount: 0 }])
    expect(wechat).toHaveBeenCalledTimes(1)
  })

  it('retries same-day WeChat no-update reports that were saved before account fingerprints existed', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    await writeSourceSettings({ wechat: { accounts: ['新公众号'] } }, tempDir)
    const oldNoUpdateReport: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: ['今日没有新文章'],
      emptyReason: 'no_updates',
      items: [],
    }
    const freshReport: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:05:00+08:00',
      warnings: [],
      settingsFingerprint: wechatSettingsFingerprint(['新公众号']),
      items: [
        {
          sourceKey: 'wechat',
          itemId: 'wechat:new-article',
          title: '新公众号今日文章',
          originalUrl: 'https://mp.weixin.qq.com/s/new-article',
          contentSummary: '1. 新文章重点',
          essenceSummary: '适合继续打开阅读。',
          summaryStatus: 'success',
          collectedAt: '2026-05-24T10:05:00+08:00',
        },
      ],
    }
    const oldWechat: SourceCollector = vi.fn(async () => oldNoUpdateReport)
    const freshWechat: SourceCollector = vi.fn(async () => freshReport)

    await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat: oldWechat },
      sourceOrder: ['wechat'],
    })
    const rerun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat: freshWechat },
      sourceOrder: ['wechat'],
    })

    expect(rerun.results).toMatchObject([{ sourceKey: 'wechat', status: 'success', itemCount: 1 }])
    expect(freshWechat).toHaveBeenCalledTimes(1)
  })

  it('retries same-day WeChat reports when configured accounts changed', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    await writeSourceSettings({ wechat: { accounts: ['刘小排r', '花叔'] } }, tempDir)
    const oldNoUpdateReport: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: ['今日没有新文章'],
      emptyReason: 'no_updates',
      settingsFingerprint: wechatSettingsFingerprint(['刘小排r', '花叔']),
      items: [],
    }
    const newAccountsReport: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:05:00+08:00',
      warnings: [],
      settingsFingerprint: wechatSettingsFingerprint(['刘小排r', '花叔', '新公众号']),
      items: [
        {
          sourceKey: 'wechat',
          itemId: 'wechat:new-account-article',
          title: '新增公众号今日文章',
          originalUrl: 'https://mp.weixin.qq.com/s/new-account-article',
          contentSummary: '1. 新增公众号文章重点',
          essenceSummary: '适合继续打开阅读。',
          summaryStatus: 'success',
          collectedAt: '2026-05-24T10:05:00+08:00',
        },
      ],
    }
    const oldWechat: SourceCollector = vi.fn(async () => oldNoUpdateReport)
    const newWechat: SourceCollector = vi.fn(async () => newAccountsReport)

    await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat: oldWechat },
      sourceOrder: ['wechat'],
    })
    await writeSourceSettings({ wechat: { accounts: ['刘小排r', '花叔', '新公众号'] } }, tempDir)
    const rerun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat: newWechat },
      sourceOrder: ['wechat'],
    })

    expect(rerun.results).toMatchObject([{ sourceKey: 'wechat', status: 'success', itemCount: 1 }])
    expect(newWechat).toHaveBeenCalledTimes(1)
  })

  it('retries same-day Shengcai reports with failed summaries', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    const staleReport: SourceReport = {
      sourceKey: 'shengcai',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: [],
      items: Array.from({ length: 10 }, (_, index) => ({
        sourceKey: 'shengcai',
        itemId: `shengcai:${index}`,
        title: `Topic ${index}`,
        originalUrl: `https://scys.com/articleDetail/xq_topic/${index}`,
        contentSummary: '1. summary',
        essenceSummary: 'AI 总结暂不可用，建议先打开原文。',
        summaryStatus: index === 0 ? 'failed' : 'success',
        summaryError: index === 0 ? 'DeepSeek response is not a JSON object with items' : undefined,
        collectedAt: '2026-05-24T10:00:00+08:00',
      })),
    }
    const fixedReport: SourceReport = {
      ...staleReport,
      generatedAt: '2026-05-24T10:05:00+08:00',
      items: staleReport.items.map((item) => ({
        ...item,
        summaryStatus: 'success',
        summaryError: undefined,
        essenceSummary: '这篇值得结合项目方法论继续阅读。',
      })),
    }
    const staleShengcai: SourceCollector = vi.fn(async () => staleReport)
    const fixedShengcai: SourceCollector = vi.fn(async () => fixedReport)

    await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { shengcai: staleShengcai },
      sourceOrder: ['shengcai'],
    })
    const rerun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { shengcai: fixedShengcai },
      sourceOrder: ['shengcai'],
    })

    expect(rerun.results).toMatchObject([{ sourceKey: 'shengcai', status: 'success', itemCount: 10 }])
    expect(fixedShengcai).toHaveBeenCalledTimes(1)
    const savedReport = await readSourceReport('shengcai', '2026-05-24', tempDir)
    expect(savedReport?.items.every((item) => item.summaryStatus === 'success' && !item.summaryError)).toBe(true)
  })

  it('skips same-day valid Shengcai reports even when fewer than ten items were collected', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    const partialReport: SourceReport = {
      sourceKey: 'shengcai',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: [],
      items: Array.from({ length: 3 }, (_, index) => ({
        sourceKey: 'shengcai',
        itemId: `shengcai:${index}`,
        title: `Topic ${index}`,
        originalUrl: `https://scys.com/articleDetail/xq_topic/${index}`,
        contentSummary: '1. Main point\n2. Supporting point',
        essenceSummary: 'Worth opening if the topic matches current work.',
        summaryStatus: 'success',
        collectedAt: '2026-05-24T10:00:00+08:00',
      })),
    }
    const replacementReport: SourceReport = {
      ...partialReport,
      generatedAt: '2026-05-24T10:05:00+08:00',
      items: Array.from({ length: 10 }, (_, index) => ({
        sourceKey: 'shengcai',
        itemId: `shengcai:new-${index}`,
        title: `New Topic ${index}`,
        originalUrl: `https://scys.com/articleDetail/xq_topic/new-${index}`,
        contentSummary: '1. Different point\n2. Different supporting point',
        essenceSummary: 'This should not replace the existing same-day report.',
        summaryStatus: 'success',
        collectedAt: '2026-05-24T10:05:00+08:00',
      })),
    }
    const firstShengcai: SourceCollector = vi.fn(async () => partialReport)
    const secondShengcai: SourceCollector = vi.fn(async () => replacementReport)

    const firstRun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { shengcai: firstShengcai },
      sourceOrder: ['shengcai'],
    })
    const secondRun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { shengcai: secondShengcai },
      sourceOrder: ['shengcai'],
    })

    expect(firstRun.results).toMatchObject([{ sourceKey: 'shengcai', status: 'success', itemCount: 3 }])
    expect(secondRun.results).toMatchObject([{ sourceKey: 'shengcai', status: 'skipped', itemCount: 3 }])
    expect(firstShengcai).toHaveBeenCalledTimes(1)
    expect(secondShengcai).not.toHaveBeenCalled()
    await expect(readSourceReport('shengcai', '2026-05-24', tempDir)).resolves.toMatchObject({
      items: [{ title: 'Topic 0' }, { title: 'Topic 1' }, { title: 'Topic 2' }],
    })
  })

  it('retries same-day GitHub reports that still have one-sentence summaries', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    const staleReport: SourceReport = {
      sourceKey: 'github',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: [],
      items: Array.from({ length: 20 }, (_, index) => ({
        sourceKey: 'github',
        itemId: `github:owner/repo-${index}`,
        title: `repo-${index}`,
        originalUrl: `https://github.com/owner/repo-${index}`,
        contentSummary: '提供 AI Agent、工具调用或记忆管理相关能力。',
        essenceSummary: '建议先看 README。',
        summaryStatus: 'success',
        collectedAt: '2026-05-24T10:00:00+08:00',
      })),
    }
    const fixedReport: SourceReport = {
      ...staleReport,
      generatedAt: '2026-05-24T10:05:00+08:00',
      items: staleReport.items.map((item) => ({
        ...item,
        contentSummary: '1. 项目定位\n2. 核心功能\n3. 评估线索',
      })),
    }
    const staleGithub: SourceCollector = vi.fn(async () => staleReport)
    const fixedGithub: SourceCollector = vi.fn(async () => fixedReport)

    await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { github: staleGithub },
      sourceOrder: ['github'],
    })
    const rerun = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { github: fixedGithub },
      sourceOrder: ['github'],
    })

    expect(rerun.results).toMatchObject([{ sourceKey: 'github', status: 'success', itemCount: 20 }])
    expect(fixedGithub).toHaveBeenCalledTimes(1)
  })

  it('treats empty reports as retryable failures', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'source-collector-'))
    const emptyReport: SourceReport = {
      sourceKey: 'wechat',
      date: '2026-05-24',
      generatedAt: '2026-05-24T10:00:00+08:00',
      warnings: ['No articles found'],
      items: [],
    }
    const emptyWechat: SourceCollector = vi.fn(async () => emptyReport)

    const result = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat: emptyWechat },
      sourceOrder: ['wechat'],
    })

    expect(result.results).toMatchObject([
      { sourceKey: 'wechat', status: 'failed', itemCount: 0, message: 'No articles found' },
    ])
  })
})
