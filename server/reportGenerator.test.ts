import { describe, expect, it } from 'vitest'

import { buildReport, summarizeLocally } from './reportGenerator'

describe('buildReport', () => {
  it('keeps the daily top 20 projects and attaches summaries', async () => {
    const projects = Array.from({ length: 25 }, (_, index) => ({
      repo: `owner/repo-${index}`,
      name: `repo-${index}`,
      url: `https://github.com/owner/repo-${index}`,
      description: index === 19 || index === 24 ? 'Agent memory workflow' : 'Generic utility',
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

    expect(report.items).toHaveLength(20)
    expect(report.items[0].repo).toBe('owner/repo-19')
    expect(report.items.map((item) => item.repo)).not.toContain('owner/repo-24')
    expect(report.items[0].nameZh).toBe('repo-19 中文名')
    expect(report.items[0].brief).toBe('1. repo-19 brief')
    expect(report.items[0].useAdvice).toBe('repo-19 advice')
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
    expect(report.items[0].brief).toMatch(/^1\./)
    expect(report.items[0].brief).toContain('记忆')
    expect(report.items[0].useAdvice).toContain('建议')
    expect(report.items[0].brief).not.toContain('当前有')
    expect(report.items[0].useAdvice).not.toContain('命中关注主线')
  })

  it('keeps ignored projects in the saved daily top 20 report', async () => {
    const projects = Array.from({ length: 20 }, (_, index) => ({
      repo: `owner/repo-${index}`,
      name: `repo-${index}`,
      url: `https://github.com/owner/repo-${index}`,
      description: index === 0 ? 'Ignored project' : 'Generic utility',
      language: 'TypeScript',
      stars: 100 + index,
      todayStars: 10 + index,
    }))

    const report = await buildReport({
      date: '2026-05-23',
      projects,
      profile: { tracks: [] },
      feedback: {
        'owner/repo-0': {
          feedback: 'ignore',
          updatedAt: '2026-05-23T10:00:00+08:00',
        },
      },
      summarize: async () => [],
    })

    expect(report.items).toHaveLength(20)
    expect(report.items.find((item) => item.repo === 'owner/repo-0')).toMatchObject({ feedback: 'ignore' })
  })

  it('builds ordered local GitHub summaries from README details', async () => {
    const summaries = await summarizeLocally([
      {
        repo: 'owner/presenton',
        name: 'presenton',
        url: 'https://github.com/owner/presenton',
        description: 'Open-Source AI Presentation Generator and API',
        language: 'TypeScript',
        stars: 6400,
        todayStars: 240,
        topics: ['ai-presentation', 'api', 'mcp'],
        readmeExcerpt:
          'Presenton lets users generate presentations with their own model provider. It supports self-hosting, custom templates, PPTX export, and a built-in MCP server.',
        score: 0,
        matchedTracks: ['AIGC 内容工厂'],
      },
    ])

    expect(summaries[0].brief).toMatch(/^1\..+\n2\..+\n3\./)
    expect(summaries[0].brief).toContain('Open-Source AI Presentation Generator')
    expect(summaries[0].brief).toContain('PPTX')
  })
})
