<script setup>
defineProps({
  elapsedText: { type: String, required: true },
  accuracy: { type: Number, required: true },
  mistakes: { type: Number, required: true },
  isComplete: { type: Boolean, default: false },
  feedback: { type: Object, default: null },
  completedQuestions: { type: Number, default: 0 },
})

defineEmits(['next', 'reset'])
</script>

<template>
  <section class="result-bar" aria-label="練習結果">
    <dl class="stats">
      <div><dt>時間</dt><dd data-testid="elapsed">{{ elapsedText }}</dd></div>
      <div><dt>正答率</dt><dd>{{ accuracy }}%</dd></div>
      <div><dt>ミス</dt><dd data-testid="mistakes">{{ mistakes }}</dd></div>
      <div><dt>クリア</dt><dd>{{ completedQuestions }}問</dd></div>
    </dl>

    <p class="feedback" :class="feedback?.type" role="status" aria-live="polite">
      <template v-if="isComplete">クリア！</template>
      <template v-else-if="feedback?.type === 'correct'">正解</template>
      <template v-else-if="feedback?.type === 'incorrect'">もう一度</template>
      <template v-else>キーをタップしよう</template>
    </p>

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
