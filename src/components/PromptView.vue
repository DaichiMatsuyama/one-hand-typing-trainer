<script setup>
import { computed } from 'vue'
import { getFinger, getLayoutKeys } from '../data/keyboardLayouts.js'

const props = defineProps({
  question: { type: String, required: true },
  position: { type: Number, required: true },
  hand: { type: String, required: true },
  layoutVariant: { type: String, default: 'jis' },
  isComplete: { type: Boolean, default: false },
})

const nextKey = computed(() => props.question[props.position] ?? '')
const nextFinger = computed(() => {
  const key = getLayoutKeys(props.hand, props.layoutVariant).find((item) => item.value === nextKey.value)
  return key ? getFinger(key.finger)?.label : ''
})
</script>

<template>
  <section class="prompt-card" aria-labelledby="prompt-title">
    <div class="prompt-heading">
      <p id="prompt-title" class="eyebrow">この順番でタップ</p>
      <p v-if="!isComplete" class="finger-hint">次は {{ nextFinger }}</p>
    </div>
    <p class="prompt-text" :aria-label="`問題 ${question}、${position}文字入力済み`">
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
  </section>
</template>
