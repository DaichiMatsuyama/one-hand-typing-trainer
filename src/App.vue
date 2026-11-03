<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import KeyboardView from './components/KeyboardView.vue'
import LevelSelector from './components/LevelSelector.vue'
import PromptView from './components/PromptView.vue'
import ResultView from './components/ResultView.vue'
import { AUTO_ADVANCE_MS } from './appConfig.js'
import { getFinger, getKeyboardLayout, getLayoutPitchCount } from './data/keyboardLayouts.js'
import { getQuestion } from './data/questionBank.js'
import {
  createPracticeSession,
  getElapsedMs,
  getAccuracy,
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
const elapsedText = computed(() => {
  const totalSeconds = Math.floor(elapsedMs.value / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
})
const accuracy = computed(() => getAccuracy(session.value))

let timer
let feedbackTimer
let autoAdvanceTimer
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

function cancelAutoAdvance() {
  clearTimeout(autoAdvanceTimer)
  autoAdvanceTimer = undefined
}

function beginQuestion(savedSession = null) {
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
  session.value = submitKey(session.value, key)
  now.value = Date.now()

  if (!wasComplete && session.value.isComplete) {
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
})

onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(feedbackTimer)
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
          :accuracy="accuracy"
          :mistakes="session.mistakes"
          :is-complete="session.isComplete"
          :feedback="session.feedback"
          :next-key="nextKey"
          :next-finger="nextFinger"
          :completed-questions="results.completedQuestions"
          @reset="resetQuestion"
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

  <aside class="rotate-notice" role="status" aria-live="polite" aria-labelledby="rotate-title">
    <div class="phone-icon" aria-hidden="true">↻</div>
    <h2 id="rotate-title">iPhoneを横向きにしてください</h2>
    <p>横画面にすると、キーを大きく表示できます。</p>
    <p v-if="!isStandalone" class="install-hint" data-testid="install-hint">
      全画面で使うには 共有 → ホーム画面に追加
    </p>
  </aside>
</template>
