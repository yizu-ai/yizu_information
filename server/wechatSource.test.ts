import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readSourceReport, writeSourceSettings } from './storage'
import { collectSources } from './sourceCollector'
import { collectWechatSource, normalizeDajialaDailyPosts, normalizeWechatArticleLink } from './wechatSource'

let tempDir: string | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true })
    tempDir = undefined
  }
})

describe('normalizeWechatArticleLink', () => {
  it('keeps direct WeChat article links', () => {
    expect(
      normalizeWechatArticleLink({
        title: 'Article title',
        url: 'https://mp.weixin.qq.com/s/abc123?scene=1#wechat_redirect',
      }),
    ).toEqual({
      title: 'Article title',
      url: 'https://mp.weixin.qq.com/s/abc123?scene=1',
    })
  })

  it('unwraps Bing result links that point to WeChat articles', () => {
    expect(
      normalizeWechatArticleLink({
        title: 'Wrapped article',
        url: 'https://www.bing.com/ck/a?u=a1aHR0cHM6Ly9tcC53ZWl4aW4ucXEuY29tL3MvYWJjMTIz',
      }),
    ).toEqual({
      title: 'Wrapped article',
      url: 'https://mp.weixin.qq.com/s/abc123',
    })
  })

  it('rejects navigation and filing links', () => {
    expect(normalizeWechatArticleLink({ title: 'Sogou home', url: 'https://weixin.sogou.com/' })).toBeNull()
    expect(normalizeWechatArticleLink({ title: 'ICP', url: 'http://www.miibeian.gov.cn/' })).toBeNull()
  })
})

describe('normalizeDajialaDailyPosts', () => {
  it('extracts normal daily article links from Dajiala post_condition responses', () => {
    expect(
      normalizeDajialaDailyPosts(
        {
          code: 0,
          mp_nickname: '测试公众号',
          data: [
            {
              title: '今天的新文章',
              url: 'http://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=xyz#rd',
              post_time_str: '2026-05-24 09:00:00',
              msg_status: 2,
              is_deleted: '0',
            },
            {
              title: '已删除文章',
              url: 'http://mp.weixin.qq.com/s/deleted',
              post_time_str: '2026-05-24 10:00:00',
              msg_status: 7,
              is_deleted: '1',
            },
          ],
        },
        '测试公众号',
      ),
    ).toEqual([
      {
        account: '测试公众号',
        title: '今天的新文章',
        url: 'http://mp.weixin.qq.com/s?__biz=abc&mid=1&idx=1&sn=xyz',
        publishedAt: '2026-05-24T09:00:00.000+08:00',
      },
    ])
  })

  it('treats empty Dajiala data objects as no updates', () => {
    expect(normalizeDajialaDailyPosts({ msg: '当天没有发文!', data: { length: 0 } }, '测试公众号')).toEqual([])
  })
})

describe('collectWechatSource with Dajiala API', () => {
  it('records no_updates without fetching article bodies when accounts did not publish today', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wechat-dajiala-empty-'))
    await writeSourceSettings({ wechat: { accounts: ['测试公众号'], dajialaApiKey: 'JZL-test-key' } }, tempDir)
    const fetchMock = vi.fn(async () => jsonResponse({ msg: '当天没有发文!', data: { length: 0 } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await collectSources({
      date: '2026-05-24',
      dataDir: tempDir,
      collectors: { wechat: collectWechatSource },
      sourceOrder: ['wechat'],
    })

    expect(result.results).toMatchObject([
      { sourceKey: 'wechat', status: 'success', itemCount: 0, message: '今日没有新文章' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(readSourceReport('wechat', '2026-05-24', tempDir)).resolves.toMatchObject({
      cost: {
        estimatedMin: 0.06,
        estimatedMax: 0.08,
        details: [{ label: '公众号当日发文查询', requests: 1 }],
      },
      emptyReason: 'no_updates',
      items: [],
    })
  })

  it('fetches article body only for updated posts and stores summaries, not raw html', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wechat-dajiala-updated-'))
    await writeSourceSettings({ wechat: { accounts: ['测试公众号'], dajialaApiKey: 'JZL-test-key' } }, tempDir)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          mp_nickname: '测试公众号',
          data: [
            {
              title: '今天的新文章',
              url: 'https://mp.weixin.qq.com/s/article-one',
              post_time_str: '2026-05-24 09:00:00',
              msg_status: 2,
              is_deleted: 0,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            title: '今天的新文章',
            nickname: '测试公众号',
            author: '作者A',
            article_url: 'https://mp.weixin.qq.com/s/article-one',
            post_time_str: '2026-05-24 09:00:00',
            html: '<p>第一段重点。第二段重点。第三段重点。</p>',
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const report = await collectWechatSource({ date: '2026-05-24', dataDir: tempDir })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(report.items).toMatchObject([
      {
        sourceKey: 'wechat',
        title: '今天的新文章',
        authorName: '测试公众号',
        originalUrl: 'https://mp.weixin.qq.com/s/article-one',
        publishedAt: '2026-05-24T09:00:00.000+08:00',
        summaryStatus: 'success',
      },
    ])
    expect(report.items[0].contentSummary).toContain('1.')
    expect(report.items[0].contentSummary).not.toContain('<p>')
    expect(report.cost).toMatchObject({
      estimatedMin: 0.1,
      estimatedMax: 0.12,
      details: [
        { label: '公众号当日发文查询', requests: 1 },
        { label: '文章正文读取', requests: 1 },
      ],
    })
  })

  it('redacts API keys returned in Dajiala error messages', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wechat-dajiala-error-'))
    await writeSourceSettings({ wechat: { accounts: ['测试公众号'], dajialaApiKey: 'JZL-test-key' } }, tempDir)
    const leakedKey = 'FAKE-LEAKED-X-BEARER-TOKEN-VALUE'
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        code: -1,
        msg: `jzlkey错误，请检查！当前输入key值为 ${leakedKey}`,
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const report = await collectWechatSource({ date: '2026-05-24', dataDir: tempDir })

    expect(report.warnings.join('\n')).toContain('当前输入key值为 [已隐藏]')
    expect(report.warnings.join('\n')).not.toContain(leakedKey)
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
