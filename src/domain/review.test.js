import { describe, expect, it } from 'vitest'
import {
  MIN_SHOWN_FOR_RATE,
  accuracyPercent,
  accuracyPoints,
  dailyBars,
  formatDateLabel,
  formatConditionLabel,
  formatJstDate,
  formatJstDateTime,
  formatPracticeTime,
  heatLevel,
  homePositionSummary,
  isReviewStats,
  kpmSeries,
  keyMissStats,
  listRunConditions,
  personalBestItems,
  recentRunItems,
  runRank,
  sanitizeReviewStats,
  sanitizeRuns,
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

  it('旧GASのrunsなしと、不正なruns自体は既存集計を壊さない', () => {
    expect(isReviewStats(valid)).toBe(true)
    expect(isReviewStats({ ...valid, runs: 'broken' })).toBe(true)
    expect(sanitizeReviewStats({ ...valid, runs: 'broken' })).not.toHaveProperty('runs')
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

const run = (overrides = {}) => ({
  ts: '2026-11-03T03:04:00.000Z',
  mode: 'timeAttack',
  hand: 'left',
  level: 1,
  includeSymbols: false,
  layout: 'jis',
  targetCount: 10,
  timeLimitSec: null,
  homePosition: false,
  endedBy: 'completed',
  activeMs: 12_000,
  inputMs: 10_000,
  completedQuestions: 10,
  correctCount: 40,
  mistakes: 2,
  attempts: 42,
  accuracy: 95,
  kpm: 240,
  menuOpenCount: 0,
  hpSuccessCount: 0,
  hpSkipCount: 0,
  hpAvgReturnMs: null,
  hpMinReturnMs: null,
  rankVersion: null,
  ...overrides,
})

describe('runsの検証と最近の練習', () => {
  it('行ごとに検証し、不正行だけを捨てる。旧24列相当のHP nullとboolean rankVersionは受け入れる', () => {
    const legacy = run({
      hpSuccessCount: null, hpSkipCount: null, hpAvgReturnMs: null, hpMinReturnMs: null,
      rankVersion: true,
    })
    const actual = sanitizeRuns([
      legacy,
      run({ hand: 'both' }),
      run({ attempts: 43 }),
      run({ kpm: 999 }),
      null,
    ])
    expect(actual).toEqual([legacy])
    expect(sanitizeRuns(undefined)).toEqual([])
  })

  it('直近8回を新しい順にし、日本時間・モード・ランク・HP・途中を整形する', () => {
    const items = recentRunItems([
      run({ ts: '2026-11-02T15:01:00.000Z', kpm: 240 }),
      run({
        ts: '2026-11-03T15:05:00.000Z', mode: 'timeLimit', targetCount: null,
        timeLimitSec: 60, endedBy: 'ended', homePosition: true,
      }),
      run({
        ts: '2026-11-03T14:00:00.000Z', mode: 'free', targetCount: null,
        endedBy: 'ended', kpm: 240,
      }),
    ])
    expect(items.map((item) => item.dateTime)).toEqual(['11/4 0:05', '11/3 23:00', '11/3 0:01'])
    expect(items[0]).toMatchObject({ mode: '制限時間60秒', rank: null, homePosition: true, interrupted: true })
    expect(items[1]).toMatchObject({ mode: 'フリー', rank: null, interrupted: false })
    expect(items[2]).toMatchObject({ mode: 'タイムアタック10問', rank: 'B' })
    expect(formatJstDateTime('broken')).toBe('broken')
    expect(runRank(run({ rankVersion: 999 }))).toBe('B')
    expect(recentRunItems(Array.from({ length: 9 }, (_, index) => run({
      ts: `2026-10-${String(index + 1).padStart(2, '0')}T03:00:00Z`,
    })))).toHaveLength(8)
  })
})

describe('run条件・自己ベスト・KPM系列', () => {
  it('8条件を区別し、最近練習した順・最低回数・最大数で条件を列挙する', () => {
    const values = [
      run({ ts: '2026-11-03T04:00:00Z', hand: 'right' }),
      run({ ts: '2026-11-03T03:00:00Z', hand: 'right' }),
      run({ ts: '2026-11-03T02:00:00Z', level: 2 }),
      run({ ts: '2026-11-03T01:00:00Z', level: 2 }),
      run({ ts: '2026-11-03T00:00:00Z', includeSymbols: true }),
    ]
    const conditions = listRunConditions(values, { minRuns: 2, limit: 1 })
    expect(conditions).toHaveLength(1)
    expect(conditions[0]).toMatchObject({ count: 2 })
    expect(conditions[0].label).toContain('右手')
    expect(formatConditionLabel(run({ homePosition: true, layout: 'us' }))).toBe(
      'タイムアタック10問・左手・Lv.1・記号なし・US・HPあり',
    )

    const fiveConditions = Array.from({ length: 5 }, (_, index) => [
      run({ ts: `2026-10-${String(index + 1).padStart(2, '0')}T04:00:00Z`, targetCount: index + 1 }),
      run({ ts: `2026-10-${String(index + 1).padStart(2, '0')}T03:00:00Z`, targetCount: index + 1 }),
    ]).flat()
    expect(listRunConditions(fiveConditions, { minRuns: 2, limit: 4 })).toHaveLength(4)
  })

  it('条件ごとにランク→KPMで最良を選び、フリー・途中・メニュー使用・KPMなしを除く。同点は新しい回を保つ', () => {
    const newestTie = run({ ts: '2026-11-04T03:00:00Z', kpm: 240 })
    const results = personalBestItems([
      newestTie,
      run({ ts: '2026-11-03T03:00:00Z', kpm: 240 }),
      run({ ts: '2026-11-01T03:00:00Z', menuOpenCount: 1 }),
      run({ ts: '2026-10-31T03:00:00Z', endedBy: 'ended' }),
      run({
        ts: '2026-10-30T03:00:00Z', mode: 'free', targetCount: null, endedBy: 'ended',
      }),
    ])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ rank: 'B', kpm: 240, run: newestTie })
    const sRank = run({
      ts: '2026-11-02T03:00:00Z', activeMs: 26_000, inputMs: 25_000,
      correctCount: 50, mistakes: 0, attempts: 50, accuracy: 100, kpm: 120,
    })
    expect(personalBestItems([newestTie, sRank])[0]).toMatchObject({ rank: 'S', kpm: 120, run: sRank })
    expect(personalBestItems([run({ kpm: null })])).toEqual([])
    expect(personalBestItems(Array.from({ length: 9 }, (_, index) => run({
      ts: `2026-10-${String(index + 1).padStart(2, '0')}T03:00:00Z`, targetCount: index + 1,
    })))).toHaveLength(8)
  })

  it('KPM系列は同条件だけ・途中終了とnullを除き、直近15回を古い順にする(フリーのendedは完了扱い)', () => {
    const target = run()
    const values = Array.from({ length: 17 }, (_, index) => run({
      ts: `2026-11-${String(index + 1).padStart(2, '0')}T03:00:00Z`,
      kpm: 240,
    }))
    values.push(run({ ts: '2026-11-20T03:00:00Z', endedBy: 'ended' }))
    values.push(run({ ts: '2026-11-21T03:00:00Z', hand: 'right' }))
    const series = kpmSeries(values, target)
    expect(series).toHaveLength(15)
    expect(series[0].ts).toContain('11-03')
    expect(series.at(-1).ts).toContain('11-17')

    const free = run({ mode: 'free', targetCount: null, endedBy: 'ended' })
    expect(kpmSeries([free], free)).toHaveLength(1)
    expect(kpmSeries([run({ kpm: null })], target)).toEqual([])
  })
})

describe('ホームポジションの成績', () => {
  it('成功回数で加重した平均と合計を出し、グラフは直近10回を古い順にする', () => {
    const values = Array.from({ length: 12 }, (_, index) => run({
      ts: `2026-10-${String(index + 1).padStart(2, '0')}T03:00:00Z`,
      homePosition: true,
      hpSuccessCount: index === 0 ? 2 : 1,
      hpSkipCount: 1,
      hpAvgReturnMs: index === 0 ? 2000 : 1000,
      hpMinReturnMs: 500,
      activeMs: 20_000,
    }))
    values.push(run({ ts: '2026-11-01T03:00:00Z' }))
    const summary = homePositionSummary(values)
    expect(summary).toMatchObject({ hasRuns: true, successCount: 13, skipCount: 12, avgReturnMs: 1154 })
    expect(summary.points).toHaveLength(10)
    expect(summary.points[0].ts).toContain('10-03')
    expect(summary.points.at(-1).ts).toContain('10-12')
  })

  it('旧行だけでもセクション対象にし、未知の回数は合計へ足さない', () => {
    expect(homePositionSummary([run({
      homePosition: true,
      hpSuccessCount: null, hpSkipCount: null, hpAvgReturnMs: null, hpMinReturnMs: null,
    })])).toMatchObject({ hasRuns: true, successCount: 0, skipCount: 0, avgReturnMs: null, points: [] })
    expect(homePositionSummary([]).hasRuns).toBe(false)
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
