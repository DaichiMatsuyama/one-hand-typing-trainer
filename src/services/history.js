import { PRACTICE_MODES } from '../appConfig.js'
import { createDeviceId } from './access.js'

export const HISTORY_KEY = 'one-hand-typing-trainer:history:v1'
export const HISTORY_VERSION = 1
export const HISTORY_LIMIT = 200

const ENDED_BY = ['completed', 'timeUp', 'ended']

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function sanitizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.v !== HISTORY_VERSION) return null
  if (typeof record.id !== 'string' || record.id.length === 0) return null
  if (typeof record.ts !== 'string' || !Number.isFinite(Date.parse(record.ts))) return null
  if (!PRACTICE_MODES.includes(record.mode) || !ENDED_BY.includes(record.endedBy)) return null
  if (!['left', 'right'].includes(record.hand) || ![1, 2, 3].includes(record.level)) return null
  if (!['jis', 'us'].includes(record.layout)) return null

  const integerFields = [
    'activeMs', 'inputMs', 'completedQuestions', 'correctCount', 'mistakes',
    'attempts', 'accuracy', 'menuOpenCount',
  ]
  const integers = Object.fromEntries(integerFields.map((key) => [key, nonNegativeInteger(record[key])]))
  if (Object.values(integers).some((value) => value === null)) return null
  if (integers.accuracy > 100) return null

  const targetCount = record.targetCount === null ? null : nonNegativeInteger(record.targetCount)
  const timeLimitSec = record.timeLimitSec === null ? null : nonNegativeInteger(record.timeLimitSec)
  if (record.targetCount !== null && targetCount === null) return null
  if (record.timeLimitSec !== null && timeLimitSec === null) return null
  const kpm = record.kpm === null ? null : nonNegativeInteger(record.kpm)
  if (record.kpm !== null && kpm === null) return null

  return {
    v: HISTORY_VERSION,
    id: record.id,
    ts: new Date(record.ts).toISOString(),
    mode: record.mode,
    hand: record.hand,
    level: record.level,
    includeSymbols: Boolean(record.includeSymbols),
    layout: record.layout,
    targetCount,
    timeLimitSec,
    homePosition: false,
    endedBy: record.endedBy,
    ...integers,
    kpm,
    appVersion: typeof record.appVersion === 'string' ? record.appVersion : 'dev',
  }
}

export function loadHistory(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      storage?.removeItem(HISTORY_KEY)
      return []
    }
    return parsed.map(sanitizeRecord).filter(Boolean).slice(0, HISTORY_LIMIT)
  } catch {
    try {
      storage?.removeItem(HISTORY_KEY)
    } catch {
      // 保存領域自体が使えなくても練習は続ける。
    }
    return []
  }
}

export function appendHistory(record, storage = globalThis.localStorage) {
  try {
    const normalized = sanitizeRecord({ ...record, v: HISTORY_VERSION, id: record.id ?? createDeviceId() })
    if (!normalized) return false
    storage?.setItem(HISTORY_KEY, JSON.stringify([normalized, ...loadHistory(storage)].slice(0, HISTORY_LIMIT)))
    return true
  } catch {
    return false
  }
}
