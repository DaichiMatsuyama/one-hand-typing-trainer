<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import KeyboardView from './components/KeyboardView.vue'
import LevelSelector from './components/LevelSelector.vue'
import PromptView from './components/PromptView.vue'
import ResultView from './components/ResultView.vue'
import ReviewView from './components/ReviewView.vue'
import { AUTO_ADVANCE_MS } from './appConfig.js'
import { formatDuration, getTotalStats } from './domain/stats.js'
import { REMOTE_ENDPOINT } from './remoteConfig.js'
import { loadAccess } from './services/access.js'
import { buildCompletionRecord } from './services/completionRecord.js'
import { remoteSync } from './services/remoteSync.js'
import { getFinger, getKeyboardLayout, getLayoutPitchCount } from './data/keyboardLayouts.js'
import { getQuestion } from './data/questionBank.js'
import {
  createPracticeSession,
  getElapsedMs,
  pausePracticeSession,
  resumePracticeSession,
  restorePracticeSession,
  submitKey,
} from './domain/practiceSession.js'
import {
  defaultResults,
  defaultSettings,
  clearAppState,
  loadAppState,
  saveAppState,
} from './services/storage.js'

const SNAPSHOT_INTERVAL_MS = 5000
const RESET_NOTICE_MS = 2000
const MAX_WRONG_KEYS = 50

function createInitialState() {
  try {
    const saved = loadAppState()
    const initialSettings = { ...defaultSettings, ...(saved?.settings ?? {}) }
    const initialResults = { ...defaultResults, ...(saved?.results ?? {}) }
    const initialQuestionIndex = saved?.questionIndex ?? 0
    const question = getQuestion(initialSettings, initialQuestionIndex)
    return {
      settings: initialSettings,
      results: initialResults,
      questionIndex: initialQuestionIndex,
      session: restorePracticeSession(saved?.session, question),
    }
  } catch {
    clearAppState()
    const initialSettings = { ...defaultSettings }
    const question = getQuestion(initialSettings, 0)
    return {
      settings: initialSettings,
      results: { ...defaultResults },
      questionIndex: 0,
      session: createPracticeSession(question),
    }
  }
}

const initialState = createInitialState()
const settings = ref(initialState.settings)
const results = ref(initialState.results)
const questionIndex = ref(initialState.questionIndex)

// 縦向きの振り返り画面は、送信先が設定され、コード入力済みの端末だけで使える(それ以外は従来の回転案内)
const reviewAccess = REMOTE_ENDPOINT ? loadAccess() : null
const reviewEnabled = Boolean(reviewAccess)

const questionOptions = computed(() => ({ ...settings.value }))
const currentQuestion = computed(() => getQuestion(questionOptions.value, questionIndex.value))
const session = ref(initialState.session)
const now = ref(Date.now())
const isStandalone = ref(
  Boolean(window.navigator.standalone)
  || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches),
)

const layout = computed(() => getKeyboardLayout(settings.value.hand, settings.value.layoutVariant))
const layoutPitchCount = computed(() => (
  getLayoutPitchCount(settings.value.hand, settings.value.layoutVariant)
))
const nextKey = computed(() => session.value.question[session.value.position] ?? '')
const nextFinger = computed(() => {
  const key = layout.value.rows.flatMap((row) => row.keys).find((item) => item.value === nextKey.value)
  return key ? getFinger(key.finger).label : ''
})
const elapsedMs = computed(() => (
  getElapsedMs(session.value, now.value)
))
// 画面の時間・正答率・ミス・クリア数は、リセットするまでの累計
const totalStats = computed(() => getTotalStats(results.value, session.value, now.value))
const elapsedText = computed(() => formatDuration(totalStats.value.elapsedMs))
const resetNotice = ref('')

let timer
let feedbackTimer
let autoAdvanceTimer
let noticeTimer
let stopRemoteSync = () => {}
// 今の問題で押し間違えた [正しいキー, 押したキー](ページ再読み込みをまたぐと失われる)
let wrongKeys = []
let displayModeQuery
let lastSnapshotAt = Date.now()

function updateStandaloneStatus() {
  isStandalone.value = Boolean(window.navigator.standalone)
    || Boolean(displayModeQuery?.matches)
}

function snapshot(timestamp = Date.now()) {
  saveAppState({
    settings: settings.value,
    results: results.value,
    questionIndex: questionIndex.value,
    session: { ...session.value, elapsedMs: elapsedMs.value, feedback: null },
  })
  lastSnapshotAt = timestamp
}

// 1問クリアごとの練習記録を送信キューへ。送信の成否は練習に影響させない
function reportCompletion() {
  try {
    const sending = remoteSync.recordCompletion(buildCompletionRecord({
      session: session.value,
      settings: settings.value,
      wrongKeys,
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

function beginQuestion(savedSession = null) {
  wrongKeys = []
  cancelAutoAdvance()
  clearTimeout(feedbackTimer)
  feedbackTimer = undefined
  now.value = Date.now()
  session.value = savedSession
    ? restorePracticeSession(savedSession, currentQuestion.value, now.value)
    : createPracticeSession(currentQuestion.value, now.value)
  if (document.hidden) {
    session.value = pausePracticeSession(session.value, now.value)
  }
  snapshot()
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

function changePractice(nextSettings) {
  settings.value = { ...settings.value, ...nextSettings }
  questionIndex.value = 0
  beginQuestion()
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
  if (pressedKey !== expectedKey && wrongKeys.length < MAX_WRONG_KEYS) {
    wrongKeys.push([expectedKey, pressedKey])
  }
  session.value = submitKey(session.value, key)
  now.value = Date.now()

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
  beginQuestion()
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
  const timestamp = Date.now()
  session.value = pausePracticeSession(session.value, timestamp)
  now.value = timestamp
  snapshot(timestamp)
}

function handleVisibilityChange() {
  const timestamp = Date.now()
  session.value = document.hidden
    ? pausePracticeSession(session.value, timestamp)
    : resumePracticeSession(session.value, timestamp)
  now.value = timestamp
  snapshot(timestamp)
}

function handlePageShow() {
  const timestamp = Date.now()
  session.value = document.hidden
    ? pausePracticeSession(session.value, timestamp)
    : resumePracticeSession(session.value, timestamp)
  now.value = timestamp
  snapshot(timestamp)
}

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    displayModeQuery = window.matchMedia('(display-mode: standalone)')
    displayModeQuery.addEventListener?.('change', updateStandaloneStatus)
  }
  updateStandaloneStatus()
  timer = setInterval(() => {
    const timestamp = Date.now()
    now.value = timestamp
    if (!session.value.isPaused && !session.value.isComplete
      && timestamp - lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      snapshot(timestamp)
    }
  }, 1000)
  window.addEventListener('pagehide', handlePageHide)
  window.addEventListener('pageshow', handlePageShow)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (document.hidden) handleVisibilityChange()
  if (session.value.isComplete) scheduleAutoAdvance()
  stopRemoteSync = remoteSync.start() ?? stopRemoteSync
})

onBeforeUnmount(() => {
  stopRemoteSync()
  clearInterval(timer)
  clearTimeout(feedbackTimer)
  clearTimeout(noticeTimer)
  cancelAutoAdvance()
  window.removeEventListener('pagehide', handlePageHide)
  window.removeEventListener('pageshow', handlePageShow)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  displayModeQuery?.removeEventListener?.('change', updateStandaloneStatus)
})
</script>

<template>
  <div
    class="app-shell"
    :data-hand="settings.hand"
    :data-layout-variant="settings.layoutVariant"
    :style="{ '--keyboard-pitch-count': layoutPitchCount }"
  >
    <main class="practice-layout">
      <section
        class="info-strip"
        :class="{ complete: session.isComplete }"
        data-testid="info-strip"
        aria-label="練習内容と設定"
      >
        <header class="compact-header">
          <div class="brand">
            <p class="brand-kicker">キー位置を片手ずつ覚える</p>
            <h1>片手タイピング</h1>
          </div>

          <div class="control-stack">
            <fieldset class="segmented hand-selector" aria-label="練習する手">
              <legend class="visually-hidden">練習する手</legend>
              <button
                v-for="hand in ['left', 'right']"
                :key="hand"
                type="button"
                :class="{ selected: settings.hand === hand }"
                :aria-pressed="settings.hand === hand"
                :data-testid="`hand-${hand}`"
                @click="selectHand(hand)"
              >
                {{ hand === 'left' ? '左手' : '右手' }}
              </button>
            </fieldset>

            <LevelSelector :model-value="settings.level" @update:model-value="selectLevel" />

            <label class="symbol-toggle">
              <input
                type="checkbox"
                :checked="settings.includeSymbols"
                :disabled="settings.hand === 'left'"
                aria-label="記号を含める"
                :aria-describedby="settings.hand === 'left' ? 'symbol-hand-hint' : undefined"
                :title="settings.hand === 'left' ? '記号は右手の練習でのみ出題できます' : '記号を問題に含める'"
                data-testid="include-symbols"
                @change="toggleSymbols"
              />
              <span class="symbol-label">
                <span class="symbol-label-full" aria-hidden="true">
                  <span>記号を</span><span>含める</span>
                </span>
                <span class="symbol-label-compact" aria-hidden="true">記号</span>
                <small v-if="settings.hand === 'left'" id="symbol-hand-hint">右手のみ</small>
              </span>
            </label>
          </div>
        </header>

        <PromptView
          :question="session.question"
          :position="session.position"
          :hand="settings.hand"
          :layout-variant="settings.layoutVariant"
          :is-complete="session.isComplete"
        />

        <ResultView
          :elapsed-text="elapsedText"
          :accuracy="totalStats.accuracy"
          :mistakes="totalStats.mistakes"
          :is-complete="session.isComplete"
          :feedback="session.feedback"
          :notice="resetNotice"
          :next-key="nextKey"
          :next-finger="nextFinger"
          :completed-questions="totalStats.completedQuestions"
          @reset="resetQuestion"
          @reset-all="resetAllStats"
        />
      </section>

      <KeyboardView
        :layout="layout"
        :next-key="nextKey"
        :feedback="session.feedback"
        :disabled="session.isComplete"
        @press="pressKey"
      />
    </main>
  </div>

  <ReviewView
    v-if="reviewEnabled"
    :endpoint="REMOTE_ENDPOINT"
    :access="reviewAccess"
    :hand="settings.hand"
  />
  <aside v-else class="rotate-notice" role="status" aria-live="polite" aria-labelledby="rotate-title">
    <div class="phone-icon" aria-hidden="true">↻</div>
    <h2 id="rotate-title">iPhoneを横向きにしてください</h2>
    <p>横画面にすると、キーを大きく表示できます。</p>
    <p v-if="!isStandalone" class="install-hint" data-testid="install-hint">
      全画面で使うには 共有 → ホーム画面に追加
    </p>
  </aside>
</template>
