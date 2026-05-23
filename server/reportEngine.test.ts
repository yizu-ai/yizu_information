import { describe, expect, it } from 'vitest'

import { applyFeedback, rankProjects } from './reportEngine'

const profile = {
  tracks: [
    {
      name: 'Personal AI system',
      keywords: ['agent', 'mcp', 'memory', 'tools'],
    },
    {
      name: 'AIGC content factory',
      keywords: ['video', 'story', 'creator', 'automation'],
    },
  ],
}

const projects = [
  {
    repo: 'owner/generic-tool',
    name: 'generic-tool',
    url: 'https://github.com/owner/generic-tool',
    description: 'A small utility for logs',
    language: 'Go',
    stars: 2000,
    todayStars: 120,
  },
  {
    repo: 'owner/agent-memory',
    name: 'agent-memory',
    url: 'https://github.com/owner/agent-memory',
    description: 'Memory and tools framework for AI agents',
    language: 'TypeScript',
    stars: 1000,
    todayStars: 80,
  },
  {
    repo: 'owner/video-agent',
    name: 'video-agent',
    url: 'https://github.com/owner/video-agent',
    description: 'Automates creator video story workflows with agents',
    language: 'Python',
    stars: 700,
    todayStars: 50,
  },
]

describe('rankProjects', () => {
  it('boosts favorites and filters ignored projects while preserving matched tracks', () => {
    const ranked = rankProjects(projects, profile, {
      'owner/generic-tool': {
        feedback: 'ignore',
        updatedAt: '2026-05-23T10:00:00+08:00',
      },
      'owner/video-agent': {
        feedback: 'favorite',
        updatedAt: '2026-05-23T10:00:00+08:00',
      },
    })

    expect(ranked[0]?.repo).toBe('owner/video-agent')
    expect(ranked.map((item) => item.repo)).not.toContain('owner/generic-tool')
    expect(ranked[0]?.matchedTracks).toContain('AIGC content factory')
    expect(ranked[1]?.matchedTracks).toContain('Personal AI system')
  })
})

describe('applyFeedback', () => {
  it('attaches saved feedback and note to report items', () => {
    const items = rankProjects(projects, profile, {})

    const result = applyFeedback(items, {
      'owner/agent-memory': {
        feedback: 'favorite',
        note: '先验证记忆模块能不能接入本地 Agent',
        updatedAt: '2026-05-23T10:00:00+08:00',
      },
    })

    expect(result.find((item) => item.repo === 'owner/agent-memory')).toMatchObject({
      feedback: 'favorite',
      note: '先验证记忆模块能不能接入本地 Agent',
    })
  })
})
