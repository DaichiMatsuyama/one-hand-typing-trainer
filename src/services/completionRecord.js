import { createDeviceId } from './access.js'

const MAX_WRONG_KEYS = 50

/**
 * 1問クリアごとの記録。送るのは練習内容のみ(位置情報・個人情報は含めない)。
 * wrong は [正しいキー, 押したキー] の配列(最大50件)。
 */
export function buildCompletionRecord({ session, settings, wrongKeys = [], now = Date.now(), id = createDeviceId() }) {
  return {
    id,
    ts: new Date(now).toISOString(),
    hand: settings.hand,
    level: settings.level,
    includeSymbols: Boolean(settings.includeSymbols),
    layout: settings.layoutVariant,
    question: session.question,
    durationMs: Math.round(session.elapsedMs),
    attempts: session.attempts,
    mistakes: session.mistakes,
    wrong: wrongKeys.slice(0, MAX_WRONG_KEYS).map(([expected, pressed]) => [String(expected), String(pressed)]),
  }
}
