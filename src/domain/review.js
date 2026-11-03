// 振り返り画面の表示用に、GASの集計(stats)を整える純粋な関数群

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// キーごとのミスの割合を出すのに必要な、最低限の出題回数(少なすぎる回数の割合は信用しない)
export const MIN_SHOWN_FOR_RATE = 3

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
