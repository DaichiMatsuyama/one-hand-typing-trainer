import { describe, expect, it } from 'vitest'
import {
  MIN_SHOWN_FOR_RATE,
  accuracyPercent,
  accuracyPoints,
  dailyBars,
  formatDateLabel,
  formatJstDate,
  formatPracticeTime,
  heatLevel,
  isReviewStats,
  keyMissStats,
  shortDeviceId,
  summarizeDaily,
  weakestKeys,
} from './review.js'

describe('isReviewStats', () => {
  const valid = {
    totals: { records: 1, practiceMs: 1000, days: 1 },
    today: { records: 1, practiceMs: 1000, attempts: 2, mistakes: 1 },
    streak: 1,
    daily: [{ date: '2026-11-04', records: 1, practiceMs: 1000, attempts: 2, mistakes: 1 }],
    keys: { a: { shown: 2, misses: 1 } },
    confusions: [{ expected: 'a', pressed: 's', count: 1 }],
  }

  it('描画に必要な集計の形を受け入れる', () => {
    expect(isReviewStats(valid)).toBe(true)
  })

  it.each([
    ['dailyの要素', { daily: [null] }],
    ['confusionsの要素', { confusions: [null] }],
    ['keysの値', { keys: { a: null } }],
    ['totalsの数値', { totals: { records: '1', practiceMs: 1000, days: 1 } }],
    ['todayの数値', { today: { records: 1, practiceMs: 1000, attempts: null, mistakes: 1 } }],
    ['streakの数値', { streak: '1' }],
  ])('%sが不正なら拒否する', (_label, replacement) => {
    expect(isReviewStats({ ...valid, ...replacement })).toBe(false)
  })
})

describe('accuracyPercent', () => {
  it('タップ数が0ならnull、それ以外は正しく押した割合', () => {
    expect(accuracyPercent(0, 0)).toBeNull()
    expect(accuracyPercent(10, 0)).toBe(100)
    expect(accuracyPercent(8, 2)).toBe(75)
    expect(accuracyPercent(3, 1)).toBe(67)
  })
})

describe('formatPracticeTime', () => {
  it.each([
    [0, '0秒'],
    [45_000, '45秒'],
    [59_400, '59秒'],
    [60_000, '1分'],
    [3_540_000, '59分'],
    [3_600_000, '1時間'],
    [5_400_000, '1時間30分'],
    [-100, '0秒'],
  ])('%i ms → %s', (ms, expected) => {
    expect(formatPracticeTime(ms)).toBe(expected)
  })
})

describe('日付の表示', () => {
  it('yyyy-MM-dd を M/D にする', () => {
    expect(formatDateLabel('2026-11-03')).toBe('11/3')
    expect(formatDateLabel('2026-01-09')).toBe('1/9')
    expect(formatDateLabel('broken')).toBe('broken')
  })

  it('UTCのミリ秒を日本時間の日付にする(UTC 15:00で日が変わる)', () => {
    expect(formatJstDate(Date.UTC(2026, 10, 2, 14, 59))).toBe('11/2')
    expect(formatJstDate(Date.UTC(2026, 10, 2, 15, 0))).toBe('11/3')
  })

  it('端末IDは先頭8文字だけ見せる', () => {
    expect(shortDeviceId('91ff49ca-0ad4-431b-acc7-771d93c7a64a')).toBe('91ff49ca')
  })
})

describe('キーごとのミス', () => {
  const keys = {
    a: { shown: 10, misses: 0 },
    s: { shown: 10, misses: 1 },
    d: { shown: 10, misses: 2 },
    f: { shown: 10, misses: 4 },
    g: { shown: 10, misses: 8 },
    h: { shown: MIN_SHOWN_FOR_RATE - 1, misses: 2 },
  }

  it('出題回数が少ないキーは、割合を色分けに使わない', () => {
    const stats = keyMissStats(keys)
    expect(stats.h.enough).toBe(false)
    expect(heatLevel(stats.h)).toBe('none')
    expect(heatLevel(undefined)).toBe('none')
  })

  it('ミスの割合で色の段階を分ける', () => {
    const stats = keyMissStats(keys)
    expect(heatLevel(stats.a)).toBe('clean')
    expect(heatLevel(stats.s)).toBe('l2') // 10%
    expect(heatLevel(stats.d)).toBe('l2') // 20%
    expect(heatLevel(stats.f)).toBe('l3') // 40%
    expect(heatLevel(stats.g)).toBe('l4') // 80%
    expect(heatLevel({ enough: true, misses: 1, rate: 0.05 })).toBe('l1')
  })

  it('苦手なキーは、ミスの割合が高い順(同じなら回数が多い順)で、十分な出題があるものだけ', () => {
    expect(weakestKeys(keys, 3).map((item) => item.key)).toEqual(['g', 'f', 'd'])
    expect(weakestKeys({ x: { shown: 10, misses: 2 }, y: { shown: 5, misses: 1 } }, 5).map((item) => item.key))
      .toEqual(['x', 'y'])
    expect(weakestKeys({ a: { shown: 10, misses: 0 } })).toEqual([])
    expect(weakestKeys(undefined)).toEqual([])
  })

  it('壊れた値は0として扱う', () => {
    expect(keyMissStats({ a: { shown: 'x', misses: null }, b: null }).a).toMatchObject({ shown: 0, misses: 0, enough: false })
    expect(keyMissStats({ b: null }).b).toMatchObject({ shown: 0, misses: 0 })
  })
})

describe('グラフ用データ', () => {
  const daily = [
    { date: '2026-11-01', records: 2, practiceMs: 120_000, attempts: 20, mistakes: 5 },
    { date: '2026-11-02', records: 0, practiceMs: 0, attempts: 0, mistakes: 0 },
    { date: '2026-11-03', records: 1, practiceMs: 30_000, attempts: 10, mistakes: 0 },
  ]

  it('棒の高さは最大の日を1とした割合で、練習した日は短くても見える', () => {
    const bars = dailyBars(daily)
    expect(bars.map((bar) => bar.ratio)).toEqual([1, 0, 0.25])
    expect(bars.map((bar) => bar.minutes)).toEqual([2, 0, 1])
    expect(dailyBars([{ date: '2026-11-03', practiceMs: 1, records: 1, attempts: 1, mistakes: 0 },
      { date: '2026-11-04', practiceMs: 1_000_000, records: 1, attempts: 1, mistakes: 0 }])[0].ratio).toBe(0.04)
    expect(dailyBars([])).toEqual([])
    expect(dailyBars([{ date: '2026-11-03', practiceMs: 0 }])[0].ratio).toBe(0)
  })

  it('正答率の点は、練習した日だけで、日付の並び順の位置を持つ', () => {
    expect(accuracyPoints(daily)).toEqual([
      { index: 0, date: '2026-11-01', label: '11/1', percent: 75 },
      { index: 2, date: '2026-11-03', label: '11/3', percent: 100 },
    ])
  })

  it('直近の練習日数と合計時間をまとめる', () => {
    expect(summarizeDaily(daily)).toEqual({ practicedDays: 2, practiceMs: 150_000 })
    expect(summarizeDaily(undefined)).toEqual({ practicedDays: 0, practiceMs: 0 })
  })
})
