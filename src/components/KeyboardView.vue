<script setup>
import { computed } from 'vue'
import { FINGERS, getFinger, getKeySpokenName } from '../data/keyboardLayouts.js'

const props = defineProps({
  layout: { type: Object, required: true },
  nextKey: { type: String, default: '' },
  feedback: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['press'])

const legend = computed(() => {
  const ids = [...new Set(props.layout.rows.flatMap((row) => row.keys.map((item) => item.finger)))]
  return ids.map((id) => FINGERS[id])
})

function keyClass(item) {
  return {
    [`finger-${item.finger}`]: true,
    expected: item.value === props.nextKey && !props.disabled,
    correct: props.feedback?.type === 'correct' && props.feedback?.key === item.value,
    incorrect: props.feedback?.type === 'incorrect' && props.feedback?.key === item.value,
  }
}

function keyAriaLabel(item) {
  const homeDescription = item.isHome ? '、ホームポジション' : ''
  return `${getKeySpokenName(item.value)}キー、${getFinger(item.finger).label}で押す${homeDescription}`
}
</script>

<template>
  <section
    class="keyboard-panel"
    :class="{ complete: disabled }"
    :data-hand="layout.hand"
    :aria-label="`${layout.label}のキーボード`"
  >
    <div class="keyboard-stage">
      <div class="keyboard" data-testid="keyboard">
        <div
          v-for="row in layout.rows"
          :key="row.id"
          class="keyboard-row"
          :style="{ '--row-offset': row.offset }"
        >
          <button
            v-for="item in row.keys"
            :key="item.value"
            type="button"
            class="key"
            :class="keyClass(item)"
            :disabled="disabled"
            :aria-label="keyAriaLabel(item)"
            :aria-current="item.value === nextKey && !disabled ? 'true' : undefined"
            :data-key="item.value"
            @click="emit('press', item.value)"
          >
            <span class="key-character">{{ item.value }}</span>
            <span class="finger-label" aria-hidden="true">{{ getFinger(item.finger).shortLabel }}</span>
            <span v-if="item.isHome" class="home-bump" aria-hidden="true"></span>
          </button>
        </div>

        <div
          v-if="layout.hand === 'right'"
          class="finger-legend finger-legend-embedded"
          aria-label="指の色分け凡例"
        >
          <span v-for="finger in legend" :key="finger.id" class="legend-item">
            <span class="legend-swatch" :class="`finger-${finger.id}`" aria-hidden="true"></span>
            {{ finger.label }}
          </span>
        </div>
      </div>

      <div v-if="layout.hand === 'left'" class="finger-legend" aria-label="指の色分け凡例">
        <span v-for="finger in legend" :key="finger.id" class="legend-item">
          <span class="legend-swatch" :class="`finger-${finger.id}`" aria-hidden="true"></span>
          {{ finger.label }}
        </span>
      </div>
    </div>
  </section>
</template>
