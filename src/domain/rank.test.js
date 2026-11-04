import { describe, expect, it } from 'vitest'
import { describeNextRank, evaluateRank, getRankTable, RANK_VERSION } from './rank.js'

const base = { correctCount: 100, mistakes: 0, attempts: 100, accuracy: 100, level: 1 }

describe('ランク判定', () => {
  it('基準の下限ちょうどで各ランクになり、KPMが1足りなければ一つ下になる', () => {
    expect(evaluateRank({ ...base, kpm: 120 })).toBe('S')
    expect(evaluateRank({ ...base, kpm: 119 })).toBe('A')
    expect(evaluateRank({ ...base, kpm: 100, accuracy: 97 })).toBe('A')
    expect(evaluateRank({ ...base, kpm: 99, accuracy: 100 })).toBe('B')
    expect(evaluateRank({ ...base, kpm: 80, accuracy: 93 })).toBe('B')
    expect(evaluateRank({ ...base, kpm: 79, accuracy: 100 })).toBe('C')
    expect(evaluateRank({ ...base, kpm: 60, accuracy: 88 })).toBe('C')
    expect(evaluateRank({ ...base, kpm: 59, accuracy: 100 })).toBe('D')
    expect(evaluateRank({ ...base, kpm: 40, accuracy: 80 })).toBe('D')
    expect(evaluateRank({ ...base, kpm: 39, accuracy: 100 })).toBe('E')
    expect(evaluateRank({ ...base, kpm: 20, accuracy: 70 })).toBe('E')
    expect(evaluateRank({ ...base, kpm: 19, accuracy: 100 })).toBe('F')
  })

  it('正解率が1足りない場合も一つ下の基準で判定する', () => {
    expect(evaluateRank({ ...base, kpm: 100, accuracy: 96 })).toBe('B')
    expect(evaluateRank({ ...base, kpm: 80, accuracy: 92 })).toBe('C')
    expect(evaluateRank({ ...base, kpm: 60, accuracy: 87 })).toBe('D')
    expect(evaluateRank({ ...base, kpm: 40, accuracy: 79 })).toBe('E')
    expect(evaluateRank({ ...base, kpm: 20, accuracy: 69 })).toBe('F')
  })

  it('SはKPM・ノーミス・正しい入力50回のすべてが必要', () => {
    expect(evaluateRank({ ...base, kpm: 119 })).toBe('A')
    expect(evaluateRank({ ...base, kpm: 120, mistakes: 1 })).toBe('A')
    expect(evaluateRank({ ...base, kpm: 120, correctCount: 49 })).toBe('A')
  })

  it('KPMがnullならランクなしにする', () => {
    expect(evaluateRank({ ...base, kpm: null })).toBeNull()
  })

  it('基準を一か所から返し、将来のレベル補正の入口とversionを持つ', () => {
    expect(RANK_VERSION).toBe(1)
    expect(getRankTable(1)).toBe(getRankTable(3))
    expect(getRankTable(2).A).toEqual({ kpm: 100, accuracy: 97 })
  })

  it('次のランクへ足りない条件だけを説明する', () => {
    expect(describeNextRank({ ...base, rank: 'F', kpm: 18, accuracy: 65 })).toMatchObject({
      targetRank: 'E', requirements: ['KPMあと2', '正解率あと5%'],
    })
    expect(describeNextRank({ ...base, rank: 'A', kpm: 118, mistakes: 2, correctCount: 47 })).toMatchObject({
      targetRank: 'S', requirements: ['KPMあと2', 'ノーミス', '正しい入力あと3回'],
    })
    expect(describeNextRank({ ...base, rank: 'S', kpm: 120 }).text).toBe('最高ランク')
    expect(describeNextRank({ ...base, kpm: null })).toBeNull()
  })
})
