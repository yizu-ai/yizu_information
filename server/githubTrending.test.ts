import { describe, expect, it } from 'vitest'

import { extractReadmeExcerpt, parseTrendingHtml } from './githubTrending'

describe('parseTrendingHtml', () => {
  it('extracts repository metadata from GitHub Trending markup', () => {
    const html = `
      <article class="Box-row">
        <h2><a href="/owner/repo"> owner / repo </a></h2>
        <p> Memory framework for AI agent tools. </p>
        <span itemprop="programmingLanguage">TypeScript</span>
        <a href="/owner/repo/stargazers"> 12,345 </a>
        <span>321 stars today</span>
      </article>
    `

    expect(parseTrendingHtml(html)).toEqual([
      {
        repo: 'owner/repo',
        name: 'repo',
        url: 'https://github.com/owner/repo',
        description: 'Memory framework for AI agent tools.',
        language: 'TypeScript',
        stars: 12345,
        todayStars: 321,
      },
    ])
  })

  it('condenses README markdown into AI-friendly repository context', () => {
    const markdown = `
      # Repo

      [![build](https://example.com/badge.svg)](https://example.com)

      Repo turns a codebase into a local searchable graph for coding agents.

      ## Usage
      Run the indexer, then ask questions about modules, symbols and file relationships.

      \`\`\`bash
      npm run noisy-command
      \`\`\`
    `

    const excerpt = extractReadmeExcerpt(markdown, 180)

    expect(excerpt).toContain('local searchable graph')
    expect(excerpt).toContain('ask questions about modules')
    expect(excerpt).not.toContain('```')
    expect(excerpt).not.toContain('badge.svg')
  })
})
