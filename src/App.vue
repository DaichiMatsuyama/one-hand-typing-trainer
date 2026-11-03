<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import KeyboardView from './components/KeyboardView.vue'
import LevelSelector from './components/LevelSelector.vue'
import PromptView from './components/PromptView.vue'
import ResultView from './components/ResultView.vue'
import { getKeyboardLayout } from './data/keyboardLayouts.js'
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
  loadAppState,
  saveAppState,
} from './services/storage.js'

const saved = loadAppState()
const settings = ref({ ...defaultSettings, ...(saved?.settings ?? {}) })
const results = ref({ ...defaultResults, ...(saved?.results ?? {}) })
const questionIndex = ref(saved?.questionIndex ?? 0)

const questionOptions = computed(() => ({ ...settings.value }))
const currentQuestion = computed(() => getQuestion(questionOptions.value, questionIndex.value))
const session = ref(restorePracticeSession(saved?.session, currentQuestion.value))
const now = ref(Date.now())

const layout = computed(() => getKeyboardLayout(settings.value.hand, settings.value.layoutVariant))
const nextKey = computed(() => session.value.question[session.value.position] ?? '')
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

function snapshot() {
  saveAppState({
    settings: settings.value,
    results: results.value,
    questionIndex: questionIndex.value,
    session: { ...session.value, elapsedMs: elapsedMs.value, feedback: null },
  })
}

function beginQuestion(savedSession = null) {
  now.value = Date.now()
  session.value = savedSession
    ? restorePracticeSession(savedSession, currentQuestion.value, now.value)
    : createPracticeSession(currentQuestion.value, now.value)
  snapshot()
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
  } else {
    feedbackTimer = setTimeout(() => {
      session.value = { ...session.value, feedback: null }
    }, 450)
  }
  snapshot()
}

function nextQuestion() {
  questionIndex.value += 1
  beginQuestion()
}

function resetQuestion() {
  beginQuestion()
}

function handlePageHide() {
  const timestamp = Date.now()
  session.value = pausePracticeSession(session.value, timestamp)
  now.value = timestamp
  snapshot()
}

function handleVisibilityChange() {
  const timestamp = Date.now()
  session.value = document.hidden
    ? pausePracticeSession(session.value, timestamp)
    : resumePracticeSession(session.value, timestamp)
  now.value = timestamp
  snapshot()
}

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  window.addEventListener('pagehide', handlePageHide)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (document.hidden) handleVisibilityChange()
})

onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(feedbackTimer)
  window.removeEventListener('pagehide', handlePageHide)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="app-shell">
    <header class="top-bar">
      <div>
        <p class="brand-kicker">キー位置を片手ずつ覚える</p>
        <h1>片手タイピング</h1>
      </div>

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
          :aria-describedby="settings.hand === 'left' ? 'symbol-hand-hint' : undefined"
          data-testid="include-symbols"
          @change="toggleSymbols"
        />
        <span class="symbol-label">
          記号を含める
          <small v-if="settings.hand === 'left'" id="symbol-hand-hint">右手のみ</small>
        </span>
      </label>
    </header>

    <main>
      <PromptView
        :question="session.question"
        :position="session.position"
        :hand="settings.hand"
        :layout-variant="settings.layoutVariant"
        :is-complete="session.isComplete"
      />

      <KeyboardView
        :layout="layout"
        :next-key="nextKey"
        :feedback="session.feedback"
        :disabled="session.isComplete"
        @press="pressKey"
      />

      <ResultView
        :elapsed-text="elapsedText"
        :accuracy="accuracy"
        :mistakes="session.mistakes"
        :is-complete="session.isComplete"
        :feedback="session.feedback"
        :completed-questions="results.completedQuestions"
        @next="nextQuestion"
        @reset="resetQuestion"
      />
    </main>
  </div>

  <aside class="rotate-notice" role="dialog" aria-labelledby="rotate-title" aria-modal="true">
    <div class="phone-icon" aria-hidden="true">↻</div>
    <h2 id="rotate-title">iPhoneを横向きにしてください</h2>
    <p>横画面にすると、キーを大きく表示できます。</p>
  </aside>
</template>
