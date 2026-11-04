import { describe, expect, it, vi } from 'vitest'
import { MESSAGE_GROUPS, selectMessage } from './messages.js'

const base = { rank: 'C', rankUp: false, personalBest: null, isFirstPractice: false, growth: { improvements: [] }, weakKeys: [], endedEarly: false }

describe('応援メッセージ', () => {
  it('全状況に3パターン以上を用意する', () => {
    Object.values(MESSAGE_GROUPS).forEach((messages) => expect(messages.length).toBeGreaterThanOrEqual(3))
  })

  it('注入した乱数で決定的に選べる', () => {
    expect(selectMessage(base, () => 0).id).toBe('general-c-1')
    expect(selectMessage(base, () => 0.999).id).toBe('general-c-3')
  })

  it('直前と同じmessageIdを候補から外す', () => {
    expect(selectMessage({ ...base, previousMessageId: 'general-c-1' }, () => 0).id).toBe('general-c-2')
  })

  it('S、ランクアップ、自己ベスト、初回、正解率、速度、苦手、途中終了の順で優先する', () => {
    const crowded = {
      ...base,
      rank: 'S', rankUp: true, personalBest: { isNewBest: true }, isFirstPractice: true,
      growth: { improvements: [{ type: 'accuracy' }, { type: 'kpm' }] },
      weakKeys: [{ key: 'a' }], endedEarly: true,
    }
    expect(selectMessage(crowded, () => 0).id).toMatch(/^s-/)
    expect(selectMessage({ ...crowded, rank: 'A' }, () => 0).id).toMatch(/^rank-up-/)
    expect(selectMessage({ ...crowded, rank: 'A', rankUp: false }, () => 0).id).toMatch(/^best-/)
    expect(selectMessage({ ...crowded, rank: 'A', rankUp: false, personalBest: null }, () => 0).id).toMatch(/^first-/)
    expect(selectMessage({ ...crowded, rank: 'A', rankUp: false, personalBest: null, isFirstPractice: false }, () => 0).id).toMatch(/^accuracy-/)
    expect(selectMessage({ ...crowded, rank: 'A', rankUp: false, personalBest: null, isFirstPractice: false, growth: { improvements: [{ type: 'kpm' }] } }, () => 0).id).toMatch(/^speed-/)
    expect(selectMessage({ ...crowded, rank: 'A', rankUp: false, personalBest: null, isFirstPractice: false, growth: { improvements: [] } }, () => 0).id).toMatch(/^weak-/)
    expect(selectMessage({ ...crowded, rank: 'A', rankUp: false, personalBest: null, isFirstPractice: false, growth: { improvements: [] }, weakKeys: [] }, () => 0).id).toMatch(/^ended-/)
  })

  it('乱数関数を一度だけ呼ぶ', () => {
    const random = vi.fn(() => 0)
    selectMessage(base, random)
    expect(random).toHaveBeenCalledTimes(1)
  })
})
