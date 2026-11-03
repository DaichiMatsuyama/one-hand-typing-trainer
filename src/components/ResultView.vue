<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { LONG_PRESS_RESET_MS } from '../appConfig.js'
import { getKeySpokenName } from '../data/keyboardLayouts.js'

const props = defineProps({
  elapsedText: { type: String, required: true },
  accuracy: { type: Number, required: true },
  mistakes: { type: Number, required: true },
  isComplete: { type: Boolean, default: false },
  feedback: { type: Object, default: null },
  notice: { type: String, default: '' },
  completedQuestions: { type: Number, default: 0 },
  nextKey: { type: String, default: '' },
  nextFinger: { type: String, default: '' },
})

const emit = defineEmits(['reset', 'reset-all'])

const nextInstruction = computed(() => (
  props.nextKey ? `${getKeySpokenName(props.nextKey)}キーを${props.nextFinger}で押してください` : ''
))

const liveMessage = computed(() => {
  if (props.notice) return props.notice
  if (props.isComplete) return 'クリア！ 自動で次の問題に進みます'
  if (props.feedback?.type === 'incorrect') return `不正解。${nextInstruction.value}`
  if (props.feedback?.type === 'correct') return `正解。次は${nextInstruction.value}`
  return `次は${nextInstruction.value}`
})

// タップ=今の問題をやり直す / 長押し=累計成績もすべてリセット
const pressing = ref(false)
let pressTimer
let longPressFired = false

function startPress(event) {
  if (event.button !== undefined && event.button !== 0) return
  longPressFired = false
  pressing.value = true
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    longPressFired = true
    pressing.value = false
    emit('reset-all')
  }, LONG_PRESS_RESET_MS)
}

function cancelPress() {
  clearTimeout(pressTimer)
  pressing.value = false
}

function handleClick() {
  // 長押しが成立した直後のclickは通常のやり直しとして扱わない
  if (longPressFired) {
    longPressFired = false
    return
  }
  emit('reset')
}

onBeforeUnmount(() => clearTimeout(pressTimer))
</script>

<template>
  <section class="result-bar" :class="{ complete: isComplete }" aria-label="練習結果">
    <dl class="stats">
      <div><dt>時間</dt><dd data-testid="elapsed">{{ elapsedText }}</dd></div>
      <div><dt>正答率</dt><dd data-testid="accuracy">{{ accuracy }}%</dd></div>
      <div><dt>ミス</dt><dd data-testid="mistakes">{{ mistakes }}</dd></div>
      <div><dt>クリア</dt><dd data-testid="completed">{{ completedQuestions }}問</dd></div>
    </dl>

    <p
      class="feedback"
      :class="feedback?.type"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >{{ liveMessage }}</p>

    <div class="result-actions">
      <button
        type="button"
        class="secondary-button reset-button"
        :class="{ pressing }"
        :style="{ '--long-press-ms': `${LONG_PRESS_RESET_MS}ms` }"
        data-testid="reset"
        aria-describedby="reset-hint"
        @pointerdown="startPress"
        @pointerup="cancelPress"
        @pointercancel="cancelPress"
        @pointerleave="cancelPress"
        @contextmenu.prevent
        @click="handleClick"
      >
        <span class="reset-label">やり直す</span>
      </button>
      <span id="reset-hint" class="visually-hidden">今の問題を最初からやり直します。長押しすると、時間・正答率・ミス・クリア数もすべてリセットします。</span>
    </div>
  </section>
</template>
