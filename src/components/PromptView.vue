<script setup>
import { computed, nextTick, ref } from 'vue'
import {
  describeHomePositionAnnouncement,
  describeHomePositionGuide,
  formatHomePositionKeys,
} from '../domain/homePosition.js'
import { getFinger, getLayoutKeys } from '../data/keyboardLayouts.js'

const props = defineProps({
  question: { type: String, required: true },
  position: { type: Number, required: true },
  hand: { type: String, required: true },
  layoutVariant: { type: String, default: 'jis' },
  isComplete: { type: Boolean, default: false },
  startHint: { type: Boolean, default: false },
  // ホームポジション確認中だけ渡す: { id, hand, keys, established }
  homeCheck: { type: Object, default: null },
})

const emit = defineEmits(['skip-home'])
const card = ref(null)

const nextKey = computed(() => props.question[props.position] ?? '')
const nextFinger = computed(() => {
  const key = getLayoutKeys(props.hand, props.layoutVariant).find((item) => item.value === nextKey.value)
  return key ? getFinger(key.finger)?.label : ''
})
// スキップするとボタンが消えてフォーカスがbodyへ落ちるため、出題欄(見出し)へ移す。
function skipHome() {
  emit('skip-home')
  nextTick(() => card.value?.focus({ preventScroll: true }))
}
const skipLabel = computed(() => (
  `ホームポジション確認をスキップ(${formatHomePositionKeys(props.homeCheck?.hand ?? props.hand)})`
))
const homeEstablished = computed(() => Boolean(props.homeCheck?.established))
const homeGuide = computed(() => (
  props.homeCheck ? describeHomePositionGuide(props.homeCheck.hand ?? props.hand, homeEstablished.value) : ''
))
// 確認中だけ文字が入る常設の読み上げ領域。確認の開始・成立の切り替えを丁寧に読み上げる。
const homeAnnouncement = computed(() => (
  props.homeCheck
    ? describeHomePositionAnnouncement(props.homeCheck.hand ?? props.hand, homeEstablished.value)
    : ''
))
</script>

<template>
  <section
    ref="card"
    tabindex="-1"
    class="prompt-card"
    :class="{
      complete: isComplete && !homeCheck,
      'with-start-hint': startHint && !homeCheck,
      'home-check': Boolean(homeCheck),
      'home-established': homeEstablished,
    }"
    :aria-labelledby="homeCheck ? undefined : 'prompt-title'"
    :aria-label="homeCheck ? 'ホームポジション確認' : undefined"
  >
    <template v-if="homeCheck">
      <!-- 案内の文字は下の読み上げ領域と重複して読まれないよう、画面表示専用にする -->
      <p class="home-check-text" data-testid="home-check-text" aria-hidden="true">
        <span v-if="homeEstablished" class="home-check-mark-inline">✓</span>{{ homeGuide }}
      </p>
      <button
        type="button"
        class="home-skip-button"
        data-testid="home-skip"
        :aria-label="skipLabel"
        @click="skipHome"
      >スキップ</button>
    </template>
    <template v-else>
      <div class="prompt-heading">
        <p id="prompt-title" class="eyebrow">この順番でタップ</p>
        <p v-if="!isComplete" class="finger-hint" :aria-label="`次は${nextFinger}`">
          {{ nextFinger }}
        </p>
      </div>
      <p class="prompt-text" :aria-label="`問題 ${question}、${position}文字入力済み`">
        <span v-if="isComplete" class="completion-mark" aria-hidden="true">✓</span>
        <span
          v-for="(character, index) in question"
          :key="index"
          :class="{
            done: index < position,
            current: index === position && !isComplete,
            pending: index > position,
          }"
          :aria-current="index === position && !isComplete ? 'step' : undefined"
        >{{ character }}</span>
      </p>
      <small v-if="startHint" class="start-hint" data-testid="start-hint">最初のキーでスタート</small>
    </template>
    <p
      class="visually-hidden"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="home-check-live"
    >{{ homeAnnouncement }}</p>
  </section>
</template>
