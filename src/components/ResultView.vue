<script setup>
import { computed } from 'vue'

const props = defineProps({
  elapsedText: { type: String, required: true },
  accuracy: { type: Number, required: true },
  mistakes: { type: Number, required: true },
  isComplete: { type: Boolean, default: false },
  feedback: { type: Object, default: null },
  completedQuestions: { type: Number, default: 0 },
  nextKey: { type: String, default: '' },
  nextFinger: { type: String, default: '' },
})

defineEmits(['next', 'reset'])

const nextInstruction = computed(() => (
  props.nextKey ? `${props.nextKey.toUpperCase()}キーを${props.nextFinger}で押してください` : ''
))

const liveMessage = computed(() => {
  if (props.isComplete) return 'クリア！ 次の問題に進めます'
  if (props.feedback?.type === 'incorrect') return `不正解。${nextInstruction.value}`
  if (props.feedback?.type === 'correct') return `正解。次は${nextInstruction.value}`
  return `次は${nextInstruction.value}`
})
</script>

<template>
  <section class="result-bar" :class="{ complete: isComplete }" aria-label="練習結果">
    <dl class="stats">
      <div><dt>時間</dt><dd data-testid="elapsed">{{ elapsedText }}</dd></div>
      <div><dt>正答率</dt><dd>{{ accuracy }}%</dd></div>
      <div><dt>ミス</dt><dd data-testid="mistakes">{{ mistakes }}</dd></div>
      <div><dt>クリア</dt><dd>{{ completedQuestions }}問</dd></div>
    </dl>

    <p
      class="feedback"
      :class="feedback?.type"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >{{ liveMessage }}</p>

    <div class="result-actions">
      <button type="button" class="secondary-button" data-testid="reset" @click="$emit('reset')">
        やり直す
      </button>
      <button
        v-if="isComplete"
        type="button"
        class="primary-button"
        data-testid="next-question"
        @click="$emit('next')"
      >
        次の問題
      </button>
    </div>
  </section>
</template>
