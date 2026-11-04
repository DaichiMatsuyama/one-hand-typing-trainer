import { describe, expect, it } from 'vitest'
import { addKeyAttempt, findWeakKeys, sanitizeKeyStats } from './keyStats.js'

describe('キー別集計', () => {
  it('同じ出題段階のshownは一度、押し間違いは毎回加算する', () => {
    let stats = addKeyAttempt({}, 'A', { shown: true, missed: true })
    stats = addKeyAttempt(stats, 'a', { shown: false, missed: true })
    stats = addKeyAttempt(stats, 'a', { shown: false, missed: false })
    expect(stats).toEqual({ a: [1, 2] })
  })

  it('許可キーと非負整数だけを残し、40キーを上限にする', () => {
    const source = { A: [2, 1], '@': [3, 0], '?': [4, 1], aa: [1, 1], b: [-1, 0], c: [1] }
    for (let index = 0; index < 50; index += 1) source[String.fromCharCode(97 + (index % 26))] = [1, 0]
    const sanitized = sanitizeKeyStats(source)
    expect(sanitized.a).toEqual([3, 1])
    expect(sanitized['@']).toEqual([3, 0])
    expect(sanitized).not.toHaveProperty('?')
    expect(sanitized).not.toHaveProperty('aa')
    expect(Object.keys(sanitized).length).toBeLessThanOrEqual(40)
  })

  it('同じ手の新しい10件だけを合計し、5回未満とミス0を除外する', () => {
    const records = [
      { hand: 'left', keys: { a: [3, 2], s: [3, 0] } },
      { hand: 'right', keys: { a: [99, 99] } },
      { hand: 'left', keys: { a: [2, 0], s: [1, 1] } },
      ...Array.from({ length: 8 }, () => ({ hand: 'left', keys: { d: [1, 1] } })),
      { hand: 'left', keys: { a: [100, 100] } },
    ]
    expect(findWeakKeys(records, 'left')).toEqual([
      { key: 'd', shown: 8, misses: 8, rate: 1 },
      { key: 'a', shown: 5, misses: 2, rate: 0.4 },
    ])
  })

  it('ミス率、ミス数の順で上位3キーを返す', () => {
    const result = findWeakKeys([{ hand: 'left', keys: {
      a: [10, 5], s: [8, 4], d: [12, 6], f: [10, 4], g: [4, 4],
    } }], 'left')
    expect(result.map(({ key }) => key)).toEqual(['d', 'a', 's'])
  })
})
