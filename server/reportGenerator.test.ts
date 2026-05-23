import { describe, expect, it } from 'vitest'

import { buildReport } from './reportGenerator'

describe('buildReport', () => {
  it('keeps the top 10 projects and attaches summaries', async () => {
    const projects = Array.from({ length: 12 }, (_, index) => ({
      repo: `owner/repo-${index}`,
      name: `repo-${index}`,
      url: `https://github.com/owner/repo-${index}`,
      description: index === 11 ? 'Agent memory workflow' : 'Generic utility',
      language: 'TypeScript',
      stars: 100 + index,
      todayStars: 10 + index,
    }))

    const report = await buildReport({
      date: '2026-05-23',
      projects,
      profile: {
        tracks: [{ name: '个人 AI 系统', keywords: ['agent', 'memory'] }],
      },
      feedback: {},
      summarize: async (items) =>
        items.map((item) => ({
          repo: item.repo,
          nameZh: `${item.name} 中文名`,
          brief: `${item.name} brief`,
          useAdvice: `${item.name} advice`,
        })),
    })

    expect(report.items).toHaveLength(10)
    expect(report.items[0].repo).toBe('owner/repo-11')
    expect(report.items[0].nameZh).toBe('repo-11 中文名')
    expect(report.items[0].brief).toBe('repo-11 brief')
    expect(report.items[0].useAdvice).toBe('repo-11 advice')
  })

  it('uses Chinese local fallback text when no AI summary is available', async () => {
    const report = await buildReport({
      date: '2026-05-23',
      projects: [
        {
          repo: 'owner/agent-memory',
          name: 'agent-memory',
          url: 'https://github.com/owner/agent-memory',
          description: 'Memory framework for AI agents',
          language: 'TypeScript',
          stars: 100,
          todayStars: 20,
        },
      ],
      profile: {
        tracks: [{ name: '个人 AI 系统', keywords: ['agent', 'memory'] }],
      },
      feedback: {},
      summarize: async () => [],
    })

    expect(report.items[0].nameZh).toContain('智能体')
    expect(report.items[0].brief).toContain('记忆')
    expect(report.items[0].useAdvice).toContain('建议')
    expect(report.items[0].brief).not.toContain('当前有')
    expect(report.items[0].useAdvice).not.toContain('命中关注主线')
  })
})
