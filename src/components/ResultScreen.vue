<script setup>
import { formatDuration } from '../domain/stats.js'

defineProps({
  summary: { type: Object, required: true },
})

defineEmits(['again', 'settings'])
</script>

<template>
  <main class="run-result-screen" data-testid="run-result">
    <section class="run-result-card">
      <h1>今回の練習結果</h1>
      <dl class="run-result-grid">
        <div><dt>練習時間</dt><dd data-testid="result-time">{{ formatDuration(summary.inputMs) }}</dd></div>
        <div><dt>完了問題数</dt><dd data-testid="result-completed">{{ summary.completedQuestions }}問</dd></div>
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
