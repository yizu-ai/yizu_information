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
