// 默认用户关注画像配置：定义四个核心赛道及其关键词，用于项目打分与排序
import type { UserProfile } from './types'

export const defaultProfile: UserProfile = {
  tracks: [
    {
      name: '个人 AI 系统',
      keywords: ['agent', 'agents', 'llm', 'mcp', 'skill', 'memory', 'tools', 'workflow'],
    },
    {
      name: 'AIGC 内容工厂',
      keywords: ['aigc', 'video', 'story', 'script', 'creator', 'automation', 'content'],
    },
    {
      name: '海外平台运营',
      keywords: ['tiktok', 'youtube', 'creator', 'channel', 'viral', 'growth', 'risk'],
    },
    {
      name: '知识库与效率',
      keywords: ['obsidian', 'knowledge', 'sop', 'notes', 'productivity', 'automation'],
    },
  ],
}
