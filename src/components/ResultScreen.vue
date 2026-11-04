<script setup>
import { computed } from 'vue'
import { formatClearTime } from '../domain/run.js'
import { formatDuration } from '../domain/stats.js'

const props = defineProps({
  summary: { type: Object, required: true },
})

defineEmits(['again', 'settings'])

const endedEarly = computed(() => props.summary.mode !== 'free' && props.summary.endedBy === 'ended')
const analysis = computed(() => props.summary.analysis ?? {})
const showRank = computed(() => (
  props.summary.mode !== 'free' && !endedEarly.value && Boolean(analysis.value.rank)
))
const showRankUnavailable = computed(() => (
  props.summary.mode !== 'free'
    && props.summary.endedBy !== 'ended'
    && analysis.value.rank === null
))
const bestLabel = computed(() => {
  if (!showRank.value || !analysis.value.personalBest?.eligible) return ''
  if (analysis.value.personalBest.isFirst) return '⭐ 初めての記録'
  if (analysis.value.personalBest.isNewBest) return '⭐ 自己ベスト更新'
  return ''
})
const bestExclusion = computed(() => {
  if (endedEarly.value) return '途中終了の回は自己ベストの対象外です'
  if (showRank.value && analysis.value.personalBest?.reason === 'menu') {
    return 'メニューで止めた回は自己ベストの対象外です'
  }
  return ''
})
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
      <div class="run-result-fixed">
        <p v-if="endedEarly" class="ended-early" data-testid="result-ended-early">途中終了</p>
        <p v-if="endedEarly" class="ended-guide" data-testid="result-ended-guide">
          最後まで続けるとランクが付きます
        </p>

        <section v-if="showRank" class="rank-summary" aria-labelledby="rank-heading">
          <div class="rank-mark">
            <h2 id="rank-heading">今回のランク</h2>
            <strong data-testid="result-rank">{{ analysis.rank }}</strong>
          </div>
          <div class="rank-details">
            <p v-if="bestLabel" class="personal-best" data-testid="result-personal-best">{{ bestLabel }}</p>
            <p class="next-rank" data-testid="result-next-rank">{{ analysis.nextRank?.text }}</p>
          </div>
        </section>
        <p v-if="showRankUnavailable" class="rank-unavailable" data-testid="result-rank-unavailable">
          入力が少なく、ランクを判定できませんでした
        </p>
        <p v-if="bestExclusion" class="best-exclusion" data-testid="result-best-exclusion">{{ bestExclusion }}</p>

        <p
          v-if="analysis.message"
          class="result-message"
          role="status"
          aria-live="polite"
          data-testid="result-message"
        >{{ analysis.message.text }}</p>
      </div>

      <div class="run-result-content">
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

        <div v-if="analysis.growth?.improvements?.length" class="result-insight" data-testid="result-growth">
          <h2>前回からの成長</h2>
          <ul><li v-for="item in analysis.growth.improvements" :key="item.type">{{ item.text }}</li></ul>
        </div>
        <div v-if="analysis.weakKeys?.length" class="result-insight" data-testid="result-weak-keys">
          <h2>苦手キー TOP{{ analysis.weakKeys.length }}</h2>
          <ul class="weak-key-list">
            <li v-for="item in analysis.weakKeys" :key="item.key">
              <kbd>{{ item.key }}</kbd><span>ミス {{ item.misses }}/{{ item.shown }}</span>
            </li>
          </ul>
        </div>
      </div>
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
