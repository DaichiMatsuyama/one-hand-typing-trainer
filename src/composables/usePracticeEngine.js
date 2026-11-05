import { computed, readonly, reactive, ref } from 'vue'
import { AUTO_ADVANCE_MS, CLOCK_TICK_MS } from '../appConfig.js'
import { BUILD_COMMIT } from '../buildInfo.js'
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
import { summarizeRunStats } from '../domain/run.js'
import { formatDuration, getTotalStats } from '../domain/stats.js'
import { addKeyAttempt, findWeakKeys, sanitizeKeyStats } from '../domain/keyStats.js'
import { selectMessage } from '../domain/messages.js'
import {
  analyzeGrowth,
  analyzePersonalBest,
  findPreviousCompleted,
} from '../domain/personalBest.js'
import { describeNextRank, evaluateRank, getRankScore, RANK_VERSION } from '../domain/rank.js'
import { createDeviceId } from '../services/access.js'
import { buildCompletionRecord } from '../services/completionRecord.js'
import { appendHistory, loadHistory } from '../services/history.js'
import { remoteSync } from '../services/remoteSync.js'
import {
  clearAppState,
  defaultResults,
  defaultSettings,
  loadAppState,
  saveAppState,
} from '../services/storage.js'

const SNAPSHOT_INTERVAL_MS = 5000
const ENVIRONMENT_SYNC_INTERVAL_MS = 1000
const RESET_NOTICE_MS = 2000
const CLEAR_EFFECT_MS = 550
const MAX_WRONG_KEYS = 50
const PORTRAIT_QUERY = '(orientation: portrait) and (max-width: 700px)'
const QUESTION_SETTING_KEYS = new Set(['hand', 'level', 'includeSymbols', 'layoutVariant'])

function createInactiveSession(question, timestamp) {
  return {
    ...createPracticeSession(question, timestamp),
    isPaused: true,
    preserved: true,
  }
}

function createInitialState(storage, timestamp) {
  try {
    const saved = loadAppState(storage)
    const initialSettings = { ...defaultSettings, ...(saved?.settings ?? {}) }
    const initialResults = { ...defaultResults, ...(saved?.results ?? {}) }
    const initialQuestionIndex = saved?.questionIndex ?? 0
    const question = getQuestion(initialSettings, initialQuestionIndex)
    const hasSavedSession = saved?.session?.question === question
    const restoredSession = restorePracticeSession(saved?.session, question, timestamp)
    return {
      settings: initialSettings,
      results: initialResults,
      questionIndex: initialQuestionIndex,
      // 起動時は設定画面なので時計を進めず、保存時点のelapsedMsだけを引き継ぐ。
      session: hasSavedSession
        ? pausePracticeSession(restoredSession, timestamp)
        : createInactiveSession(question, timestamp),
    }
  } catch {
    clearAppState(storage)
    const initialSettings = { ...defaultSettings }
    const question = getQuestion(initialSettings, 0)
    return {
      settings: initialSettings,
      results: { ...defaultResults },
      questionIndex: 0,
      session: createInactiveSession(question, timestamp),
    }
  }
}

export function usePracticeEngine({
  storage,
  syncService = remoteSync,
  win = globalThis.window,
  doc = globalThis.document,
  getNow = () => Date.now(),
  random = Math.random,
} = {}) {
  const initialTimestamp = getNow()
  const initialState = createInitialState(storage, initialTimestamp)
  const settings = ref(initialState.settings)
  const results = ref(initialState.results)
  const questionIndex = ref(initialState.questionIndex)
  const session = ref(initialState.session)
  const now = ref(initialTimestamp)
  const resetNotice = ref('')
  const clearEffect = ref(null)
  const wrongKeys = ref([])
  const run = ref(null)
  const resultReady = ref(false)
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
  // runのbaselineとの差を求めるため、進行中の問題を含む累計相当値を保つ。
  const totalStats = computed(() => getTotalStats(results.value, session.value, now.value))
  const runSummary = computed(() => {
    if (!run.value) return summarizeRunStats({}, {})
    if (run.value.summary) return run.value.summary
    return {
      ...summarizeRunStats(
        totalStats.value,
        { ...run.value.baseline, elapsedMs: run.value.baseline.practiceMs },
        run.value.menuOpenCount,
      ),
      mode: run.value.mode,
      targetCount: run.value.targetCount,
      timeLimitSec: run.value.timeLimitSec,
      activeMs: getRunActiveMs(now.value),
      endedBy: null,
    }
  })
  const runElapsedText = computed(() => formatDuration(runSummary.value.inputMs))
  const runActiveMs = computed(() => run.value?.summary?.activeMs ?? getRunActiveMs(now.value))
  const runActiveText = computed(() => formatDuration(runActiveMs.value))
  const remainingMs = computed(() => {
    if (!run.value || run.value.mode !== 'timeLimit') return 0
    return Math.max(0, run.value.timeLimitSec * 1000 - runActiveMs.value)
  })
  const remainingText = computed(() => {
    const totalSeconds = Math.ceil(remainingMs.value / 1000)
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
  })
  const waitingForFirstKey = computed(() => Boolean(
    run.value && run.value.mode !== 'free' && !run.value.clockStarted && !run.value.summary,
  ))

  const portraitQuery = typeof win?.matchMedia === 'function'
    ? win.matchMedia(PORTRAIT_QUERY)
    : null

  let clockTimer
  let maintenanceTimer
  let feedbackTimer
  let clearEffectTimer
  let autoAdvanceTimer
  let resultTimer
  let noticeTimer
  let lastSnapshotAt = initialTimestamp
  let attached = false
  let shownPositions = new Set()
  let clearEffectId = 0
  // 入力ゼロの結果は履歴に残らないため、画面へ出したメッセージはエンジン内でも引き継ぐ。
  let lastDisplayedMessageId = loadHistory(storage)[0]?.messageId ?? null

  function getRunActiveMs(timestamp = getNow()) {
    if (!run.value || !run.value.clockStarted) return run.value?.activeMs ?? 0
    if (run.value.summary || run.value.activeStartedAt === null) return run.value.activeMs
    return Math.max(run.value.activeMs, run.value.activeMs + timestamp - run.value.activeStartedAt)
  }

  function shouldRunSessionClock() {
    if (pauseReasons.size > 0) return false
    if (session.value?.preserved || run.value?.summary) return false
    return !run.value || run.value.mode === 'free' || run.value.clockStarted
  }

  function snapshot(timestamp = getNow()) {
    saveAppState({
      settings: settings.value,
      results: results.value,
      questionIndex: questionIndex.value,
      session: { ...session.value, elapsedMs: elapsedMs.value, feedback: null },
    }, storage)
    lastSnapshotAt = timestamp
  }

  function applyPauseState(timestamp, wasPaused) {
    const isPaused = pauseReasons.size > 0
    if (run.value?.clockStarted && !run.value.summary && wasPaused !== isPaused) {
      run.value = isPaused
        ? { ...run.value, activeMs: getRunActiveMs(timestamp), activeStartedAt: null }
        : { ...run.value, activeStartedAt: timestamp }
    }
    session.value = shouldRunSessionClock()
      ? resumePracticeSession(session.value, timestamp)
      : pausePracticeSession(session.value, timestamp)
    now.value = timestamp
    snapshot(timestamp)
  }

  function updatePauseReasons(changes, timestamp = getNow()) {
    const wasPaused = pauseReasons.size > 0
    let changed = false
    changes.forEach(([name, on]) => {
      if (typeof name !== 'string' || name.length === 0) return
      if (on && !pauseReasons.has(name)) {
        if (name === 'menu' || name === 'portrait' || name === 'hidden') {
          clearCompletionEffect()
        }
        pauseReasons.add(name)
        changed = true
      } else if (!on && pauseReasons.delete(name)) {
        changed = true
      }
    })
    if (!changed) return false
    if (wasPaused !== (pauseReasons.size > 0)) applyPauseState(timestamp, wasPaused)
    return true
  }

  function setPauseReason(name, on, timestamp = getNow()) {
    if (on && pauseReasons.size === 0 && expireTimeLimit(timestamp)) return true
    return updatePauseReasons([[name, Boolean(on)]], timestamp)
  }

  function syncEnvironmentPauseReasons(timestamp = getNow()) {
    const hidden = Boolean(doc?.hidden)
    const portrait = Boolean(portraitQuery?.matches)
    // 停止の直前に制限時間を過ぎていたら、停止ではなく時間切れとして終える。
    if (pauseReasons.size === 0 && (hidden || portrait) && expireTimeLimit(timestamp)) return
    updatePauseReasons([
      ['hidden', hidden],
      ['portrait', portrait],
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

  // 1回の練習結果を送信キューへ。履歴と同じIDを使い、送信失敗は画面遷移へ影響させない。
  function reportRun(record) {
    try {
      const sending = syncService.recordRun(record)
      sending?.catch?.(() => {})
    } catch {
      // 記録の失敗で練習を止めない
    }
  }

  function cancelAutoAdvance() {
    clearTimeout(autoAdvanceTimer)
    autoAdvanceTimer = undefined
  }

  function cancelResultTransition() {
    clearTimeout(resultTimer)
    resultTimer = undefined
  }

  function clearCompletionEffect() {
    clearTimeout(clearEffectTimer)
    clearEffectTimer = undefined
    clearEffect.value = null
  }

  function showCompletionEffect() {
    clearCompletionEffect()
    if (!settings.value.feedbackEffects) return
    clearEffectId += 1
    clearEffect.value = {
      id: clearEffectId,
      kind: session.value.mistakes === 0 ? 'thumbsUp' : 'circle',
    }
    clearEffectTimer = setTimeout(() => {
      clearEffectTimer = undefined
      clearEffect.value = null
    }, CLEAR_EFFECT_MS)
  }

  function beginQuestion(savedSession = null, timestamp = getNow()) {
    wrongKeys.value = []
    shownPositions = new Set()
    cancelAutoAdvance()
    clearTimeout(feedbackTimer)
    feedbackTimer = undefined
    clearCompletionEffect()
    now.value = timestamp
    session.value = savedSession
      ? restorePracticeSession(savedSession, currentQuestion.value, timestamp)
      : createPracticeSession(currentQuestion.value, timestamp)
    // イベントや1秒ごとの確認より先に問題を切り替えた場合も、現在の表示状態を反映する。
    syncEnvironmentPauseReasons(timestamp)
    if (!shouldRunSessionClock()) {
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
    if (session.value.isComplete || session.value.preserved) return false
    const preservedElapsedMs = getElapsedMs(session.value, timestamp)
    results.value = {
      ...results.value,
      correctCount: results.value.correctCount + session.value.correctCount,
      mistakes: results.value.mistakes + session.value.mistakes,
      attempts: results.value.attempts + session.value.attempts,
      practiceMs: results.value.practiceMs + preservedElapsedMs,
    }
    session.value = {
      ...session.value,
      elapsedMs: preservedElapsedMs,
      preserved: true,
    }
    return true
  }

  function changePractice(nextSettings) {
    const timestamp = getNow()
    preservePendingSession(timestamp)
    settings.value = { ...settings.value, ...nextSettings }
    questionIndex.value = 0
    beginQuestion(null, timestamp)
  }

  // 設定画面用のsessionは時計を進めず、次のrunの累計にも含めない。
  function updateSettings(partial) {
    const timestamp = getNow()
    preservePendingSession(timestamp)
    const resetsQuestion = Object.keys(partial).some((key) => (
      QUESTION_SETTING_KEYS.has(key) && partial[key] !== settings.value[key]
    ))
    settings.value = { ...settings.value, ...partial }
    clearCompletionEffect()
    if (resetsQuestion) questionIndex.value = 0
    now.value = timestamp
    if (resetsQuestion || session.value.question !== currentQuestion.value) {
      session.value = createInactiveSession(currentQuestion.value, timestamp)
    }
    wrongKeys.value = []
    cancelAutoAdvance()
    snapshot(timestamp)
  }

  function startRun() {
    const timestamp = getNow()
    // 再読み込み前の未完了分は、このrunのbaselineを作る前に一度だけ累計へ移す。
    preservePendingSession(timestamp)
    setPauseReason('menu', false, timestamp)
    cancelResultTransition()
    resultReady.value = false
    clearCompletionEffect()
    // 前回のrunで最後に完了した問題(自動で次へ進む前に終わった問題)から、続けて始めない。
    if (session.value.isComplete) questionIndex.value += 1
    const clockStarted = settings.value.mode === 'free'
    run.value = {
      startedAt: timestamp,
      mode: settings.value.mode,
      targetCount: settings.value.mode === 'timeAttack' ? settings.value.targetCount : null,
      timeLimitSec: settings.value.mode === 'timeLimit' ? settings.value.timeLimitSec : null,
      baseline: { ...results.value },
      menuOpenCount: 0,
      clockStarted,
      activeMs: 0,
      // 停止の理由が残っているときは、時計を動かさない(解除されたときに動き出す)。
      activeStartedAt: clockStarted && pauseReasons.size === 0 ? timestamp : null,
      keys: {},
      summary: null,
    }
    beginQuestion(null, timestamp)
  }

  function buildHistoryRecord(summary, timestamp, id, { keys = {}, rankVersion = null, messageId = null } = {}) {
    return {
      id,
      ts: new Date(timestamp).toISOString(),
      mode: summary.mode,
      hand: settings.value.hand,
      level: settings.value.level,
      includeSymbols: settings.value.includeSymbols,
      layout: settings.value.layoutVariant,
      targetCount: summary.targetCount,
      timeLimitSec: summary.timeLimitSec,
      homePosition: false,
      endedBy: summary.endedBy,
      activeMs: Math.round(summary.activeMs),
      inputMs: Math.round(summary.inputMs),
      completedQuestions: summary.completedQuestions,
      correctCount: summary.correctCount,
      mistakes: summary.mistakes,
      attempts: summary.attempts,
      accuracy: summary.accuracy,
      kpm: summary.kpm,
      menuOpenCount: summary.menuOpenCount,
      keys: sanitizeKeyStats(keys),
      rankVersion,
      messageId,
      appVersion: BUILD_COMMIT,
    }
  }

  function analyzeRun(summary, record, history) {
    const rankEligible = summary.mode !== 'free' && summary.endedBy !== 'ended'
    const rank = rankEligible ? evaluateRank({ ...summary, level: settings.value.level }) : null
    const rankVersion = rankEligible ? RANK_VERSION : null
    const rankedRecord = { ...record, rankVersion }
    const personalBest = rank === null ? null : analyzePersonalBest(rankedRecord, history)
    const growth = analyzeGrowth(rankedRecord, history)
    const previous = findPreviousCompleted(rankedRecord, history)
    const previousRank = previous ? evaluateRank(previous) : null
    const rankUp = Boolean(rank && previousRank && getRankScore(rank) > getRankScore(previousRank))
    const weakKeys = findWeakKeys([rankedRecord, ...history], rankedRecord.hand)
    const message = selectMessage({
      rank,
      rankUp,
      personalBest,
      isFirstPractice: history.length === 0,
      growth,
      weakKeys,
      endedEarly: summary.endedBy === 'ended' && summary.mode !== 'free',
      previousMessageId: lastDisplayedMessageId,
    }, random)
    return {
      rank,
      rankVersion,
      nextRank: rank ? describeNextRank({ ...summary, level: settings.value.level, rank }) : null,
      personalBest,
      growth,
      weakKeys,
      message,
    }
  }

  // 結果確定・途中問題の移管・履歴保存を同じ時刻で一度だけ行う。
  function finishRun({
    endedBy = 'ended',
    timestamp = getNow(),
    activeMs: fixedActiveMs,
    keepClearEffect = false,
  } = {}) {
    if (!run.value) return runSummary.value
    if (!keepClearEffect) clearCompletionEffect()
    now.value = timestamp
    if (!run.value.summary) {
      const activeMs = fixedActiveMs ?? getRunActiveMs(timestamp)
      const stats = summarizeRunStats(
        getTotalStats(results.value, session.value, timestamp),
        { ...run.value.baseline, elapsedMs: run.value.baseline.practiceMs },
        run.value.menuOpenCount,
      )
      const summary = {
        ...stats,
        mode: run.value.mode,
        targetCount: run.value.targetCount,
        timeLimitSec: run.value.timeLimitSec,
        activeMs: Math.max(0, Math.round(activeMs)),
        endedBy,
      }
      const history = loadHistory(storage)
      const initialRecord = buildHistoryRecord(summary, timestamp, createDeviceId(), {
        keys: run.value.keys,
      })
      const analysis = analyzeRun(summary, initialRecord, history)
      lastDisplayedMessageId = analysis.message.id
      const finalSummary = { ...summary, analysis }
      preservePendingSession(timestamp)
      // 終了後に、自動で次へ進むタイマーや結果前の表示が残らないようにする。
      cancelAutoAdvance()
      session.value = pausePracticeSession(session.value, timestamp)
      run.value = { ...run.value, activeMs: finalSummary.activeMs, activeStartedAt: null, summary: finalSummary }
      if (finalSummary.attempts > 0) {
        const record = {
          ...initialRecord,
          rankVersion: analysis.rankVersion,
          messageId: analysis.message.id,
        }
        appendHistory(record, storage)
        reportRun(record)
      }
    }
    updatePauseReasons([...pauseReasons].map((reason) => [reason, false]), timestamp)
    snapshot(timestamp)
    return run.value.summary
  }

  // 設定へ戻る場合は成績だけ累計へ移し、結果と履歴は作らない。
  function abandonRun() {
    if (!run.value) return
    const timestamp = getNow()
    now.value = timestamp
    preservePendingSession(timestamp)
    cancelAutoAdvance()
    run.value = null
    updatePauseReasons([...pauseReasons].map((reason) => [reason, false]), timestamp)
    cancelResultTransition()
    resultReady.value = false
    clearCompletionEffect()
    snapshot(timestamp)
  }

  function openMenu() {
    if (pauseReasons.has('menu') || run.value?.summary) return false
    const timestamp = getNow()
    if (expireTimeLimit(timestamp)) return false
    clearCompletionEffect()
    cancelAutoAdvance()
    if (run.value) {
      run.value = { ...run.value, menuOpenCount: run.value.menuOpenCount + 1 }
    }
    setPauseReason('menu', true, timestamp)
    return true
  }

  function closeMenu() {
    const changed = setPauseReason('menu', false)
    if (changed && session.value.isComplete && !run.value?.summary) scheduleAutoAdvance()
    return changed
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

  function startCompetitiveClock(timestamp) {
    if (!run.value || run.value.mode === 'free' || run.value.clockStarted) return
    run.value = {
      ...run.value,
      clockStarted: true,
      activeStartedAt: pauseReasons.size === 0 ? timestamp : null,
    }
    if (pauseReasons.size === 0) {
      session.value = resumePracticeSession(session.value, timestamp)
    }
  }

  function expireTimeLimit(timestamp = getNow()) {
    if (!run.value || run.value.mode !== 'timeLimit' || run.value.summary
      || !run.value.clockStarted || pauseReasons.size > 0) return false
    const limitMs = run.value.timeLimitSec * 1000
    const activeAtTimestamp = getRunActiveMs(timestamp)
    if (activeAtTimestamp < limitMs) return false
    const effectiveTimestamp = run.value.activeStartedAt === null
      ? timestamp
      : timestamp - (activeAtTimestamp - limitMs)
    finishRun({ endedBy: 'timeUp', timestamp: effectiveTimestamp, activeMs: limitMs })
    resultReady.value = true
    return true
  }

  function pressKey(key) {
    if (session.value.isComplete || session.value.preserved || pauseReasons.size > 0 || run.value?.summary) return
    const timestamp = getNow()
    if (expireTimeLimit(timestamp)) return
    startCompetitiveClock(timestamp)
    clearTimeout(feedbackTimer)
    const wasComplete = session.value.isComplete
    const expectedKey = session.value.question[session.value.position]
    const pressedKey = String(key).toLowerCase()
    if (run.value) {
      const firstAttemptAtPosition = !shownPositions.has(session.value.position)
      shownPositions.add(session.value.position)
      run.value = {
        ...run.value,
        keys: addKeyAttempt(run.value.keys, expectedKey, {
          shown: firstAttemptAtPosition,
          missed: pressedKey !== expectedKey,
        }),
      }
    }
    if (pressedKey !== expectedKey && wrongKeys.value.length < MAX_WRONG_KEYS) {
      wrongKeys.value.push([expectedKey, pressedKey])
    }
    session.value = submitKey(session.value, key, timestamp)
    now.value = timestamp

    if (!wasComplete && session.value.isComplete) {
      showCompletionEffect()
      reportCompletion()
      results.value = {
        completedQuestions: results.value.completedQuestions + 1,
        correctCount: results.value.correctCount + session.value.correctCount,
        mistakes: results.value.mistakes + session.value.mistakes,
        attempts: results.value.attempts + session.value.attempts,
        practiceMs: results.value.practiceMs + session.value.elapsedMs,
      }
      if (run.value?.mode === 'timeAttack'
        && runSummary.value.completedQuestions >= run.value.targetCount) {
        finishRun({ endedBy: 'completed', timestamp, keepClearEffect: true })
        cancelResultTransition()
        resultTimer = setTimeout(() => {
          resultTimer = undefined
          resultReady.value = true
        }, AUTO_ADVANCE_MS)
      } else {
        scheduleAutoAdvance()
      }
    }
    feedbackTimer = setTimeout(() => {
      session.value = { ...session.value, feedback: null }
    }, 450)
    snapshot()
  }

  // やり直し系の操作は、画面ではフリーだけに出す。エンジン側でも同じ条件で守る。
  function allowsRetry() {
    return !pauseReasons.has('menu') && (!run.value || run.value.mode === 'free')
  }

  function resetQuestion() {
    if (!allowsRetry()) return false
    const timestamp = getNow()
    preservePendingSession(timestamp)
    beginQuestion(null, timestamp)
    return true
  }

  // 「やり直す」の長押し: 今回をゼロから数え直すため、累計とbaselineもゼロにする。
  function resetAllStats() {
    if (!allowsRetry()) return false
    results.value = { ...defaultResults }
    if (run.value) {
      const timestamp = getNow()
      run.value = {
        ...run.value,
        baseline: { ...defaultResults },
        activeMs: 0,
        activeStartedAt: run.value.clockStarted && pauseReasons.size === 0 ? timestamp : null,
        keys: {},
        summary: null,
      }
    }
    beginQuestion()
    resetNotice.value = '今回の成績をリセットしました'
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
      resetNotice.value = ''
    }, RESET_NOTICE_MS)
    return true
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
    // 表示時計だけを細かく進め、停止理由の確認と保存は従来の頻度に保つ。
    clockTimer = setInterval(() => {
      const timestamp = getNow()
      if (run.value?.clockStarted && !run.value.summary && pauseReasons.size === 0) now.value = timestamp
      else if (!session.value.isPaused && !session.value.isComplete) now.value = timestamp
      expireTimeLimit(timestamp)
    }, CLOCK_TICK_MS)
    maintenanceTimer = setInterval(() => {
      const timestamp = getNow()
      // 向きの変更イベントが届かない環境の保険: 1秒ごとに停止理由をそろえる
      syncEnvironmentPauseReasons(timestamp)
      if (run.value && !run.value.summary && pauseReasons.size === 0
        && timestamp - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
        snapshot(timestamp)
      }
    }, ENVIRONMENT_SYNC_INTERVAL_MS)
    win?.addEventListener('pagehide', handlePageHide)
    win?.addEventListener('pageshow', handlePageShow)
    doc?.addEventListener('visibilitychange', handleVisibilityChange)
    portraitQuery?.addEventListener?.('change', handlePortraitChange)
    syncEnvironmentPauseReasons()
    if (session.value.isComplete) scheduleAutoAdvance()
  }

  function detach() {
    clearCompletionEffect()
    if (!attached) return
    attached = false
    clearInterval(clockTimer)
    clockTimer = undefined
    clearInterval(maintenanceTimer)
    maintenanceTimer = undefined
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
    clearEffect,
    wrongKeys,
    run,
    resultReady,
    pauseReasons: readonly(pauseReasons),
    layout,
    layoutPitchCount,
    nextKey,
    nextFinger,
    elapsedMs,
    totalStats,
    runSummary,
    runElapsedText,
    runActiveMs,
    runActiveText,
    remainingMs,
    remainingText,
    waitingForFirstKey,
    currentQuestion,
    pressKey,
    resetQuestion,
    resetAllStats,
    selectHand,
    selectLevel,
    toggleSymbols,
    changePractice,
    updateSettings,
    startRun,
    finishRun,
    abandonRun,
    openMenu,
    closeMenu,
    beginQuestion,
    scheduleAutoAdvance,
    preservePendingSession,
    reportCompletion,
    reportRun,
    setPauseReason,
    attach,
    detach,
  }
}
