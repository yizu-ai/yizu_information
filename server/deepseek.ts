import type { ProjectSummary } from './reportGenerator'
import type { ApiSettings, RankedProject, UserProfile } from './types'

type DeepSeekResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export async function summarizeWithProvider(
  items: RankedProject[],
  profile: UserProfile,
  settings: ApiSettings,
): Promise<ProjectSummary[]> {
  const model = getDefaultModel(settings.providerName)

  const response = await fetch(resolveChatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'system',
          content:
            '你是技术情报筛选助手。只基于输入的 GitHub 项目信息、README 摘要和用户关注画像生成中文日报，不虚构能力。只返回严格 JSON object，不要解释。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            profile,
            items: items.map((item) => ({
              repo: item.repo,
              name: item.name,
              description: item.description,
              homepage: item.homepage,
              language: item.language,
              stars: item.stars,
              todayStars: item.todayStars,
              updatedAt: item.updatedAt,
              topics: item.topics,
              readmeExcerpt: item.readmeExcerpt,
              matchedTracks: item.matchedTracks,
            })),
            outputSchema: {
              items: [
                {
                  repo: 'owner/repo',
                  nameZh: '中文名，6 到 12 个字',
                  brief:
                    '合并摘要和作用，90 到 160 个中文字符，具体说明这个项目做什么、怎么工作、解决什么问题、适合什么场景，让用户不用打开 GitHub 也能判断是否值得深入看',
                  useAdvice:
                    '结合用户情况给使用建议，60 到 120 个中文字符，说明建议怎么试用这个仓库、优先看哪部分、能否进入用户自己的项目或工作流',
                },
              ],
            },
            rules: [
              '只能处理输入 items 里的仓库，不要新增、替换或推荐其他仓库。',
              '输出 items 数量必须等于输入 items 数量，repo 必须与输入 repo 完全一致。',
              '所有字段必须是中文，不要直接复制英文描述。',
              '优先综合 description、homepage、topics、readmeExcerpt 判断；README 信息不足时要明确保守表达。',
              'brief 要写到用户不用打开 GitHub 也能看懂：核心功能、典型输入输出、适合的使用场景。',
              'brief 不要写“这是 GitHub 开源项目”“当前有多少 star”这类废话。',
              'useAdvice 要像顾问建议，不要生硬说“与你的某某方向相关”。',
              '不要夸大项目能力，不确定时用“可能”“适合先验证”表达。',
            ],
          }),
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`DeepSeek request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as DeepSeekResponse
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('DeepSeek response is empty')
  }

  const allowedRepos = new Set(items.map((item) => item.repo))
  return parseSummaryJson(content).filter((summary) => allowedRepos.has(summary.repo))
}

function parseSummaryJson(content: string): ProjectSummary[] {
  const cleaned = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '')
  let parsed: unknown

  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const arrayMatch = cleaned.match(/\[[\s\S]*]/)
    if (!arrayMatch) {
      throw new Error('DeepSeek response is not valid JSON')
    }
    parsed = JSON.parse(arrayMatch[0])
  }

  const summaries = Array.isArray(parsed) ? parsed : readSummaryItems(parsed)

  if (!Array.isArray(summaries)) {
    throw new Error('DeepSeek response is not a JSON array')
  }

  return summaries as ProjectSummary[]
}

function readSummaryItems(value: unknown): unknown[] | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const objectValue = value as { items?: unknown; summaries?: unknown; data?: unknown }
  if (Array.isArray(objectValue.items)) {
    return objectValue.items
  }
  if (Array.isArray(objectValue.summaries)) {
    return objectValue.summaries
  }
  if (Array.isArray(objectValue.data)) {
    return objectValue.data
  }
  return null
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (normalized.endsWith('/chat/completions')) {
    return normalized
  }
  return `${normalized}/chat/completions`
}

function getDefaultModel(providerName: string): string {
  const provider = providerName.toLowerCase()
  if (provider.includes('openai')) {
    return 'gpt-4.1-mini'
  }
  if (provider.includes('qwen') || provider.includes('通义')) {
    return 'qwen-plus'
  }
  if (provider.includes('zhipu') || provider.includes('智谱')) {
    return 'glm-4-flash'
  }
  return 'deepseek-v4-flash'
}
