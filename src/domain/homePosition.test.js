import { describe, expect, it } from 'vitest'
import {
  MAX_RETURN_MS,
  createHomePositionStats,
  describeHomePositionAnnouncement,
  describeHomePositionGuide,
  formatHomePositionKeys,
  formatReturnSeconds,
  getHomePositionKeys,
  recordHomePositionSkip,
  recordHomePositionSuccess,
  summarizeHomePosition,
} from './homePosition.js'

describe('homePosition', () => {
  it('手ごとの対象4キーと案内の表記', () => {
    expect(getHomePositionKeys('left')).toEqual(['a', 's', 'd', 'f'])
    expect(getHomePositionKeys('right')).toEqual(['j', 'k', 'l', ';'])
    expect(formatHomePositionKeys('left')).toBe('A S D F')
    expect(formatHomePositionKeys('right')).toBe('J K L ;')
    expect(describeHomePositionGuide('left', false)).toBe('A S D F に指を置いてください')
    expect(describeHomePositionGuide('right', true)).toBe('確認できました。指を離すと次へ進みます')
    expect(describeHomePositionAnnouncement('left', false))
      .toBe('ホームポジション確認。A S D F に指を置いてください')
    expect(describeHomePositionAnnouncement('left', true)).toBe('確認できました。指を離すと次へ進みます')
  })

  it('返した配列を書き換えても定義は変わらない', () => {
    getHomePositionKeys('left').push('x')
    expect(getHomePositionKeys('left')).toEqual(['a', 's', 'd', 'f'])
  })

  it('成功・スキップを集計し、平均は四捨五入、最短は最小値', () => {
    let stats = createHomePositionStats()
    for (const ms of [1000, 2000, 500]) stats = recordHomePositionSuccess(stats, ms)
    stats = recordHomePositionSkip(recordHomePositionSkip(stats))
    expect(summarizeHomePosition(true, stats)).toEqual({
      homePosition: true, hpSuccessCount: 3, hpSkipCount: 2, hpAvgReturnMs: 1167, hpMinReturnMs: 500,
    })
  })

  it('成功が0回なら平均・最短はnull', () => {
    const stats = recordHomePositionSkip(createHomePositionStats())
    expect(summarizeHomePosition(true, stats)).toEqual({
      homePosition: true, hpSuccessCount: 0, hpSkipCount: 1, hpAvgReturnMs: null, hpMinReturnMs: null,
    })
  })

  it('OFFのrunは集計があっても回数0・時間nullに固定する', () => {
    const stats = recordHomePositionSuccess(createHomePositionStats(), 700)
    expect(summarizeHomePosition(false, stats)).toEqual({
      homePosition: false, hpSuccessCount: 0, hpSkipCount: 0, hpAvgReturnMs: null, hpMinReturnMs: null,
    })
    expect(summarizeHomePosition(true, undefined).homePosition).toBe(false)
  })

  it('復帰時間は整数にまるめ、0以上・上限以内に収める', () => {
    expect(recordHomePositionSuccess(createHomePositionStats(), 12.6).minReturnMs).toBe(13)
    expect(recordHomePositionSuccess(createHomePositionStats(), -5).minReturnMs).toBe(0)
    expect(recordHomePositionSuccess(createHomePositionStats(), Number.NaN).minReturnMs).toBe(0)
    expect(recordHomePositionSuccess(createHomePositionStats(), 1e12).minReturnMs).toBe(MAX_RETURN_MS)
  })

  it('最短は常に平均以下になる', () => {
    let stats = createHomePositionStats()
    for (const ms of [3, 4, 4]) stats = recordHomePositionSuccess(stats, ms)
    const summary = summarizeHomePosition(true, stats)
    expect(summary.hpMinReturnMs).toBeLessThanOrEqual(summary.hpAvgReturnMs)
  })

  it('秒表示は小数1桁、ない値は「-」', () => {
    expect(formatReturnSeconds(1234)).toBe('1.2秒')
    expect(formatReturnSeconds(950)).toBe('1.0秒')
    expect(formatReturnSeconds(0)).toBe('0.0秒')
    expect(formatReturnSeconds(12_345)).toBe('12.3秒')
    expect(formatReturnSeconds(null)).toBe('-')
    expect(formatReturnSeconds(undefined)).toBe('-')
  })
})
