<script setup>
defineProps({
  modelValue: { type: Number, required: true },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <fieldset class="segmented level-selector" aria-label="練習レベル">
    <legend class="visually-hidden">練習レベル</legend>
    <button
      v-for="level in [1, 2, 3]"
      :key="level"
      type="button"
      :class="{ selected: modelValue === level }"
      :aria-pressed="modelValue === level"
      :data-testid="`level-${level}`"
      @click="emit('update:modelValue', level)"
    >
      Lv.{{ level }}
    </button>
  </fieldset>
</template>
