import { computed, readonly, reactive, ref } from 'vue'
import { AUTO_ADVANCE_MS } from '../appConfig.js'
import { getFinger, getKeyboardLayout, getLayoutPitchCount } from '../data/keyboardLayouts.js'
import { getQuestion } from '../data/questionBank.js'
import {
  createPracticeSession,
  getElapsedMs,
  pausePracticeSession,
  resumePracticeSession,
  restorePracticeSession,
  submitKey,
} from '../domain/practiceSession.js'
import { formatDuration, getTotalStats } from '../domain/stats.js'
import { buildCompletionRecord } from '../services/completionRecord.js'
import { remoteSync } from '../services/remoteSync.js'
import {
  clearAppState,
  defaultResults,
  defaultSettings,
  loadAppState,
  saveAppState,
} from '../services/storage.js'

const SNAPSHOT_INTERVAL_MS = 5000
const RESET_NOTICE_MS = 2000
const MAX_WRONG_KEYS = 50
const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 700px)'

function createInitialState(storage, timestamp) {
  try {
    const saved = loadAppState(storage)
    const initialSettings = { ...defaultSettings, ...(saved?.settings ?? {}) }
    const initialResults = { ...defaultResults, ...(saved?.results ?? {}) }
    const initialQuestionIndex = saved?.questionIndex ?? 0
    const question = getQuestion(initialSettings, initialQuestionIndex)
    return {
      settings: initialSettings,
      results: initialResults,
      questionIndex: initialQuestionIndex,
      session: restorePracticeSession(saved?.session, question, timestamp),
    }
  } catch {
    clearAppState(storage)
    const initialSettings = { ...defaultSettings }
    const question = getQuestion(initialSettings, 0)
    return {
      settings: initialSettings,
      results: { ...defaultResults },
      questionIndex: 0,
      session: createPracticeSession(question, timestamp),
    }
  }
}

export function usePracticeEngine({
  storage,
  syncService = remoteSync,
  win = globalThis.window,
  doc = globalThis.document,
  getNow = () => Date.now(),
} = {}) {
  const initialTimestamp = getNow()
  const initialState = createInitialState(storage, initialTimestamp)
  const settings = ref(initialState.settings)
  const results = ref(initialState.results)
  const questionIndex = ref(initialState.questionIndex)
  const session = ref(initialState.session)
  const now = ref(initialTimestamp)
  const resetNotice = ref('')
  const wrongKeys = ref([])
  const pauseReasons = reactive(new Set())

  const questionOptions = computed(() => ({ ...settings.value }))
  const currentQuestion = computed(() => getQuestion(questionOptions.value, questionIndex.value))
  const layout = computed(() => getKeyboardLayout(settings.value.hand, settings.value.layoutVariant))
  const layoutPitchCount = computed(() => (
    getLayoutPitchCount(settings.value.hand, settings.value.layoutVariant)
  ))
  const nextKey = computed(() => session.value.question[session.value.position] ?? '')
  const nextFinger = computed(() => {
    const key = layout.value.rows.flatMap((row) => row.keys)
      .find((item) => item.value === nextKey.value)
    return key ? getFinger(key.finger).label : ''
  })
  const elapsedMs = computed(() => getElapsedMs(session.value, now.value))
  // 画面の時間・正答率・ミス・クリア数は、リセットするまでの累計
  const totalStats = computed(() => getTotalStats(results.value, session.value, now.value))
  const elapsedText = computed(() => formatDuration(totalStats.value.elapsedMs))

  const portraitQuery = typeof win?.matchMedia === 'function'
    ? win.matchMedia(PORTRAIT_QUERY)
    : null

  let timer
  let feedbackTimer
  let autoAdvanceTimer
  let noticeTimer
  let lastSnapshotAt = initialTimestamp
  let attached = false

  function snapshot(timestamp = getNow()) {
    saveAppState({
      settings: settings.value,
      results: results.value,
      questionIndex: questionIndex.value,
      session: { ...session.value, elapsedMs: elapsedMs.value, feedback: null },
    }, storage)
    lastSnapshotAt = timestamp
  }

  function applyPauseState(timestamp) {
    session.value = pauseReasons.size > 0
      ? pausePracticeSession(session.value, timestamp)
      : resumePracticeSession(session.value, timestamp)
    now.value = timestamp
    snapshot(timestamp)
  }

  function updatePauseReasons(changes, timestamp = getNow()) {
    const wasPaused = pauseReasons.size > 0
    let changed = false
    changes.forEach(([name, on]) => {
      if (typeof name !== 'string' || name.length === 0) return
      if (on && !pauseReasons.has(name)) {
        pauseReasons.add(name)
        changed = true
      } else if (!on && pauseReasons.delete(name)) {
        changed = true
      }
    })
    if (!changed) return false
    if (wasPaused !== (pauseReasons.size > 0)) applyPauseState(timestamp)
    return true
  }

  function setPauseReason(name, on, timestamp = getNow()) {
    return updatePauseReasons([[name, Boolean(on)]], timestamp)
  }

  function syncEnvironmentPauseReasons(timestamp = getNow()) {
    updatePauseReasons([
      ['hidden', Boolean(doc?.hidden)],
      ['portrait', Boolean(portraitQuery?.matches)],
    ], timestamp)
  }

  // 1問クリアごとの練習記録を送信キューへ。送信の成否は練習に影響させない
  function reportCompletion() {
    try {
      const sending = syncService.recordCompletion(buildCompletionRecord({
        session: session.value,
        settings: settings.value,
        wrongKeys: wrongKeys.value,
      }))
      sending?.catch?.(() => {})
    } catch {
      // 記録の失敗で練習を止めない
    }
  }

  function cancelAutoAdvance() {
    clearTimeout(autoAdvanceTimer)
    autoAdvanceTimer = undefined
  }

  function beginQuestion(savedSession = null, timestamp = getNow()) {
    wrongKeys.value = []
    cancelAutoAdvance()
    clearTimeout(feedbackTimer)
    feedbackTimer = undefined
    now.value = timestamp
    session.value = savedSession
      ? restorePracticeSession(savedSession, currentQuestion.value, timestamp)
      : createPracticeSession(currentQuestion.value, timestamp)
    // イベントや1秒ごとの確認より先に問題を切り替えた場合も、現在の表示状態を反映する。
    syncEnvironmentPauseReasons(timestamp)
    if (pauseReasons.size > 0) {
      session.value = pausePracticeSession(session.value, timestamp)
    }
    snapshot(timestamp)
  }

  function advanceToNextQuestion() {
    autoAdvanceTimer = undefined
    if (!session.value.isComplete) return
    questionIndex.value += 1
    beginQuestion()
  }

  function scheduleAutoAdvance() {
    cancelAutoAdvance()
    if (!session.value.isComplete) return
    autoAdvanceTimer = setTimeout(advanceToNextQuestion, AUTO_ADVANCE_MS)
  }

  // 未クリアの問題を手動で捨てる前に、画面に出ている進行中の累計をresultsへ移す。
  // クリア済みはpressKey()で移動済みなので対象にしない。
  function preservePendingSession(timestamp = getNow()) {
    if (session.value.isComplete) return
    results.value = {
      ...results.value,
      correctCount: results.value.correctCount + session.value.correctCount,
      mistakes: results.value.mistakes + session.value.mistakes,
      attempts: results.value.attempts + session.value.attempts,
      practiceMs: results.value.practiceMs + getElapsedMs(session.value, timestamp),
    }
  }

  function changePractice(nextSettings) {
    const timestamp = getNow()
    preservePendingSession(timestamp)
    settings.value = { ...settings.value, ...nextSettings }
    questionIndex.value = 0
    beginQuestion(null, timestamp)
  }

  function selectHand(hand) {
    if (hand !== settings.value.hand) changePractice({ hand })
  }

  function selectLevel(level) {
    if (level !== settings.value.level) changePractice({ level })
  }

  function toggleSymbols(event) {
    changePractice({ includeSymbols: event.target.checked })
  }

  function pressKey(key) {
    if (session.value.isComplete) return
    clearTimeout(feedbackTimer)
    const wasComplete = session.value.isComplete
    const expectedKey = session.value.question[session.value.position]
    const pressedKey = String(key).toLowerCase()
    if (pressedKey !== expectedKey && wrongKeys.value.length < MAX_WRONG_KEYS) {
      wrongKeys.value.push([expectedKey, pressedKey])
    }
    session.value = submitKey(session.value, key)
    now.value = getNow()

    if (!wasComplete && session.value.isComplete) {
      reportCompletion()
      results.value = {
        completedQuestions: results.value.completedQuestions + 1,
        correctCount: results.value.correctCount + session.value.correctCount,
        mistakes: results.value.mistakes + session.value.mistakes,
        attempts: results.value.attempts + session.value.attempts,
        practiceMs: results.value.practiceMs + session.value.elapsedMs,
      }
      scheduleAutoAdvance()
    }
    feedbackTimer = setTimeout(() => {
      session.value = { ...session.value, feedback: null }
    }, 450)
    snapshot()
  }

  function resetQuestion() {
    const timestamp = getNow()
    preservePendingSession(timestamp)
    beginQuestion(null, timestamp)
  }

  // 「やり直す」の長押し: 累計成績もすべてゼロにして、今の問題を最初からやり直す
  function resetAllStats() {
    results.value = { ...defaultResults }
    beginQuestion()
    resetNotice.value = '成績をすべてリセットしました'
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
      resetNotice.value = ''
    }, RESET_NOTICE_MS)
  }

  function handlePageHide() {
    setPauseReason('hidden', true)
  }

  function handlePageShow() {
    syncEnvironmentPauseReasons()
  }

  function handleVisibilityChange() {
    setPauseReason('hidden', Boolean(doc?.hidden))
  }

  function handlePortraitChange() {
    setPauseReason('portrait', Boolean(portraitQuery?.matches))
  }

  function attach() {
    if (attached) return
    attached = true
    timer = setInterval(() => {
      const timestamp = getNow()
      now.value = timestamp
      // 向きの変更イベントが届かない環境の保険: 1秒ごとに停止理由をそろえる
      syncEnvironmentPauseReasons(timestamp)
      if (!session.value.isPaused && !session.value.isComplete
        && timestamp - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
        snapshot(timestamp)
      }
    }, 1000)
    win?.addEventListener('pagehide', handlePageHide)
    win?.addEventListener('pageshow', handlePageShow)
    doc?.addEventListener('visibilitychange', handleVisibilityChange)
    portraitQuery?.addEventListener?.('change', handlePortraitChange)
    syncEnvironmentPauseReasons()
    if (session.value.isComplete) scheduleAutoAdvance()
  }

  function detach() {
    if (!attached) return
    attached = false
    clearInterval(timer)
    timer = undefined
    clearTimeout(feedbackTimer)
    feedbackTimer = undefined
    clearTimeout(noticeTimer)
    noticeTimer = undefined
    cancelAutoAdvance()
    win?.removeEventListener('pagehide', handlePageHide)
    win?.removeEventListener('pageshow', handlePageShow)
    doc?.removeEventListener('visibilitychange', handleVisibilityChange)
    portraitQuery?.removeEventListener?.('change', handlePortraitChange)
  }

  return {
    settings,
    results,
    questionIndex,
    session,
    now,
    resetNotice,
    wrongKeys,
    pauseReasons: readonly(pauseReasons),
    layout,
    layoutPitchCount,
    nextKey,
    nextFinger,
    elapsedMs,
    totalStats,
    elapsedText,
    currentQuestion,
    pressKey,
    resetQuestion,
    resetAllStats,
    selectHand,
    selectLevel,
    toggleSymbols,
    changePractice,
    beginQuestion,
    scheduleAutoAdvance,
    preservePendingSession,
    reportCompletion,
    setPauseReason,
    attach,
    detach,
  }
}
