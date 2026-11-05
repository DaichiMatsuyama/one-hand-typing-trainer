// 振り返り画面の表示用に、GASの集計(stats)を整える純粋な関数群

import { comparePerformance, CONDITION_FIELDS, hasSameConditions, isBestCandidate } from './personalBest.js'
import { evaluateRank } from './rank.js'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// キーごとのミスの割合を出すのに必要な、最低限の出題回数(少なすぎる回数の割合は信用しない)
export const MIN_SHOWN_FOR_RATE = 3

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasNumbers(value, fields) {
  return isObject(value) && fields.every((field) => Number.isFinite(value[field]))
}

/** 振り返り画面が描画に使うGAS集計の形かを確認する。 */
export function isReviewStats(value) {
  if (!isObject(value)
    || !hasNumbers(value.totals, ['records', 'practiceMs', 'days'])
    || !hasNumbers(value.today, ['records', 'practiceMs', 'attempts', 'mistakes'])
    || !Number.isFinite(value.streak)
    || !Array.isArray(value.daily)
    || !isObject(value.keys)
    || !Array.isArray(value.confusions)) return false

  const validDaily = value.daily.every((day) => (
    hasNumbers(day, ['records', 'practiceMs', 'attempts', 'mistakes'])
    && typeof day.date === 'string'
  ))
  const validKeys = Object.values(value.keys).every((key) => hasNumbers(key, ['shown', 'misses']))
  const validConfusions = value.confusions.every((item) => (
    isObject(item)
    && typeof item.expected === 'string'
    && typeof item.pressed === 'string'
    && Number.isFinite(item.count)
  ))
  return validDaily && validKeys && validConfusions
}

function isInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isInteger(value) && value >= min && value <= max
}

function nullableInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return value === null || isInteger(value, min, max)
}

function isValidRun(value) {
  if (!isObject(value)
    || typeof value.ts !== 'string' || !Number.isFinite(Date.parse(value.ts))
    || !['free', 'timeAttack', 'timeLimit'].includes(value.mode)
    || !['left', 'right'].includes(value.hand)
    || !isInteger(value.level, 1, 3)
    || typeof value.includeSymbols !== 'boolean'
    || !['jis', 'us'].includes(value.layout)
    || typeof value.homePosition !== 'boolean'
    || !['completed', 'timeUp', 'ended'].includes(value.endedBy)
    || !isInteger(value.activeMs, 0, 86_400_000)
    || !isInteger(value.inputMs, 0, 86_400_000)
    || value.inputMs > value.activeMs + 1000
    || !isInteger(value.completedQuestions, 0, 100_000)
    || !isInteger(value.correctCount, 0, 100_000)
    || !isInteger(value.mistakes, 0, 100_000)
    || !isInteger(value.attempts, 1, 100_000)
    || value.correctCount + value.mistakes !== value.attempts
    || !isInteger(value.accuracy, 0, 100)
    || value.accuracy !== Math.round(value.correctCount / value.attempts * 100)
    || !nullableInteger(value.kpm, 0, 6_000_001)
    || !isInteger(value.menuOpenCount, 0, 1000)
    || !(value.rankVersion === null || typeof value.rankVersion === 'boolean'
      || isInteger(value.rankVersion, 0, 999))) return false

  if (value.mode === 'free' && (value.targetCount !== null || value.timeLimitSec !== null)) return false
  if (value.mode === 'timeAttack'
    && (!isInteger(value.targetCount, 1, 1000) || value.timeLimitSec !== null)) return false
  if (value.mode === 'timeLimit'
    && (!isInteger(value.timeLimitSec, 1, 3600) || value.targetCount !== null)) return false
  if ((value.endedBy === 'completed' && value.mode !== 'timeAttack')
    || (value.endedBy === 'timeUp' && value.mode !== 'timeLimit')) return false
  if (value.kpm !== null) {
    if (value.inputMs < 1000) return false
    const expectedKpm = Math.round(value.correctCount / (value.inputMs / 60_000))
    if (Math.abs(value.kpm - expectedKpm) > 1) return false
  }

  const hpValues = [value.hpSuccessCount, value.hpSkipCount, value.hpAvgReturnMs, value.hpMinReturnMs]
  const legacyHomePosition = hpValues.every((item) => item === null)
  if (!legacyHomePosition) {
    if (!isInteger(value.hpSuccessCount, 0, 100_000)
      || !isInteger(value.hpSkipCount, 0, 100_000)
      || !nullableInteger(value.hpAvgReturnMs, 0, 86_400_000)
      || !nullableInteger(value.hpMinReturnMs, 0, 86_400_000)) return false
    if (!value.homePosition && (value.hpSuccessCount !== 0 || value.hpSkipCount !== 0
      || value.hpAvgReturnMs !== null || value.hpMinReturnMs !== null)) return false
    if (value.hpSuccessCount === 0 && (value.hpAvgReturnMs !== null || value.hpMinReturnMs !== null)) return false
    if (value.hpSuccessCount > 0 && (value.hpAvgReturnMs === null || value.hpMinReturnMs === null)) return false
    if (value.hpMinReturnMs !== null && value.hpMinReturnMs > value.hpAvgReturnMs) return false
    if (value.homePosition && value.hpSuccessCount + value.hpSkipCount > value.completedQuestions) return false
    if (value.hpAvgReturnMs !== null
      && (value.hpAvgReturnMs > value.activeMs
        || value.hpAvgReturnMs * value.hpSuccessCount > value.activeMs + 1000)) return false
  }
  return true
}

/** GASのrunsを行単位で検証する。不正な行や旧GASのrunsなしは、既存集計から切り離す。 */
export function sanitizeRuns(value) {
  return Array.isArray(value) ? value.filter(isValidRun) : []
}

/** キャッシュ/API応答の既存集計は保ち、runsだけを安全な配列へ整える。 */
export function sanitizeReviewStats(value) {
  if (!isObject(value)) return value
  const { runs: _runs, ...base } = value
  return Array.isArray(value.runs) ? { ...base, runs: sanitizeRuns(value.runs) } : base
}

export function accuracyPercent(attempts, mistakes) {
  if (!attempts) return null
  return Math.round(((attempts - mistakes) / attempts) * 100)
}

// 練習時間を日本語で。1分未満は秒、1時間未満は分、それ以上は時間+分
export function formatPracticeTime(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}秒`
  const totalMinutes = Math.round(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}分`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`
}

// 'yyyy-MM-dd' → 'M/D'
export function formatDateLabel(date) {
  const [, month, day] = String(date).split('-')
  if (!month || !day) return String(date)
  return `${Number(month)}/${Number(day)}`
}

// ミリ秒(UTC)を日本時間の 'M/D' に
export function formatJstDate(ms) {
  const iso = new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10)
  return formatDateLabel(iso)
}

// ISO日時を日本時間の 'M/D H:mm' に
export function formatJstDateTime(value) {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return String(value)
  const shifted = new Date(ms + JST_OFFSET_MS)
  return `${shifted.getUTCMonth() + 1}/${shifted.getUTCDate()} ${shifted.getUTCHours()}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`
}

export function runRank(run) {
  if (!['timeAttack', 'timeLimit'].includes(run?.mode) || run?.endedBy === 'ended') return null
  return evaluateRank(run)
}

export function formatRunMode(run) {
  if (run?.mode === 'timeAttack') return `タイムアタック${run.targetCount}問`
  if (run?.mode === 'timeLimit') return `制限時間${run.timeLimitSec}秒`
  return 'フリー'
}

export function conditionKey(run) {
  return CONDITION_FIELDS.map((field) => JSON.stringify(run?.[field])).join('|')
}

export function formatConditionLabel(run) {
  return [
    formatRunMode(run),
    run?.hand === 'right' ? '右手' : '左手',
    `Lv.${run?.level}`,
    run?.includeSymbols ? '記号あり' : '記号なし',
    String(run?.layout ?? '').toUpperCase(),
    run?.homePosition ? 'HPあり' : 'HPなし',
  ].join('・')
}

function newestFirst(runs) {
  return [...sanitizeRuns(runs)].sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts))
}

/** 「最近の練習」の表示に必要な文言を、直近順に整える。 */
export function recentRunItems(runs, limit = 8) {
  return newestFirst(runs).slice(0, limit).map((run) => ({
    run,
    dateTime: formatJstDateTime(run.ts),
    mode: formatRunMode(run),
    rank: runRank(run),
    kpm: run.kpm,
    accuracy: run.accuracy,
    homePosition: run.homePosition,
    interrupted: run.mode !== 'free' && run.endedBy === 'ended',
  }))
}

/** 条件を最新runの順に重複なく列挙する。minRunsは系列に採用できる回数で絞る。 */
export function listRunConditions(runs, { minRuns = 1, limit = Infinity } = {}) {
  const ordered = newestFirst(runs)
  const counts = new Map()
  ordered.forEach((run) => counts.set(conditionKey(run), (counts.get(conditionKey(run)) ?? 0) + 1))
  const seen = new Set()
  const result = []
  for (const run of ordered) {
    const key = conditionKey(run)
    if (seen.has(key) || counts.get(key) < minRuns) continue
    seen.add(key)
    result.push({ key, label: formatConditionLabel(run), run, count: counts.get(key) })
    if (result.length >= limit) break
  }
  return result
}

/** 条件ごとの最良記録。条件の並びは、その条件を最後に練習した順。 */
export function personalBestItems(runs, limit = 8) {
  const ordered = newestFirst(runs)
  const conditions = listRunConditions(ordered)
  const result = []
  for (const condition of conditions) {
    const best = ordered
      .filter((run) => hasSameConditions(run, condition.run)
        && isBestCandidate(run) && runRank(run) !== null)
      .reduce((current, run) => (!current || comparePerformance(run, current) > 0 ? run : current), null)
    if (!best) continue
    result.push({ key: condition.key, label: condition.label, rank: runRank(best), kpm: best.kpm, run: best })
    if (result.length >= limit) break
  }
  return result
}

/** 選択条件のKPMを、直近最大15回・古い順で返す。途中終了とKPMなしは除く。 */
export function kpmSeries(runs, condition, limit = 15) {
  if (!condition) return []
  return newestFirst(runs)
    .filter((run) => hasSameConditions(run, condition)
      && !(run.mode !== 'free' && run.endedBy === 'ended')
      && run.kpm !== null)
    .slice(0, limit)
    .reverse()
    .map((run) => ({ ts: run.ts, label: formatJstDate(Date.parse(run.ts)), value: run.kpm, run }))
}

/** HP確認ありrunの合計と、直近10回の平均復帰時間系列(古い順)。平均は成功回数で加重する。 */
export function homePositionSummary(runs, limit = 10) {
  const matching = newestFirst(runs).filter((run) => run.homePosition)
  let successCount = 0
  let skipCount = 0
  let weightedReturnMs = 0
  matching.forEach((run) => {
    const success = run.hpSuccessCount ?? 0
    successCount += success
    skipCount += run.hpSkipCount ?? 0
    if (success > 0 && run.hpAvgReturnMs !== null) weightedReturnMs += success * run.hpAvgReturnMs
  })
  const points = matching
    .slice(0, limit)
    .filter((run) => run.hpAvgReturnMs !== null)
    .reverse()
    .map((run) => ({ ts: run.ts, label: formatJstDate(Date.parse(run.ts)), value: run.hpAvgReturnMs, run }))
  return {
    hasRuns: matching.length > 0,
    successCount,
    skipCount,
    avgReturnMs: successCount > 0 ? Math.round(weightedReturnMs / successCount) : null,
    points,
  }
}

export function shortDeviceId(deviceId) {
  return String(deviceId).slice(0, 8)
}

/**
 * キーごとのミスの割合。rate = ミス回数 / 出題回数。
 * enough=false(出題が少ない)のキーは、割合を色分けに使わない。
 */
export function keyMissStats(keys = {}) {
  const result = {}
  for (const [key, value] of Object.entries(keys)) {
    const shown = Number(value?.shown) || 0
    const misses = Number(value?.misses) || 0
    result[key] = {
      shown,
      misses,
      enough: shown >= MIN_SHOWN_FOR_RATE,
      rate: shown > 0 ? misses / shown : 0,
    }
  }
  return result
}

// ヒートマップの色の段階: none(データ不足) / clean(ミスなし) / l1〜l4(ミスが多いほど濃い)
export function heatLevel(stat) {
  if (!stat || !stat.enough) return 'none'
  if (stat.misses === 0) return 'clean'
  if (stat.rate < 0.1) return 'l1'
  if (stat.rate < 0.25) return 'l2'
  if (stat.rate < 0.5) return 'l3'
  return 'l4'
}

// 苦手なキー(ミスの割合が高い順、割合が同じなら回数の多い順)
export function weakestKeys(keys, limit = 3) {
  return Object.entries(keyMissStats(keys))
    .filter(([, stat]) => stat.enough && stat.misses > 0)
    .sort(([, a], [, b]) => b.rate - a.rate || b.misses - a.misses)
    .slice(0, limit)
    .map(([key, stat]) => ({ key, ...stat }))
}

/**
 * 日ごとの練習時間の棒グラフ用データ。高さは最大値に対する割合(0〜1)。
 * 練習した日は、短くても見えるよう最小の高さを持たせる。
 */
export function dailyBars(daily = []) {
  const maxMs = Math.max(0, ...daily.map((day) => day.practiceMs))
  return daily.map((day) => ({
    date: day.date,
    label: formatDateLabel(day.date),
    practiceMs: day.practiceMs,
    minutes: Math.round(day.practiceMs / 60000),
    ratio: maxMs === 0 || day.practiceMs === 0 ? 0 : Math.max(0.04, day.practiceMs / maxMs),
  }))
}

// 正答率の推移(練習した日だけ)。x は日付の並び順の位置(0〜daily.length-1)
export function accuracyPoints(daily = []) {
  return daily
    .map((day, index) => ({ index, date: day.date, label: formatDateLabel(day.date), percent: accuracyPercent(day.attempts, day.mistakes) }))
    .filter((point) => point.percent !== null)
}

export function summarizeDaily(daily = []) {
  const practicedDays = daily.filter((day) => day.records > 0).length
  const practiceMs = daily.reduce((sum, day) => sum + day.practiceMs, 0)
  return { practicedDays, practiceMs }
}
