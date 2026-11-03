export const STORAGE_KEY = 'one-hand-typing-trainer:v1'

export const defaultSettings = Object.freeze({
  hand: 'left',
  level: 1,
  includeSymbols: false,
  layoutVariant: 'jis',
})

export const defaultResults = Object.freeze({
  completedQuestions: 0,
  correctCount: 0,
  mistakes: 0,
  attempts: 0,
  practiceMs: 0,
})

function sanitizeSettings(settings = {}) {
  return {
    hand: settings.hand === 'right' ? 'right' : 'left',
    level: [1, 2, 3].includes(Number(settings.level)) ? Number(settings.level) : 1,
    includeSymbols: Boolean(settings.includeSymbols),
    layoutVariant: settings.layoutVariant === 'us' ? 'us' : 'jis',
  }
}

function sanitizeResults(results = {}) {
  return Object.fromEntries(
    Object.keys(defaultResults).map((key) => [key, Math.max(0, Number(results[key]) || 0)]),
  )
}

export function loadAppState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return {
      settings: sanitizeSettings(parsed.settings),
      results: sanitizeResults(parsed.results),
      questionIndex: Math.max(0, Number(parsed.questionIndex) || 0),
      session: parsed.session && typeof parsed.session === 'object' ? parsed.session : null,
    }
  } catch {
    return null
  }
}

export function saveAppState(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearAppState(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}
