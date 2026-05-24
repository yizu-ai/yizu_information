import { rankProjects, scoreProject } from './reportEngine'
import type { DailyReport, FeedbackMap, RankedProject, TrendingProject, UserProfile } from './types'

export type ProjectSummary = {
  repo: string
  nameZh: string
  brief: string
  useAdvice: string
}

export type SummarizeProjects = (items: RankedProject[], profile: UserProfile) => Promise<ProjectSummary[]>

type BuildReportInput = {
  date: string
  projects: TrendingProject[]
  profile: UserProfile
  feedback: FeedbackMap
  summarize: SummarizeProjects
  warnings?: string[]
}

const dailyTrendingProjectLimit = 20

export async function buildReport(input: BuildReportInput): Promise<DailyReport> {
  const dailyTopProjects = input.projects.slice(0, dailyTrendingProjectLimit)
  const visibleRanked = rankProjects(dailyTopProjects, input.profile, input.feedback, dailyTrendingProjectLimit)
  const visibleRepos = new Set(visibleRanked.map((item) => item.repo))
  const hiddenTopProjects = dailyTopProjects
    .filter((project) => !visibleRepos.has(project.repo))
    .map((project) => scoreProject(project, input.profile, input.feedback))
  const ranked = [...visibleRanked, ...hiddenTopProjects].slice(0, dailyTrendingProjectLimit).map((item, index) => ({
    ...item,
    rank: index + 1,
  }))
  const summaries = await input.summarize(ranked, input.profile)
  const summaryByRepo = new Map(summaries.map((summary) => [summary.repo, summary]))

  return {
    date: input.date,
    generatedAt: new Date().toISOString(),
    source: 'GitHub Trending',
    warnings: input.warnings ?? [],
    items: ranked.map((item) => {
      const summary = summaryByRepo.get(item.repo)
      const brief = normalizeProjectBrief(summary?.brief ?? fallbackBrief(item))
      return {
        ...item,
        nameZh: summary?.nameZh ?? fallbackNameZh(item),
        brief,
        useAdvice: summary?.useAdvice ?? fallbackUseAdvice(item),
        summary: brief,
        purpose: brief,
        relevanceReason: summary?.useAdvice ?? fallbackUseAdvice(item),
      }
    }),
  }
}

export async function summarizeLocally(items: RankedProject[]): Promise<ProjectSummary[]> {
  return items.map((item) => ({
    repo: item.repo,
    nameZh: fallbackNameZh(item),
    brief: fallbackBrief(item),
    useAdvice: fallbackUseAdvice(item),
  }))
}

function fallbackNameZh(item: RankedProject): string {
  const text = `${item.name} ${item.description}`.toLowerCase()
  if (text.includes('agent')) {
    return '智能体工具'
  }
  if (text.includes('video') || text.includes('creator')) {
    return '内容创作工具'
  }
  if (text.includes('knowledge') || text.includes('graph')) {
    return '知识图谱工具'
  }
  if (text.includes('automation') || text.includes('workflow')) {
    return '自动化工作流工具'
  }
  return '开源工具项目'
}

function fallbackBrief(item: RankedProject): string {
  return buildOrderedProjectSummary(item)
}

function fallbackUseAdvice(item: RankedProject): string {
  const track = item.matchedTracks[0]
  if (track === '个人 AI 系统') {
    return '建议：先看它的工具调用、记忆或上下文管理方式，判断能不能沉淀成你的 Hermes / Gbrain 工作流组件。'
  }
  if (track === 'AIGC 内容工厂') {
    return '建议：重点看它能否缩短选题、脚本、素材处理或批量生产链路，适合先做一次小样验证。'
  }
  if (track === '海外平台运营') {
    return '建议：把它当作平台运营辅助工具候选，优先验证是否能帮助内容矩阵、风控或增长分析。'
  }
  if (track === '知识库与效率') {
    return '建议：先评估它是否能接入你的知识库，让文章、SOP、项目经验更容易检索和复用。'
  }
  return '建议：先快速浏览 README 和示例，判断它是否能直接服务你的 AI 编程或内容生产流程。'
}

function normalizeProjectBrief(brief: string): string {
  const trimmed = brief.trim()
  if (/^\s*1[.、]/.test(trimmed)) {
    return trimmed
  }
  return formatOrderedSummary([trimmed])
}

function buildOrderedProjectSummary(item: RankedProject): string {
  const points = [
    summarizeDescriptionPoint(item),
    ...extractReadmePoints(item.readmeExcerpt ?? '').slice(0, 2),
    buildProjectSignalPoint(item),
  ]
  return formatOrderedSummary(uniquePoints(points).slice(0, 3))
}

function summarizeDescriptionPoint(item: RankedProject): string {
  const description = cleanSummaryText(item.description)
  if (!description) {
    return `${item.name} 是 GitHub Trending 当日前 20 的开源项目，建议先看 README 判断用途。`
  }

  const lower = description.toLowerCase()
  const hints: string[] = []
  if (lower.includes('memory')) {
    hints.push('重点关注记忆管理和上下文沉淀')
  }
  if (lower.includes('agent')) {
    hints.push('重点关注 Agent 工作流')
  }
  if (lower.includes('knowledge graph')) {
    hints.push('重点关注知识图谱和项目理解')
  }
  if (lower.includes('video') || lower.includes('presentation') || lower.includes('creator')) {
    hints.push('重点关注内容生产效率')
  }

  return hints.length > 0 ? `项目定位：${description}，${hints.join('、')}。` : `项目定位：${description}。`
}

function extractReadmePoints(readmeExcerpt: string): string[] {
  const cleaned = cleanSummaryText(readmeExcerpt)
  if (!cleaned) {
    return []
  }

  return cleaned
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.replace(/[.!?。！？]+$/g, '').trim())
    .filter((sentence) => sentence.length >= 18)
    .filter((sentence) => !/^English\b|^Docs\b|^Website\b/i.test(sentence))
    .slice(0, 4)
    .map((sentence) => `README 重点：${sentence}。`)
}

function buildProjectSignalPoint(item: RankedProject): string {
  const signals = [
    item.language ? `主要语言 ${item.language}` : '',
    item.topics?.length ? `相关标签 ${item.topics.slice(0, 4).join('、')}` : '',
    item.todayStars ? `当日新增 ${item.todayStars} stars` : '',
  ].filter(Boolean)

  return signals.length > 0
    ? `评估线索：${signals.join('，')}。`
    : '评估线索：先看 README、示例和最近提交，判断是否值得深入阅读。'
}

function cleanSummaryText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[|*_#>`]+/g, '')
    .trim()
}

function uniquePoints(points: string[]): string[] {
  const seen = new Set<string>()
  return points.filter((point) => {
    const normalized = point.toLowerCase().replace(/\W+/g, '').slice(0, 80)
    if (!normalized || seen.has(normalized)) {
      return false
    }
    seen.add(normalized)
    return true
  })
}

function formatOrderedSummary(points: string[]): string {
  const validPoints = points.map((point) => point.trim()).filter(Boolean)
  if (validPoints.length === 0) {
    return '1. 暂无可提取的项目重点。'
  }
  return validPoints.map((point, index) => `${index + 1}. ${point.replace(/^\d+[.、]\s*/, '')}`).join('\n')
}
