import { afterEach, describe, expect, it, vi } from 'vitest'

import { summarizeWithProvider } from './deepseek'
import type { RankedProject } from './types'

const originalFetch = globalThis.fetch

type ChatRequestBody = {
  model: string
  response_format?: { type: string }
  thinking?: { type: string }
  messages: Array<{ role: string; content: string }>
}

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('summarizeWithProvider', () => {
  it('sends repository detail context and asks for decision-grade Chinese summaries', async () => {
    let requestBody: ChatRequestBody | undefined

    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    items: [
                      {
                        repo: 'owner/repo',
                        nameZh: '代码索引工具',
                        brief:
                          '把仓库代码预先索引成可检索的结构，让 Agent 在理解项目时少读重复文件，适合大型代码库问答和定位模块。',
                        useAdvice:
                          '建议先用一个你熟悉的小项目试跑，观察它能否减少 Agent 查文件次数，再决定是否接进日报 Agent 或 Hermes 流程。',
                      },
                    ],
                  },
                ][0]),
              },
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      )
    }) as typeof fetch

    const item = {
      repo: 'owner/repo',
      name: 'repo',
      url: 'https://github.com/owner/repo',
      description: 'Code graph for agents',
      language: 'TypeScript',
      stars: 100,
      todayStars: 20,
      score: 120,
      matchedTracks: ['个人 AI 系统'],
      readmeExcerpt: 'Indexes a repository into a local code graph for agent search and codebase question answering.',
    } as RankedProject

    const result = await summarizeWithProvider(
      [item],
      { tracks: [{ name: '个人 AI 系统', keywords: ['agent'] }] },
      {
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'test-key',
      },
    )

    expect(result[0].brief).toContain('代码')
    if (!requestBody) {
      throw new Error('Expected request body to be captured')
    }
    const sentBody = requestBody
    expect(sentBody.model).toBe('deepseek-v4-flash')
    expect(sentBody).toMatchObject({
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
    })
    const promptPayload = JSON.parse(sentBody.messages[1].content) as {
      items: Array<{ readmeExcerpt?: string }>
      rules: string[]
    }
    expect(promptPayload.items[0].readmeExcerpt).toContain('local code graph')
    expect(promptPayload.rules.join(' ')).toContain('不用打开 GitHub')
  })
})
