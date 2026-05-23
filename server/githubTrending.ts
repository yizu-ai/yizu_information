import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import * as cheerio from 'cheerio'

import type { TrendingProject } from './types'

const defaultTrendingUrl = 'https://github.com/trending?since=daily'
const execFileAsync = promisify(execFile)

export async function fetchTrendingProjects(url = defaultTrendingUrl): Promise<TrendingProject[]> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'daily-report-agent/0.1',
        Accept: 'text/html',
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub Trending request failed: ${response.status} ${response.statusText}`)
    }

    return parseTrendingHtml(await response.text())
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error
    }

    return parseTrendingHtml(await fetchWithPowerShell(url))
  }
}

export async function enrichRepositoryDetails(projects: TrendingProject[]): Promise<TrendingProject[]> {
  return Promise.all(
    projects.map(async (project) => {
      try {
        const details = await fetchRepositoryDetails(project.repo)
        const readmeExcerpt = await fetchReadmeExcerpt(project.repo).catch(() => project.readmeExcerpt)
        return {
          ...project,
          homepage: details.homepage ?? project.homepage,
          stars: details.stars ?? project.stars,
          updatedAt: details.updatedAt,
          topics: details.topics,
          readmeExcerpt,
        }
      } catch {
        return {
          ...project,
          topics: project.topics ?? [],
        }
      }
    }),
  )
}

export function parseTrendingHtml(html: string): TrendingProject[] {
  const $ = cheerio.load(html)

  return $('article.Box-row')
    .toArray()
    .map((article) => {
      const node = $(article)
      const repoPath = normalizeRepo(node.find('h2 a').attr('href') ?? node.find('h2 a').text())
      const name = repoPath.split('/').at(-1) ?? repoPath
      const description = normalizeText(node.find('p').first().text())
      const language = normalizeText(node.find('[itemprop="programmingLanguage"]').first().text())
      const stars = parseNumber(node.find('a[href$="/stargazers"]').first().text())
      const todayStars = parseNumber(
        node
          .find('span')
          .toArray()
          .map((span) => normalizeText($(span).text()))
          .find((text) => /stars today/i.test(text)) ?? '',
      )

      return {
        repo: repoPath,
        name,
        url: `https://github.com/${repoPath}`,
        description,
        language,
        stars,
        todayStars,
      }
    })
    .filter((project) => project.repo.includes('/'))
}

function normalizeRepo(value: string): string {
  return value.replace(/^https:\/\/github\.com\//, '').replace(/^\//, '').replace(/\s+/g, '')
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseNumber(value: string): number {
  const match = value.replace(/,/g, '').match(/\d+/)
  return match ? Number(match[0]) : 0
}

async function fetchRepositoryDetails(repo: string): Promise<{
  homepage?: string
  stars?: number
  updatedAt?: string
  topics: string[]
}> {
  const url = `https://api.github.com/repos/${repo}`
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'daily-report-agent/0.1',
        Accept: 'application/vnd.github+json',
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub repo request failed: ${response.status}`)
    }

    return parseRepositoryDetailsJson(await response.text())
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error
    }
    return parseRepositoryDetailsJson(await fetchWithPowerShell(url, 'application/vnd.github+json'))
  }
}

function parseRepositoryDetailsJson(json: string): {
  homepage?: string
  stars?: number
  updatedAt?: string
  topics: string[]
} {
  const data = JSON.parse(json) as {
    homepage?: string | null
    stargazers_count?: number
    updated_at?: string
    topics?: string[]
  }
  return {
    homepage: data.homepage || undefined,
    stars: data.stargazers_count,
    updatedAt: data.updated_at,
    topics: Array.isArray(data.topics) ? data.topics.slice(0, 6) : [],
  }
}

async function fetchReadmeExcerpt(repo: string): Promise<string | undefined> {
  const url = `https://api.github.com/repos/${repo}/readme`
  let markdown: string

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'daily-report-agent/0.1',
        Accept: 'application/vnd.github.raw',
      },
    })

    if (!response.ok) {
      if (process.platform === 'win32') {
        markdown = await fetchWithPowerShell(url, 'application/vnd.github.raw')
        return extractReadmeExcerpt(markdown)
      }
      return undefined
    }

    markdown = await response.text()
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error
    }
    markdown = await fetchWithPowerShell(url, 'application/vnd.github.raw')
  }

  return extractReadmeExcerpt(markdown)
}

export function extractReadmeExcerpt(markdown: string, maxLength = 1800): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s*/, '')
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/^\s*\d+\.\s+/, '')
        .trim(),
    )
    .filter((line) => line && !/^[-=_]{3,}$/.test(line) && !/badge|shield/i.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

async function fetchWithPowerShell(url: string, accept = 'text/html'): Promise<string> {
  const command =
    '& { param($Url) ' +
    "$ProgressPreference='SilentlyContinue'; " +
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
    `$Headers = @{ Accept = '${accept}'; 'User-Agent' = 'daily-report-agent/0.1' }; ` +
    '$Response = Invoke-WebRequest -Uri $Url -Headers $Headers -UseBasicParsing -TimeoutSec 45; ' +
    "if ($Response.Content -is [byte[]]) { [System.Text.Encoding]::UTF8.GetString($Response.Content) } else { $Response.Content } }"

  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command, url], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  return stdout
}
