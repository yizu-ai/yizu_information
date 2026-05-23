import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('App hero copy', () => {
  it('uses the new information-pool headline and removes decorative hero blocks', () => {
    const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')

    expect(source).toContain('优质信息池')
    expect(source).toContain('筛选优质信息，告别信息焦虑')
    expect(source).not.toContain('信息源筛选池')
    expect(source).not.toContain('10条项目')
    expect(source).not.toContain('5分钟看懂')
    expect(source).not.toContain('收藏 · 星级 · 备注')
  })
})
