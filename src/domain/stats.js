import { getElapsedMs } from './practiceSession.js'

/**
 * 画面に出す累計成績。保存済みの累計(results)に、まだクリアしていない
 * 進行中の問題(session)の分を足す。クリア済みの問題は results に加算済みなので二重に足さない。
 */
export function getTotalStats(results, session, now = Date.now()) {
  const pending = session.isComplete ? null : session
  const attempts = results.attempts + (pending?.attempts ?? 0)
  const correctCount = results.correctCount + (pending?.correctCount ?? 0)
  return {
    elapsedMs: results.practiceMs + (pending ? getElapsedMs(pending, now) : 0),
    attempts,
    correctCount,
    mistakes: results.mistakes + (pending?.mistakes ?? 0),
    completedQuestions: results.completedQuestions,
    accuracy: attempts === 0 ? 100 : Math.round((correctCount / attempts) * 100),
  }
}

// 100分未満は m:ss、それ以上は 1h40m のように短くして、帯の幅に収める
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 6000) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = String(totalSeconds % 60).padStart(2, '0')
    return `${minutes}:${seconds}`
  }
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  return `${hours}h${minutes}m`
}
