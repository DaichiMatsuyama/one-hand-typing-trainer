function difference(current, baseline, key) {
  return Math.max(0, (current?.[key] ?? 0) - (baseline?.[key] ?? 0))
}

/**
 * 累計成績の開始時点との差から、1回の練習結果を作る。
 * current は getTotalStats と同じく進行中の問題を含む値を受け取る。
 */
export function summarizeRunStats(current, baseline, menuOpenCount = 0) {
  const completedQuestions = difference(current, baseline, 'completedQuestions')
  const correctCount = difference(current, baseline, 'correctCount')
  const mistakes = difference(current, baseline, 'mistakes')
  const attempts = difference(current, baseline, 'attempts')
  const inputMs = difference(current, baseline, 'elapsedMs')

  return {
    completedQuestions,
    correctCount,
    mistakes,
    attempts,
    inputMs,
    accuracy: attempts === 0 ? 100 : Math.round((correctCount / attempts) * 100),
    kpm: inputMs < 1000 ? null : Math.round(correctCount / (inputMs / 60_000)),
    menuOpenCount: Math.max(0, menuOpenCount),
  }
}

export function formatClearTime(ms) {
  const tenths = Math.max(0, Math.floor(ms / 100))
  const minutes = Math.floor(tenths / 600)
  const seconds = String(Math.floor((tenths % 600) / 10)).padStart(2, '0')
  return `${minutes}:${seconds}.${tenths % 10}`
}
