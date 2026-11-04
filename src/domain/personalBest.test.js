import { describe, expect, it } from 'vitest'
import { analyzeGrowth, analyzePersonalBest, hasSameConditions } from './personalBest.js'

function record(overrides = {}) {
  return {
    mode: 'timeAttack', hand: 'left', level: 1, targetCount: 10, timeLimitSec: null,
    homePosition: false, includeSymbols: false, layout: 'jis', endedBy: 'completed',
    menuOpenCount: 0, kpm: 80, accuracy: 93, correctCount: 60, mistakes: 2,
    ...overrides,
  }
}

describe('自己ベストと成長', () => {
  it('8つの条件がすべて一致する記録だけを比較する', () => {
    const current = record({ kpm: 81 })
    for (const [field, value] of [
      ['mode', 'timeLimit'], ['hand', 'right'], ['level', 2], ['targetCount', 20],
      ['timeLimitSec', 60], ['homePosition', true], ['includeSymbols', true], ['layout', 'us'],
    ]) {
      expect(hasSameConditions(current, record({ [field]: value })), field).toBe(false)
    }
    expect(analyzePersonalBest(current, [record({ hand: 'right', kpm: 200 })]).isFirst).toBe(true)
  })

  it('過去のメニュー使用回と途中終了回を候補から除外する', () => {
    const result = analyzePersonalBest(record({ kpm: 81 }), [
      record({ kpm: 200, menuOpenCount: 1 }),
      record({ kpm: 180, endedBy: 'ended' }),
    ])
    expect(result).toMatchObject({ eligible: true, isFirst: true, isNewBest: false })
  })

  it('今回のメニュー使用・途中終了は更新判定せず理由を返す', () => {
    expect(analyzePersonalBest(record({ menuOpenCount: 1 }), [])).toMatchObject({ eligible: false, reason: 'menu' })
    expect(analyzePersonalBest(record({ endedBy: 'ended' }), [])).toMatchObject({ eligible: false, reason: 'ended' })
  })

  it('同点は更新せず、KPMよりランクを優先する', () => {
    expect(analyzePersonalBest(record(), [record()]).isNewBest).toBe(false)
    expect(analyzePersonalBest(
      record({ kpm: 80, accuracy: 93 }),
      [record({ kpm: 99, accuracy: 92 })],
    ).isNewBest).toBe(true)
  })

  it('同条件の直前の完了記録から、良くなった項目だけを返す', () => {
    const growth = analyzeGrowth(
      record({ kpm: 90, accuracy: 96, mistakes: 2 }),
      [record({ hand: 'right', kpm: 1 }), record({ kpm: 80, accuracy: 93, mistakes: 4 }), record({ kpm: 10 })],
    )
    expect(growth.improvements.map(({ type }) => type)).toEqual(['kpm', 'accuracy', 'mistakes'])
    expect(growth.improvements.map(({ text }) => text).join(' ')).toContain('ミスが2回減りました')

    expect(analyzeGrowth(record({ kpm: 70, accuracy: 90, mistakes: 5 }), [record()]).improvements).toEqual([])
  })

  it('フリーはendedを完了扱いにし、競技モードではendedを除外する', () => {
    const freePrevious = record({ mode: 'free', targetCount: null, endedBy: 'ended', kpm: 40, accuracy: 80 })
    const freeGrowth = analyzeGrowth(
      record({ mode: 'free', targetCount: null, endedBy: 'ended', kpm: 50, accuracy: 90 }),
      [freePrevious],
    )
    expect(freeGrowth.previous).toBe(freePrevious)
    expect(freeGrowth.improvements.map(({ type }) => type)).toEqual(['kpm', 'accuracy'])

    expect(analyzeGrowth(record({ kpm: 90 }), [record({ endedBy: 'ended', kpm: 80 })]).previous).toBeNull()
  })
})
