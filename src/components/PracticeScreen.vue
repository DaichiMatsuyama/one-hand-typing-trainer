<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import KeyboardView from './KeyboardView.vue'
import PracticeMenu from './PracticeMenu.vue'
import PromptView from './PromptView.vue'
import ResultView from './ResultView.vue'

const props = defineProps({
  engine: { type: Object, required: true },
})
const emit = defineEmits(['settings', 'finish'])

const {
  settings,
  session,
  resetNotice,
  layout,
  nextKey,
  nextFinger,
  runSummary,
  runElapsedText,
  pressKey,
  resetQuestion,
  resetAllStats,
} = props.engine

const menuOpen = ref(false)
const menuButton = ref(null)

function openMenu() {
  if (!props.engine.openMenu()) return
  menuOpen.value = true
}

function closeMenu({ restoreFocus = true } = {}) {
  props.engine.closeMenu()
  menuOpen.value = false
  if (restoreFocus) nextTick(() => menuButton.value?.focus())
}

function goToSettings() {
  props.engine.finishRun()
  menuOpen.value = false
  emit('settings')
}

function finishPractice() {
  props.engine.finishRun()
  menuOpen.value = false
  emit('finish')
}

onMounted(() => props.engine.attach())
onBeforeUnmount(() => props.engine.detach())
</script>

<template>
  <main class="practice-layout">
    <section
      class="info-strip"
      :class="{ complete: session.isComplete }"
      :inert="menuOpen ? '' : null"
      :aria-hidden="menuOpen ? 'true' : null"
      data-testid="info-strip"
      aria-label="練習内容と成績"
    >
      <PromptView
        :question="session.question"
        :position="session.position"
        :hand="settings.hand"
        :layout-variant="settings.layoutVariant"
        :is-complete="session.isComplete"
      />

      <ResultView
        :elapsed-text="runElapsedText"
        :accuracy="runSummary.accuracy"
        :mistakes="runSummary.mistakes"
        :is-complete="session.isComplete"
        :feedback="session.feedback"
        :notice="resetNotice"
        :next-key="nextKey"
        :next-finger="nextFinger"
        :completed-questions="runSummary.completedQuestions"
        @reset="resetQuestion"
        @reset-all="resetAllStats"
      />

      <button
        ref="menuButton"
        type="button"
        class="menu-button"
        data-testid="menu-button"
        aria-label="メニューを開く"
        @click="openMenu"
      >
        メニュー
      </button>
    </section>

    <KeyboardView
      :inert="menuOpen ? '' : null"
      :aria-hidden="menuOpen ? 'true' : null"
      :layout="layout"
      :next-key="nextKey"
      :feedback="session.feedback"
      :disabled="session.isComplete || session.preserved || menuOpen"
      @press="pressKey"
    />

    <PracticeMenu
      v-if="menuOpen"
      @close="closeMenu"
      @settings="goToSettings"
      @finish="finishPractice"
    />
  </main>
</template>
