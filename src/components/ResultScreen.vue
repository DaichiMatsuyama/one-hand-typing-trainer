<script setup>
import { computed } from 'vue'
import { formatClearTime } from '../domain/run.js'
import { formatDuration } from '../domain/stats.js'

const props = defineProps({
  summary: { type: Object, required: true },
})

defineEmits(['again', 'settings'])

const endedEarly = computed(() => props.summary.mode !== 'free' && props.summary.endedBy === 'ended')
const heading = computed(() => {
  if (props.summary.mode === 'timeAttack') return `タイムアタック 結果${endedEarly.value ? '(途中終了)' : ''}`
  if (props.summary.mode === 'timeLimit') return `制限時間 結果${endedEarly.value ? '(途中終了)' : ''}`
  return '今回の練習結果'
})
const completedText = computed(() => (
  props.summary.mode === 'timeAttack'
    ? `${props.summary.completedQuestions}/${props.summary.targetCount}問`
    : `${props.summary.completedQuestions}問`
))
const timeLabel = computed(() => (
  props.summary.mode === 'timeAttack' && props.summary.endedBy === 'completed'
    ? 'クリアタイム'
    : props.summary.mode === 'free' ? '練習時間' : '経過時間'
))
const timeText = computed(() => (
  props.summary.mode === 'timeAttack' && props.summary.endedBy === 'completed'
    ? formatClearTime(props.summary.activeMs)
    : props.summary.mode === 'free'
      ? formatDuration(props.summary.inputMs)
      : formatDuration(props.summary.activeMs)
))
</script>

<template>
  <main class="run-result-screen" data-testid="run-result">
    <section class="run-result-card">
      <h1>{{ heading }}</h1>
      <p v-if="endedEarly" class="ended-early" data-testid="result-ended-early">途中終了</p>
      <dl class="run-result-grid" :class="`mode-${summary.mode}`">
        <div
          :class="{ primary: summary.mode === 'timeAttack' && summary.endedBy === 'completed' }"
        >
          <dt>{{ timeLabel }}</dt>
          <dd data-testid="result-time">
            <span v-if="summary.mode === 'timeAttack' && summary.endedBy === 'completed'" data-testid="result-clear-time">{{ timeText }}</span>
            <template v-else>{{ timeText }}</template>
          </dd>
        </div>
        <div :class="{ primary: summary.mode === 'timeLimit' }">
          <dt>完了問題数</dt>
          <dd data-testid="result-completed"><span data-testid="result-count">{{ completedText }}</span></dd>
        </div>
        <div v-if="summary.mode === 'timeLimit'">
          <dt>制限時間</dt>
          <dd data-testid="result-limit">{{ summary.timeLimitSec }}秒</dd>
        </div>
        <div><dt>正しいキー入力数</dt><dd data-testid="result-correct">{{ summary.correctCount }}</dd></div>
        <div><dt>ミス入力数</dt><dd data-testid="result-mistakes">{{ summary.mistakes }}</dd></div>
        <div><dt>キー入力正解率</dt><dd data-testid="result-accuracy">{{ summary.accuracy }}%</dd></div>
        <div><dt>入力速度</dt><dd data-testid="result-kpm">{{ summary.kpm === null ? '--' : `${summary.kpm} KPM` }}</dd></div>
      </dl>
      <div class="run-result-actions">
        <button type="button" class="result-again-button" data-testid="result-again" @click="$emit('again')">
          同じ設定でもう一度
        </button>
        <button type="button" class="result-settings-button" data-testid="result-to-settings" @click="$emit('settings')">
          練習設定へ戻る
        </button>
      </div>
    </section>
  </main>
</template>
