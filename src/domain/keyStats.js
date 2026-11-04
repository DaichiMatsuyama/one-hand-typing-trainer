export const KEY_STATS_LIMIT = 40
export const WEAK_KEY_RUN_LIMIT = 10

const ALLOWED_KEY = /^[a-z;,./@:_-]$/

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

export function normalizeStatsKey(value) {
  const key = typeof value === 'string' ? value.toLowerCase() : ''
  return ALLOWED_KEY.test(key) ? key : null
}

export function sanitizeKeyStats(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const sanitized = {}
  for (const [rawKey, rawCounts] of Object.entries(value)) {
    const key = normalizeStatsKey(rawKey)
    if (!key || !Array.isArray(rawCounts) || rawCounts.length !== 2) continue
    const shown = count(rawCounts[0])
    const misses = count(rawCounts[1])
    if (shown === null || misses === null) continue
    if (!(key in sanitized) && Object.keys(sanitized).length >= KEY_STATS_LIMIT) continue
    const previous = sanitized[key] ?? [0, 0]
    sanitized[key] = [previous[0] + shown, previous[1] + misses]
  }
  return sanitized
}

/** 本来押すべきキーに対して、出題段階へ入ったことと押し間違いを加算する。 */
export function addKeyAttempt(stats, rawKey, { shown = false, missed = false } = {}) {
  const key = normalizeStatsKey(rawKey)
  const next = sanitizeKeyStats(stats)
  if (!key || (!shown && !missed)) return next
  if (!(key in next) && Object.keys(next).length >= KEY_STATS_LIMIT) return next
  const previous = next[key] ?? [0, 0]
  next[key] = [previous[0] + (shown ? 1 : 0), previous[1] + (missed ? 1 : 0)]
  return next
}

export function findWeakKeys(records, hand) {
  const totals = {}
  records
    .filter((record) => record?.hand === hand)
    .slice(0, WEAK_KEY_RUN_LIMIT)
    .forEach((record) => {
      Object.entries(sanitizeKeyStats(record.keys)).forEach(([key, [shown, misses]]) => {
        const previous = totals[key] ?? [0, 0]
        totals[key] = [previous[0] + shown, previous[1] + misses]
      })
    })

  return Object.entries(totals)
    .map(([key, [shown, misses]]) => ({ key, shown, misses, rate: misses / shown }))
    .filter(({ shown, misses }) => shown >= 5 && misses > 0)
    .sort((a, b) => b.rate - a.rate || b.misses - a.misses || a.key.localeCompare(b.key))
    .slice(0, 3)
}
