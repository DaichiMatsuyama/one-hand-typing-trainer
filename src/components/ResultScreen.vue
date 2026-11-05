<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatClearTime } from '../domain/run.js'
import { formatDuration } from '../domain/stats.js'

const props = defineProps({
  summary: { type: Object, required: true },
})

defineEmits(['again', 'settings'])

const scrollArea = ref(null)
const scrollContent = ref(null)
const hasOverflow = ref(false)
const atScrollEnd = ref(true)
let resizeObserver

function updateScrollState() {
  const element = scrollArea.value
  if (!element) return
  hasOverflow.value = element.scrollHeight - element.clientHeight > 2
  atScrollEnd.value = !hasOverflow.value
    || element.scrollTop + element.clientHeight >= element.scrollHeight - 2
}

onMounted(() => {
  nextTick(updateScrollState)
  window.addEventListener('resize', updateScrollState)
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(scrollArea.value)
    resizeObserver.observe(scrollContent.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateScrollState)
  resizeObserver?.disconnect()
})

const endedEarly = computed(() => props.summary.mode !== 'free' && props.summary.endedBy === 'ended')
const analysis = computed(() => props.summary.analysis ?? {})
const nextRankChunks = computed(() => {
  const nextRank = analysis.value.nextRank
  if (!nextRank) return []
  if (nextRank.targetRank && nextRank.requirements?.length) {
    return [`${nextRank.targetRank}ランクまで`, ...nextRank.requirements]
  }
  return nextRank.text ? [nextRank.text] : []
})
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

function protectedTextParts(text, { protectNumberUnit = false } = {}) {
  const characters = [...text]
  const tail = characters.slice(-3).join('')
  const ranges = [{ start: text.length - tail.length, end: text.length, tail: true }]

  if (protectNumberUnit) {
    const match = text.match(/([+-]?\d+(?:\.\d+)?(?:\s*KPM|%|回))/u)
    if (match) ranges.push({ start: match.index, end: match.index + match[0].length, number: true })
  }

  ranges.sort((left, right) => left.start - right.start)
  const mergedRanges = []
  for (const range of ranges) {
    const previous = mergedRanges.at(-1)
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
      previous.tail ||= range.tail
      previous.number ||= range.number
    } else {
      mergedRanges.push({ ...range })
    }
  }

  const parts = []
  let cursor = 0
  for (const range of mergedRanges) {
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start) })
    parts.push({
      text: text.slice(range.start, range.end),
      nowrap: true,
      tail: Boolean(range.tail),
      number: Boolean(range.number),
    })
    cursor = range.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts
}

function growthTextParts(text) {
  return protectedTextParts(text, { protectNumberUnit: true })
}
</script>

<template>
  <main class="run-result-screen" data-testid="run-result">
    <section class="run-result-card">
      <h1>{{ heading }}</h1>
      <div
        class="run-result-scroll-frame"
        :class="{ 'has-overflow': hasOverflow, 'at-scroll-end': atScrollEnd }"
      >
        <div ref="scrollArea" class="run-result-content" data-testid="result-scroll-area" @scroll="updateScrollState">
          <div ref="scrollContent" class="run-result-body">
            <div class="run-result-overview">
              <p v-if="endedEarly" class="ended-early" data-testid="result-ended-early">途中終了</p>
              <p v-if="endedEarly" class="ended-guide" data-testid="result-ended-guide">
                <span
                  v-for="(part, index) in protectedTextParts('最後まで続けるとランクが付きます')"
                  :key="index"
                  :class="{ 'kinsoku-tail': part.tail }"
                >{{ part.text }}</span>
              </p>

              <section v-if="showRank" class="rank-summary" aria-labelledby="rank-heading">
                <div class="rank-mark">
                  <h2 id="rank-heading">今回のランク</h2>
                  <strong data-testid="result-rank">{{ analysis.rank }}</strong>
                </div>
                <div class="rank-details">
                  <p v-if="bestLabel" class="personal-best" data-testid="result-personal-best"><span
                    v-for="(part, index) in protectedTextParts(bestLabel)"
                    :key="index"
                    :class="{ 'kinsoku-tail': part.tail }"
                  >{{ part.text }}</span></p>
                  <p
                    class="next-rank"
                    data-testid="result-next-rank"
                    :aria-label="analysis.nextRank?.text"
                  >
                    <span class="next-rank-chunks" aria-hidden="true">
                      <span v-for="chunk in nextRankChunks" :key="chunk" class="next-rank-chunk">{{ chunk }}</span>
                    </span>
                  </p>
                </div>
              </section>
              <p v-if="showRankUnavailable" class="rank-unavailable" data-testid="result-rank-unavailable">
                <span
                  v-for="(part, index) in protectedTextParts('入力が少なく、ランクを判定できませんでした')"
                  :key="index"
                  :class="{ 'kinsoku-tail': part.tail }"
                >{{ part.text }}</span>
              </p>
              <p v-if="bestExclusion" class="best-exclusion" data-testid="result-best-exclusion"><span
                v-for="(part, index) in protectedTextParts(bestExclusion)"
                :key="index"
                :class="{ 'kinsoku-tail': part.tail }"
              >{{ part.text }}</span></p>

              <p
                v-if="analysis.message"
                class="result-message"
                role="status"
                aria-live="polite"
                data-testid="result-message"
              ><span
                v-for="(part, index) in protectedTextParts(analysis.message.text)"
                :key="index"
                :class="{ 'kinsoku-tail': part.tail }"
              >{{ part.text }}</span></p>
            </div>

            <div class="run-result-details">
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

              <div class="run-result-insights">
                <div v-if="analysis.growth?.improvements?.length" class="result-insight" data-testid="result-growth">
                  <h2>前回からの成長</h2>
                  <ul class="result-growth-list">
                    <li v-for="item in analysis.growth.improvements" :key="item.type">
                      <span
                        v-for="(part, index) in growthTextParts(item.text)"
                        :key="`${item.type}-${index}`"
                        :class="{ 'number-unit': part.number, 'kinsoku-tail': part.tail }"
                      >{{ part.text }}</span>
                    </li>
                  </ul>
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
            </div>
          </div>
        </div>
        <div class="run-result-more" aria-hidden="true" data-testid="result-scroll-cue">
          <span>▼</span>
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
