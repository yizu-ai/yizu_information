import { rankProjects } from './reportEngine'
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

export async function buildReport(input: BuildReportInput): Promise<DailyReport> {
  const ranked = rankProjects(input.projects, input.profile, input.feedback, 10).map((item, index) => ({
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
      return {
        ...item,
        nameZh: summary?.nameZh ?? fallbackNameZh(item),
        brief: summary?.brief ?? fallbackBrief(item),
        useAdvice: summary?.useAdvice ?? fallbackUseAdvice(item),
        summary: summary?.brief ?? fallbackBrief(item),
        purpose: summary?.brief ?? fallbackBrief(item),
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
  const track = item.matchedTracks[0]
  if (item.description) {
    return translateDescriptionHint(item.description, track)
  }
  return fallbackByTrack(track)
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

function translateDescriptionHint(description: string, track?: string): string {
  const lower = description.toLowerCase()
  if (lower.includes('memory')) {
    return '提供记忆管理或上下文沉淀能力，适合评估能否接入你的个人 AI 系统。'
  }
  if (lower.includes('knowledge graph')) {
    return '把代码或资料整理成可检索、可提问的知识图谱，适合做项目理解和知识沉淀。'
  }
  if (lower.includes('agent')) {
    return '围绕 AI Agent 的开发、执行或协作流程提供工具能力，适合拿来验证自动化工作流。'
  }
  if (lower.includes('video')) {
    return '提供视频处理或内容生产相关能力，适合评估是否能进入 AIGC 内容流水线。'
  }
  if (lower.includes('workflow') || lower.includes('automation')) {
    return '用于组织和自动化重复流程，适合减少手工操作并沉淀成可复用 SOP。'
  }
  return fallbackByTrack(track)
}

function fallbackByTrack(track?: string): string {
  if (track === '个人 AI 系统') {
    return '提供 AI Agent、工具调用或记忆管理相关能力，适合评估能否接入个人 AI 系统。'
  }
  if (track === 'AIGC 内容工厂') {
    return '提供内容创作、脚本、视频或自动化生产相关能力，适合评估能否提升内容工厂效率。'
  }
  if (track === '海外平台运营') {
    return '提供增长、分析或平台运营相关能力，适合评估能否辅助海外内容项目。'
  }
  if (track === '知识库与效率') {
    return '提供知识整理、资料管理或效率提升能力，适合评估能否沉淀到个人知识库。'
  }
  return '提供一个可观察的开源能力样本，适合快速判断是否值得继续研究。'
}
