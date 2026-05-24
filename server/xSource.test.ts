import { describe, expect, it } from 'vitest'

import { formatXApiError, normalizeXMaxResults, selectTopXPostsByTopic } from './xSource'
import type { XTopicSearchResult } from './types'

describe('selectTopXPostsByTopic', () => {
  it('keeps at most 20 candidates and returns the highest liked original posts per topic', () => {
    const topics: XTopicSearchResult[] = [
      {
        topicKey: 'codex',
        topicName: 'Codex',
        posts: Array.from({ length: 8 }, (_, index) => ({
          id: `codex-${index}`,
          text: `Codex tip ${index}`,
          authorName: 'Author',
          createdAt: '2026-05-24T00:00:00Z',
          likeCount: index,
          url: `https://x.com/a/status/codex-${index}`,
          isRetweet: false,
          isReply: false,
        })),
      },
      {
        topicKey: 'agent',
        topicName: 'Agent',
        posts: Array.from({ length: 20 }, (_, index) => ({
          id: `agent-${index}`,
          text: `Agent post ${index}`,
          authorName: 'Author',
          createdAt: '2026-05-24T00:00:00Z',
          likeCount: 100 - index,
          url: `https://x.com/a/status/agent-${index}`,
          isRetweet: index === 0,
          isReply: index === 1,
        })),
      },
    ]

    const selected = selectTopXPostsByTopic(topics, { dailyLimit: 20, perTopicLimit: 3 })

    expect(selected).toHaveLength(6)
    expect(selected.filter((post) => post.topicKey === 'codex').map((post) => post.id)).toEqual([
      'codex-7',
      'codex-6',
      'codex-5',
    ])
    expect(selected.filter((post) => post.topicKey === 'agent').map((post) => post.id)).toEqual([
      'agent-2',
      'agent-3',
      'agent-4',
    ])
    expect(selected.map((post) => post.id)).not.toContain('agent-0')
    expect(selected.map((post) => post.id)).not.toContain('agent-1')
  })
})

describe('formatXApiError', () => {
  it('explains payment-required responses in product language', async () => {
    await expect(formatXApiError(new Response('', { status: 402, statusText: 'Payment Required' }))).resolves.toContain(
      '402 Payment Required',
    )
  })

  it('explains bad request responses with parameter guidance', async () => {
    await expect(formatXApiError(new Response('', { status: 400, statusText: 'Bad Request' }))).resolves.toContain(
      'max_results',
    )
  })
})

describe('normalizeXMaxResults', () => {
  it('keeps X recent search max_results inside the required range', () => {
    expect(normalizeXMaxResults(5)).toBe(10)
    expect(normalizeXMaxResults(20)).toBe(20)
    expect(normalizeXMaxResults(120)).toBe(100)
  })
})
