export const AUTO_ADVANCE_MS = 600
export const PRACTICE_MODES = Object.freeze(['free', 'timeAttack', 'timeLimit'])
export const TIME_ATTACK_COUNTS = Object.freeze([10, 20, 30, 50])
export const TIME_LIMIT_SECONDS = Object.freeze([30, 60, 120, 180])
export const DEFAULT_PRACTICE_MODE = 'free'
export const DEFAULT_TARGET_COUNT = 10
export const DEFAULT_TIME_LIMIT_SEC = 60
// 練習中の表示時間を実時間へ追従させる間隔
export const CLOCK_TICK_MS = 200
// 「やり直す」を長押しして今回の成績をリセットするまでの時間
export const LONG_PRESS_RESET_MS = 800
// 振り返り画面の見出しを長押しして、管理者表示を開くまでの時間(画面には何も表示しない)
export const ADMIN_LONG_PRESS_MS = 5000
// 振り返り取得前に、未送信記録の送信完了を待つ上限
export const REVIEW_FLUSH_WAIT_MS = 8000
// 振り返り画面を開いている間に成績を取り直す間隔
export const REVIEW_REFRESH_INTERVAL_MS = 30_000
