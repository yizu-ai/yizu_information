import { buildReport, summarizeLocally, type ProjectSummary } from './reportGenerator'
import { enrichRepositoryDetails, fetchTrendingProjects } from './githubTrending'
import { collectShengcaiSource } from './shengcaiSource'
import { collectWechatSource, wechatSettingsFingerprint } from './wechatSource'
import { collectXSource } from './xSource'
import { summarizeSourceItems } from './sourceSummarizer'
import {
  listSourceReportDates,
  readFeedback,
  readProfile,
  readRawSettings,
  readRawSourceSettings,
  readSourceReport,
  saveReport,
  saveSourceReport,
} from './storage'
import type { CollectSourcesResult, RankedProject, SourceCollector, SourceKey, SourceReport, SourceRunResult } from './types'

const defaultSourceOrder: SourceKey[] = ['shengcai', 'wechat', 'github', 'x']

export async function collectSources(input: {
  date: string
  dataDir?: string
  collectors: Partial<Record<SourceKey, SourceCollector>>
  sourceOrder?: SourceKey[]
}): Promise<CollectSourcesResult> {
  const startedAt = new Date().toISOString()
  const results: SourceRunResult[] = []

  const sourceOrder = input.sourceOrder ?? defaultSourceOrder.filter((sourceKey) => input.collectors[sourceKey])
  const currentSettings = await readRawSourceSettings(input.dataDir)
  for (const sourceKey of sourceOrder) {
    const existing = await readSourceReport(sourceKey, input.date, input.dataDir)
    if (existing && shouldSkipExistingReport(existing, currentSettings)) {
      results.push({
        sourceKey,
        status: 'skipped',
        itemCount: existing.items.length,
        lastSuccessAt: existing.generatedAt,
      })
      continue
    }

    const collector = input.collectors[sourceKey]
    if (!collector) {
      results.push({ sourceKey, status: 'failed', message: '采集器未配置' })
      continue
    }

    try {
      const lastSuccessAt = await getLastSuccessAt(sourceKey, input.dataDir, currentSettings)
      const report = await collector({ date: input.date, dataDir: input.dataDir, lastSuccessAt })
      await saveSourceReport(report, input.dataDir)
      if (report.items.length === 0) {
        if (report.emptyReason === 'no_updates') {
          results.push({
            sourceKey,
            status: 'success',
            itemCount: 0,
            message: report.warnings.at(-1) ?? '今日没有新文章',
            lastSuccessAt: report.generatedAt,
          })
          continue
        }
        results.push({
          sourceKey,
          status: 'failed',
          itemCount: 0,
          message: report.warnings.at(-1) ?? '没有采集到新内容，稍后可重试。',
        })
        continue
      }
      results.push({
        sourceKey,
        status: 'success',
        itemCount: report.items.length,
        lastSuccessAt: report.generatedAt,
      })
    } catch (error) {
      results.push({
        sourceKey,
        status: 'failed',
        message: error instanceof Error ? error.message : '采集失败',
      })
    }
  }

  return {
    date: input.date,
    startedAt,
    finishedAt: new Date().toISOString(),
    results,
  }
}

export function createPlaceholderCollector(sourceKey: SourceKey, message: string): SourceCollector {
  return async ({ date }) => ({
    sourceKey,
    date,
    generatedAt: new Date().toISOString(),
    warnings: [message],
    items: [],
  })
}

export const collectGitHubSource: SourceCollector = async ({ date, dataDir }) => {
  const profile = await readProfile(dataDir)
  const feedback = await readFeedback(dataDir)
  const projects = await enrichRepositoryDetails(await fetchTrendingProjects())
  const report = await buildReport({
    date,
    projects,
    profile,
    feedback,
    summarize: (items) => summarizeGitHubProjects(items, dataDir),
    warnings: [],
  })

  await saveReport(report, dataDir)

  return dailyReportToSourceReport(report)
}

export function createDefaultCollectors(): Record<SourceKey, SourceCollector> {
  return {
    github: collectGitHubSource,
    shengcai: collectShengcaiSource,
    wechat: collectWechatSource,
    x: collectXSource,
  }
}

function shouldSkipExistingReport(report: SourceReport, settings: Awaited<ReturnType<typeof readRawSourceSettings>>): boolean {
  if (report.items.length === 0) {
    if (report.emptyReason !== 'no_updates') {
      return false
    }
    if (report.sourceKey === 'wechat') {
      return report.settingsFingerprint === wechatSettingsFingerprint(settings.wechat.accounts)
    }
    return true
  }

  if (report.sourceKey === 'wechat') {
    return (
      report.settingsFingerprint === wechatSettingsFingerprint(settings.wechat.accounts) &&
      report.items.every((item) => isWechatArticleUrl(item.originalUrl))
    )
  }

  if (report.sourceKey === 'shengcai') {
    return (
      report.items.every((item) => isShengcaiTopicUrl(item.originalUrl)) &&
      report.items.every((item) => hasOrderedContentSummary(item.contentSummary)) &&
      report.items.every((item) => item.summaryStatus === 'success' && !item.summaryError)
    )
  }

  if (report.sourceKey === 'github') {
    return report.items.length >= 20 && report.items.every((item) => hasOrderedContentSummary(item.contentSummary))
  }

  return true
}

function isShengcaiTopicUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.hostname === 'scys.com' && parsedUrl.pathname.startsWith('/articleDetail/xq_topic/')
  } catch {
    return false
  }
}

function hasOrderedContentSummary(summary: string): boolean {
  return /^\s*1\./.test(summary)
}

function isWechatArticleUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return parsedUrl.hostname === 'mp.weixin.qq.com' && (parsedUrl.pathname === '/s' || parsedUrl.pathname.startsWith('/s/'))
  } catch {
    return false
  }
}

async function getLastSuccessAt(
  sourceKey: SourceKey,
  dataDir: string | undefined,
  settings: Awaited<ReturnType<typeof readRawSourceSettings>>,
): Promise<string | undefined> {
  const dates = await listSourceReportDates(sourceKey, dataDir)
  for (const date of dates) {
    const report = await readSourceReport(sourceKey, date, dataDir)
    if (report?.generatedAt && shouldSkipExistingReport(report, settings)) {
      return report.generatedAt
    }
  }
  return undefined
}

function dailyReportToSourceReport(report: Awaited<ReturnType<typeof buildReport>>): SourceReport {
  return {
    sourceKey: 'github',
    date: report.date,
    generatedAt: report.generatedAt,
    warnings: report.warnings,
    items: report.items.map((item) => ({
      sourceKey: 'github',
      itemId: `github:${item.repo}`,
      title: item.nameZh || item.name,
      authorName: item.repo.split('/')[0],
      publishedAt: item.updatedAt,
      originalUrl: item.url,
      likes: item.todayStars,
      contentSummary: item.brief || item.summary || item.description,
      essenceSummary: item.useAdvice || item.relevanceReason || '',
      summaryStatus: 'success',
      collectedAt: report.generatedAt,
      feedback: item.feedback,
      note: item.note,
      rating: item.rating,
    })),
  }
}

async function summarizeGitHubProjects(items: RankedProject[], dataDir?: string): Promise<ProjectSummary[]> {
  const localSummaries = await summarizeLocally(items)
  const settings = await readRawSettings(dataDir)
  if (!settings) {
    return localSummaries
  }

  const sourceSummaries = await summarizeSourceItems(
    items.map((item) => ({
      sourceName: 'GitHub Trending',
      itemId: `github:${item.repo}`,
      title: item.name,
      authorName: item.repo.split('/')[0],
      publishedAt: item.updatedAt,
      originalUrl: item.url,
      rawText: buildGitHubSummaryInput(item),
    })),
    { sourceName: 'GitHub Trending', dataDir },
  )
  const sourceSummaryByRepo = new Map(
    sourceSummaries.map((summary) => [summary.itemId.replace(/^github:/, ''), summary]),
  )

  return localSummaries.map((localSummary) => {
    const sourceSummary = sourceSummaryByRepo.get(localSummary.repo)
    return {
      repo: localSummary.repo,
      nameZh: localSummary.nameZh,
      brief: sourceSummary?.contentSummary ?? localSummary.brief,
      useAdvice: sourceSummary?.essenceSummary ?? localSummary.useAdvice,
    }
  })
}

function buildGitHubSummaryInput(item: RankedProject): string {
  return [
    `仓库：${item.repo}`,
    `项目名称：${item.name}`,
    item.description ? `GitHub 描述：${item.description}` : '',
    item.language ? `主要语言：${item.language}` : '',
    item.topics?.length ? `Topics：${item.topics.join(', ')}` : '',
    `热度：累计 ${item.stars} stars，当日新增 ${item.todayStars} stars。`,
    item.readmeExcerpt ? `README 摘录：${item.readmeExcerpt}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
