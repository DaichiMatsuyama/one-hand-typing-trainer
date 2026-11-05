import {
  DEFAULT_PRACTICE_MODE,
  DEFAULT_TARGET_COUNT,
  DEFAULT_TIME_LIMIT_SEC,
  PRACTICE_MODES,
  TIME_ATTACK_COUNTS,
  TIME_LIMIT_SECONDS,
} from '../appConfig.js'

export const STORAGE_KEY = 'one-hand-typing-trainer:v1'
export const STORAGE_VERSION = 1

export const defaultSettings = Object.freeze({
  hand: 'left',
  level: 1,
  includeSymbols: false,
  layoutVariant: 'jis',
  mode: DEFAULT_PRACTICE_MODE,
  targetCount: DEFAULT_TARGET_COUNT,
  timeLimitSec: DEFAULT_TIME_LIMIT_SEC,
  feedbackEffects: true,
})

export const defaultResults = Object.freeze({
  completedQuestions: 0,
  correctCount: 0,
  mistakes: 0,
  attempts: 0,
  practiceMs: 0,
})

function sanitizeSettings(settings = {}) {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  return {
    hand: source.hand === 'right' ? 'right' : 'left',
    level: [1, 2, 3].includes(Number(source.level)) ? Number(source.level) : 1,
    includeSymbols: Boolean(source.includeSymbols),
    layoutVariant: source.layoutVariant === 'us' ? 'us' : 'jis',
    mode: PRACTICE_MODES.includes(source.mode) ? source.mode : DEFAULT_PRACTICE_MODE,
    targetCount: TIME_ATTACK_COUNTS.includes(source.targetCount)
      ? source.targetCount
      : DEFAULT_TARGET_COUNT,
    timeLimitSec: TIME_LIMIT_SECONDS.includes(source.timeLimitSec)
      ? source.timeLimitSec
      : DEFAULT_TIME_LIMIT_SEC,
    feedbackEffects: source.feedbackEffects !== false,
  }
}

function sanitizeResults(results = {}) {
  const source = results && typeof results === 'object' && !Array.isArray(results) ? results : {}
  return Object.fromEntries(
    Object.keys(defaultResults).map((key) => {
      const value = source[key]
      return [key, Number.isSafeInteger(value) && value >= 0 ? value : 0]
    }),
  )
}

function sanitizeQuestionIndex(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function loadAppState(storage) {
  let target = storage
  try {
    target ??= globalThis.localStorage
    const raw = target?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== STORAGE_VERSION) {
      target?.removeItem(STORAGE_KEY)
      return null
    }
    return {
      version: STORAGE_VERSION,
      settings: sanitizeSettings(parsed.settings),
      results: sanitizeResults(parsed.results),
      questionIndex: sanitizeQuestionIndex(parsed.questionIndex),
      session: parsed.session && typeof parsed.session === 'object' && !Array.isArray(parsed.session)
        ? parsed.session
        : null,
    }
  } catch {
    try {
      target?.removeItem(STORAGE_KEY)
    } catch {
      // Storage access itself may be blocked; the app still falls back to memory defaults.
    }
    return null
  }
}

export function saveAppState(state, storage) {
  try {
    const target = storage ?? globalThis.localStorage
    target?.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STORAGE_VERSION }))
    return true
  } catch {
    return false
  }
}

export function clearAppState(storage) {
  try {
    const target = storage ?? globalThis.localStorage
    target?.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
