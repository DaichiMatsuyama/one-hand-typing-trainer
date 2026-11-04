<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { LONG_PRESS_RESET_MS } from '../appConfig.js'
import { getKeySpokenName } from '../data/keyboardLayouts.js'

const props = defineProps({
  elapsedText: { type: String, required: true },
  activeText: { type: String, default: '0:00' },
  remainingText: { type: String, default: '0:00' },
  remainingMs: { type: Number, default: 0 },
  mode: { type: String, default: 'free' },
  targetCount: { type: Number, default: 10 },
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
const remainingUrgent = computed(() => props.mode === 'timeLimit'
  && props.remainingMs > 0 && props.remainingMs <= 10_000)

const liveMessage = computed(() => {
  if (props.notice) return props.notice
  if (props.isComplete) return 'クリア！ 自動で次の問題に進みます'
  if (props.feedback?.type === 'incorrect') return `不正解。${nextInstruction.value}`
  if (props.feedback?.type === 'correct') return `正解。次は${nextInstruction.value}`
  return `次は${nextInstruction.value}`
})

// タップ=今の問題をやり直す / 長押し=今回の成績をゼロから数え直す
const pressing = ref(false)
let pressTimer
let longPressFired = false
let cancelledPress = false

function startPress(event) {
  if (event.button !== undefined && event.button !== 0) return
  longPressFired = false
  cancelledPress = false
  pressing.value = true
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    longPressFired = true
    pressing.value = false
    emit('reset-all')
  }, LONG_PRESS_RESET_MS)
}

function endPress() {
  clearTimeout(pressTimer)
  pressing.value = false
}

function cancelPress() {
  endPress()
  // pointerleave/pointercancelの直後にブラウザがclickを生成しても、通常タップにはしない。
  // 次のpointerdownで解除する。
  cancelledPress = true
}

function handleClick() {
  // 長押しが成立した直後のclickは通常のやり直しとして扱わない
  if (longPressFired) {
    longPressFired = false
    return
  }
  if (cancelledPress) return
  emit('reset')
}

onBeforeUnmount(() => clearTimeout(pressTimer))
</script>

<template>
  <section class="result-bar" :class="{ complete: isComplete, 'no-reset': mode !== 'free' }" aria-label="今回の練習成績">
    <dl class="stats">
      <template v-if="mode === 'timeAttack'">
        <div><dt>経過時間</dt><dd data-testid="elapsed" :aria-label="`経過時間 ${activeText}`">{{ activeText }}</dd></div>
        <div><dt>進捗</dt><dd data-testid="progress" :aria-label="`進捗 ${completedQuestions}/${targetCount}問`">{{ completedQuestions }}/{{ targetCount }}</dd></div>
        <div><dt>ミス</dt><dd data-testid="mistakes" :aria-label="`ミス ${mistakes}回`">{{ mistakes }}</dd></div>
        <div><dt>正答率</dt><dd data-testid="accuracy" :aria-label="`正答率 ${accuracy}%`">{{ accuracy }}%</dd></div>
      </template>
      <template v-else-if="mode === 'timeLimit'">
        <div :class="{ urgent: remainingUrgent }"><dt>残り時間</dt><dd data-testid="remaining" :aria-label="`残り時間 ${remainingText}`">{{ remainingText }}</dd></div>
        <div><dt>クリア</dt><dd data-testid="completed" :aria-label="`クリア ${completedQuestions}問`">{{ completedQuestions }}問</dd></div>
        <div><dt>ミス</dt><dd data-testid="mistakes" :aria-label="`ミス ${mistakes}回`">{{ mistakes }}</dd></div>
        <div><dt>正答率</dt><dd data-testid="accuracy" :aria-label="`正答率 ${accuracy}%`">{{ accuracy }}%</dd></div>
      </template>
      <template v-else>
        <div><dt>時間</dt><dd data-testid="elapsed" :aria-label="`入力時間 ${elapsedText}`">{{ elapsedText }}</dd></div>
        <div><dt>正答率</dt><dd data-testid="accuracy" :aria-label="`正答率 ${accuracy}%`">{{ accuracy }}%</dd></div>
        <div><dt>ミス</dt><dd data-testid="mistakes" :aria-label="`ミス ${mistakes}回`">{{ mistakes }}</dd></div>
        <div><dt>クリア</dt><dd data-testid="completed" :aria-label="`クリア ${completedQuestions}問`">{{ completedQuestions }}問</dd></div>
      </template>
    </dl>

    <p
      class="feedback"
      :class="feedback?.type"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >{{ liveMessage }}</p>

    <div v-if="mode === 'free'" class="result-actions">
      <button
        type="button"
        class="secondary-button reset-button"
        :class="{ pressing }"
        :style="{ '--long-press-ms': `${LONG_PRESS_RESET_MS}ms` }"
        data-testid="reset"
        aria-describedby="reset-hint"
        @pointerdown="startPress"
        @pointerup="endPress"
        @pointercancel="cancelPress"
        @pointerleave="cancelPress"
        @contextmenu.prevent
        @click="handleClick"
      >
        <span class="reset-label">やり直す</span>
      </button>
      <span id="reset-hint" class="visually-hidden">今の問題を最初からやり直します。長押しすると、今回の時間・正答率・ミス・クリア数をリセットします。</span>
    </div>
  </section>
</template>
