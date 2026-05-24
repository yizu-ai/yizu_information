import { readPersonalContext } from './personalContext'
import { readRawSettings } from './storage'
import type { SourceItem } from './types'

type SummaryInput = {
  sourceName: string
  itemId: string
  title: string
  authorName?: string
  publishedAt?: string
  originalUrl: string
  rawText: string
}

type SummaryOutput = {
  itemId: string
  contentSummary: string
  essenceSummary: string
}

type ProviderResponse = {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

export async function summarizeSourceItems(
  inputs: SummaryInput[],
  options: { sourceName: string; dataDir?: string },
): Promise<Array<Pick<SourceItem, 'itemId' | 'contentSummary' | 'essenceSummary' | 'summaryStatus' | 'summaryError'>>> {
  if (inputs.length === 0) {
    return []
  }

  const settings = await readRawSettings(options.dataDir)
  if (!settings) {
    return inputs.map((item) => localSummary(item))
  }

  try {
    const personalContext = await readPersonalContext(
      `${options.sourceName} ${inputs.map((item) => item.title).join(' ')}`,
    )
    const response = await fetch(resolveChatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: defaultModel(settings.providerName),
        temperature: 0.2,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'system',
            content:
              '你是个人信息源筛选助手。只基于输入内容、USER.md 和 Gbrain 上下文生成中文总结，不要虚构。标题由系统原样显示，你不要翻译、改写或替换标题。只返回严格 JSON object。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              sourceName: options.sourceName,
              personalContext,
              items: inputs.map((item) => ({
                itemId: item.itemId,
                title: item.title,
                authorName: item.authorName,
                publishedAt: item.publishedAt,
                originalUrl: item.originalUrl,
                rawText: item.rawText.slice(0, 6000),
              })),
              outputSchema: {
                items: [
                  {
                    itemId: 'stable item id',
                    contentSummary:
                      '内容摘要。用 2 到 4 条有序列表总结帖子重点，格式必须是：1. ...\\n2. ...\\n3. ...。不要复述标题。',
                    essenceSummary:
                      '运用建议。结合用户项目、商业认知、项目机会和方法论，说明这条内容怎么用、是否值得深入阅读，120 到 220 个中文字符。',
                  },
                ],
              },
            }),
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`DeepSeek request failed: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as ProviderResponse
    const summaries = parseSummaryItems(data.choices?.[0]?.message?.content ?? '')
    const summaryById = new Map(summaries.map((summary) => [summary.itemId, summary]))
    return inputs.map((item) => {
      const summary = summaryById.get(item.itemId)
      if (!summary) {
        return localSummary(item)
      }
      return {
        itemId: item.itemId,
        contentSummary: normalizeOrderedSummary(summary.contentSummary),
        essenceSummary: summary.essenceSummary,
        summaryStatus: 'success',
      }
    })
  } catch {
    return inputs.map((item) => localSummary(item))
  }
}

function localSummary(item: SummaryInput): Pick<
  SourceItem,
  'itemId' | 'contentSummary' | 'essenceSummary' | 'summaryStatus' | 'summaryError'
> {
  const text = item.rawText.replace(/\s+/g, ' ').trim()
  return {
    itemId: item.itemId,
    contentSummary: buildLocalOrderedSummary(text || item.title),
    essenceSummary: 'AI 总结暂不可用，建议先根据标题和原文链接判断是否打开深入阅读。',
    summaryStatus: 'success',
  }
}

function buildLocalOrderedSummary(text: string): string {
  const chunks = text
    .split(/[。！？.!?]\s*/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .slice(0, 3)

  if (chunks.length === 0) {
    return '1. 暂无可提取的正文重点。'
  }

  return chunks.map((chunk, index) => `${index + 1}. ${chunk.slice(0, 90)}`).join('\n')
}

function normalizeOrderedSummary(summary: string): string {
  const trimmed = summary.trim()
  if (/^\s*1[.、]/.test(trimmed)) {
    return trimmed
  }
  return buildLocalOrderedSummary(trimmed)
}

export function parseSummaryItems(content: string): SummaryOutput[] {
  const cleaned = extractJsonObjectText(content)
  const parsed = JSON.parse(cleaned) as { items?: SummaryOutput[] }
  if (!Array.isArray(parsed.items)) {
    throw new Error('DeepSeek response is not a JSON object with items')
  }
  return parsed.items
}

function extractJsonObjectText(content: string): string {
  const cleaned = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    return cleaned
  }

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return cleaned.slice(start, end + 1)
  }

  return cleaned
}

function resolveChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

function defaultModel(providerName: string): string {
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
