import { describe, expect, it } from 'vitest'

import { selectUnseenEssenceLinks, stableItemId } from './shengcaiSource'

describe('selectUnseenEssenceLinks', () => {
  it('keeps latest unseen links first and backfills older unseen links up to the daily limit', () => {
    const links = Array.from({ length: 12 }, (_, index) => ({
      title: `精华帖 ${index}`,
      url: `https://scys.com/post-${index}`,
    }))
    const seenIds = new Set([
      stableItemId('shengcai', 'https://scys.com/post-0'),
      stableItemId('shengcai', 'https://scys.com/post-1'),
    ])

    expect(selectUnseenEssenceLinks(links, seenIds, 10).map((link) => link.url)).toEqual([
      'https://scys.com/post-2',
      'https://scys.com/post-3',
      'https://scys.com/post-4',
      'https://scys.com/post-5',
      'https://scys.com/post-6',
      'https://scys.com/post-7',
      'https://scys.com/post-8',
      'https://scys.com/post-9',
      'https://scys.com/post-10',
      'https://scys.com/post-11',
    ])
  })

  it('uses non-colliding ids for similar scys topic urls', () => {
    expect(stableItemId('shengcai', 'https://scys.com/articleDetail/xq_topic/111')).not.toBe(
      stableItemId('shengcai', 'https://scys.com/articleDetail/xq_topic/222'),
    )
  })
})
