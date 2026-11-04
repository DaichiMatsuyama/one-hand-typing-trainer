<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits(['close', 'settings', 'finish'])
const dialog = ref(null)
const confirmation = ref(null)
const lastFocused = ref(null)

function focusFirst() {
  nextTick(() => dialog.value?.querySelector('button')?.focus())
}

function close() {
  emit('close')
}

function openConfirmation(kind) {
  confirmation.value = kind
  focusFirst()
}

function cancelConfirmation() {
  confirmation.value = null
  focusFirst()
}

function confirm() {
  emit(confirmation.value === 'settings' ? 'settings' : 'finish')
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key !== 'Tab') return
  const buttons = [...(dialog.value?.querySelectorAll('button') ?? [])]
    .filter((button) => !button.disabled)
  if (buttons.length === 0) return
  const first = buttons[0]
  const last = buttons.at(-1)
  const active = document.activeElement
  if (!dialog.value?.contains(active) || !buttons.includes(active)) {
    event.preventDefault()
    const target = event.shiftKey ? last : first
    target.focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleFocusIn(event) {
  if (dialog.value?.contains(event.target)) {
    if (event.target instanceof HTMLButtonElement) lastFocused.value = event.target
    return
  }
  const fallback = dialog.value?.contains(lastFocused.value)
    ? lastFocused.value
    : dialog.value?.querySelector('button')
  fallback?.focus()
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('focusin', handleFocusIn)
  focusFirst()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('focusin', handleFocusIn)
})
</script>

<template>
  <div class="practice-menu-backdrop" data-testid="practice-menu" @click.self="close">
    <section ref="dialog" class="practice-menu-dialog" role="dialog" aria-modal="true" aria-labelledby="practice-menu-title">
      <template v-if="!confirmation">
        <h2 id="practice-menu-title">練習メニュー</h2>
        <div class="practice-menu-actions">
          <button type="button" data-testid="menu-resume" @click="close">練習を再開</button>
          <button type="button" data-testid="menu-to-settings" @click="openConfirmation('settings')">練習設定へ戻る</button>
          <button type="button" data-testid="menu-finish" @click="openConfirmation('finish')">練習を終了</button>
        </div>
      </template>
      <template v-else>
        <h2 id="practice-menu-title">
          {{ confirmation === 'settings' ? '練習設定へ戻りますか?' : '練習を終了して、結果を見ますか?' }}
        </h2>
        <div class="practice-confirm-actions">
          <button type="button" data-testid="confirm-cancel" @click="cancelConfirmation">やめる</button>
          <button type="button" data-testid="confirm-yes" @click="confirm">はい</button>
        </div>
      </template>
    </section>
  </div>
</template>
