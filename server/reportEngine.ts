// 项目打分与排序引擎：结合用户画像赛道匹配度、GitHub 热度与历史反馈权重对项目进行排序
import type { FeedbackMap, RankedProject, TrendingProject, UserProfile } from './types'

const feedbackWeight = {
  favorite: 180,
  ignore: -90,
  irrelevant: -260,
} as const

// 过滤已忽略/不相关项目并按综合得分降序排列
export function rankProjects(
  projects: TrendingProject[],
  profile: UserProfile,
  feedback: FeedbackMap,
  limit?: number,
): RankedProject[] {
  const ranked = projects
    .filter((project) => {
      const value = feedback[project.repo]?.feedback
      return value !== 'ignore' && value !== 'irrelevant'
    })
    .map((project) => scoreProject(project, profile, feedback))
    .sort((a, b) => b.score - a.score)

  return typeof limit === 'number' ? ranked.slice(0, limit) : ranked
}

// 计算单个项目的赛道命中、热度分与历史反馈加权分
export function scoreProject(
  project: TrendingProject,
  profile: UserProfile,
  feedback: FeedbackMap,
): RankedProject {
  const searchable = `${project.repo} ${project.name} ${project.description} ${project.language}`.toLowerCase()
  const matchedTracks = profile.tracks
    .filter((track) => track.keywords.some((keyword) => searchable.includes(keyword.toLowerCase())))
    .map((track) => track.name)

  const profileScore = matchedTracks.length * 100
  const hotScore = Math.min(project.todayStars, 500) * 0.5 + Math.log10(Math.max(project.stars, 1)) * 8
  const savedFeedback = feedback[project.repo]?.feedback
  const historyScore = savedFeedback ? feedbackWeight[savedFeedback] : 0

  return {
    ...project,
    score: Math.round(profileScore + hotScore + historyScore),
    matchedTracks,
    feedback: savedFeedback ?? null,
    note: feedback[project.repo]?.note,
    rating: feedback[project.repo]?.rating,
  }
}

export function applyFeedback(items: RankedProject[], feedback: FeedbackMap): RankedProject[] {
  return items.map((item) => ({
    ...item,
    feedback: feedback[item.repo]?.feedback ?? null,
    note: feedback[item.repo]?.note,
    rating: feedback[item.repo]?.rating,
  }))
}
