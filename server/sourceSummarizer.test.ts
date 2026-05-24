import { describe, expect, it } from 'vitest'

import { parseSummaryItems } from './sourceSummarizer'

describe('parseSummaryItems', () => {
  it('extracts JSON even when the model wraps it in prose', () => {
    expect(
      parseSummaryItems(
        '下面是总结：\n{"items":[{"itemId":"shengcai:1","contentSummary":"1. 重点一","essenceSummary":"可以参考。"}]}',
      ),
    ).toEqual([{ itemId: 'shengcai:1', contentSummary: '1. 重点一', essenceSummary: '可以参考。' }])
  })
})
