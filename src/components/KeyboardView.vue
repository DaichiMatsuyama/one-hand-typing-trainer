<script setup>
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'
import { FINGERS, getFinger, getKeySpokenName } from '../data/keyboardLayouts.js'

const CLICK_SUPPRESSION_MS = 1000
const ZERO_DETAIL_CLICK_SUPPRESSION_MS = 100
const POINTER_FAILSAFE_MS = 30000
const MAX_PENDING_CLICKS_PER_KEY = 8

const props = defineProps({
  layout: { type: Object, required: true },
  nextKey: { type: String, default: '' },
  feedback: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
  // ホームポジション確認中だけ渡す: { id, keys, established }。keysは対象の4キー。
  homePosition: { type: Object, default: null },
  // メニュー表示・縦向き・非表示などで停止中は、確認の接触を追跡しない。
  homePositionPaused: { type: Boolean, default: false },
})

const emit = defineEmits(['press', 'home-established', 'home-released', 'home-reset'])
const panel = ref(null)
const clickSuppressions = new Map()
const pointerTargets = new Map()
// ホームポジション確認: pointerIdごとに、対象4キーの上で始まった接触を追跡する。
const homeContacts = new Map()
// 成立した時点で、成立に使った接触(対象キーごとに最初の1本)のpointerId。成立前はnull。
let homeUsedPointers = null

const legend = computed(() => {
  const ids = [...new Set(props.layout.rows.flatMap((row) => row.keys.map((item) => item.finger)))]
  return ids.map((id) => FINGERS[id])
})

const homeTargetKeys = computed(() => new Set(props.homePosition?.keys ?? []))
const homeEstablished = computed(() => Boolean(props.homePosition?.established))

function keyClass(item) {
  const isHomeTarget = homeTargetKeys.value.has(item.value)
  return {
    [`finger-${item.finger}`]: true,
    'is-disabled': props.disabled,
    'home-target': isHomeTarget,
    'home-confirmed': isHomeTarget && homeEstablished.value,
    expected: item.value === props.nextKey && !props.disabled,
    correct: props.feedback?.type === 'correct' && props.feedback?.key === item.value,
    incorrect: props.feedback?.type === 'incorrect' && props.feedback?.key === item.value,
  }
}

function keyAriaLabel(item) {
  const homeDescription = item.isHome ? '、ホームポジション' : ''
  return `${getKeySpokenName(item.value)}キー、${getFinger(item.finger).label}で押す${homeDescription}`
}

function removePointerMark(mark) {
  clearTimeout(mark.clickTimer)
  clearTimeout(mark.failsafeTimer)

  if (pointerTargets.get(mark.pointerId) === mark) {
    pointerTargets.delete(mark.pointerId)
  }

  const suppression = clickSuppressions.get(mark.element)
  if (!suppression) return

  const index = suppression.pendingClicks.indexOf(mark)
  if (index !== -1) suppression.pendingClicks.splice(index, 1)
  if (suppression.pendingClicks.length === 0) clickSuppressions.delete(mark.element)
}

function resetHomeTracking() {
  homeContacts.clear()
  homeUsedPointers = null
}

// blur/pagehideなどで接触を捨てるとき。成立済みなら、画面外の指の状態が分からなくなるため、
// エンジンの成立状態も未成立へ戻す(置き直すまで成功にならない)。
function discardHomeContacts() {
  const wasEstablished = homeUsedPointers !== null
  resetHomeTracking()
  if (wasEstablished) emit('home-reset')
}

function isHomeCheckTracking() {
  return Boolean(props.homePosition) && !props.homePositionPaused
}

// 対象の4キーそれぞれに1本以上の接触が同時にあれば成立。順番に置いてよく、
// 対象外のキー・余分な接触・同じキーの重複は成立の邪魔にも入力ミスにもしない。
function trackHomeContact(event, item) {
  if (!isHomeCheckTracking()) return
  const targets = props.homePosition.keys
  if (!targets.includes(item.value)) return
  // pointerIdが再利用された場合は、新しい接触として数え直す。
  homeContacts.delete(event.pointerId)
  homeContacts.set(event.pointerId, item.value)
  if (homeUsedPointers) return

  const firstPointerByKey = new Map()
  for (const [pointerId, key] of homeContacts) {
    if (!firstPointerByKey.has(key)) firstPointerByKey.set(key, pointerId)
  }
  if (targets.every((key) => firstPointerByKey.has(key))) {
    homeUsedPointers = new Set(firstPointerByKey.values())
    emit('home-established')
  }
}

// 離れた接触を外す。成立後に、成立に使った接触が離れたら成功を通知する。
// pointercancelも「離れた」として同じに扱う。成立前に離れた場合は外すだけ。
function releaseHomeContact(event) {
  if (!homeContacts.has(event.pointerId)) return
  homeContacts.delete(event.pointerId)
  if (!homeUsedPointers?.has(event.pointerId)) return
  homeUsedPointers = null
  emit('home-released')
}

// 確認の開始・終了・次の確認・停止の切り替えで、追跡中の接触をすべて捨てる。
// 成立(establishedの変化)ではオブジェクトが入れ替わるだけなので、idと停止の値そのものを監視する。
watch(
  [() => props.homePosition?.id ?? null, () => props.homePositionPaused],
  resetHomeTracking,
  { flush: 'sync' },
)

function clearPointerState() {
  for (const suppression of clickSuppressions.values()) {
    for (const mark of [...suppression.pendingClicks]) removePointerMark(mark)
  }
  clickSuppressions.clear()
  pointerTargets.clear()
}

function handleWindowLoss() {
  discardHomeContacts()
  clearPointerState()
}

function pruneDetachedMarks() {
  for (const [element, suppression] of clickSuppressions) {
    if (panel.value?.contains(element)) continue
    for (const mark of [...suppression.pendingClicks]) removePointerMark(mark)
  }
}

function schedulePointerFailsafe(mark) {
  mark.failsafeTimer = setTimeout(() => {
    if (!mark.finished) {
      schedulePointerFailsafe(mark)
      return
    }
    removePointerMark(mark)
  }, POINTER_FAILSAFE_MS)
}

function handlePointerDown(event, item) {
  pruneDetachedMarks()

  const previousMark = pointerTargets.get(event.pointerId)
  if (previousMark) removePointerMark(previousMark)
  if (event.button !== 0) return

  trackHomeContact(event, item)

  const element = event.currentTarget
  let suppression = clickSuppressions.get(element)
  if (!suppression) {
    suppression = { pendingClicks: [] }
    clickSuppressions.set(element, suppression)
  }

  if (suppression.pendingClicks.length >= MAX_PENDING_CLICKS_PER_KEY) {
    removePointerMark(suppression.pendingClicks[0])
  }

  const mark = {
    element,
    pointerId: event.pointerId,
    finished: false,
    finishedAt: undefined,
    clickTimer: undefined,
    failsafeTimer: undefined,
  }
  schedulePointerFailsafe(mark)
  suppression.pendingClicks.push(mark)
  pointerTargets.set(event.pointerId, mark)

  if (!props.disabled) emit('press', item.value)
}

function handlePointerFinish(event) {
  releaseHomeContact(event)
  const mark = pointerTargets.get(event.pointerId)
  if (!mark || mark.finished) return
  mark.finished = true
  mark.finishedAt = Date.now()
  mark.clickTimer = setTimeout(() => removePointerMark(mark), CLICK_SUPPRESSION_MS)
}

function handleClick(event, item) {
  pruneDetachedMarks()

  const element = event.currentTarget
  const suppression = clickSuppressions.get(element)

  if (event.detail === 0) {
    const now = Date.now()
    const mark = suppression?.pendingClicks.find((candidate) => {
      if (!candidate.finished) return false
      const elapsed = now - candidate.finishedAt
      return elapsed >= 0 && elapsed <= ZERO_DETAIL_CLICK_SUPPRESSION_MS
    })
    if (mark) {
      removePointerMark(mark)
      return
    }
    if (!props.disabled) emit('press', item.value)
    return
  }

  if (suppression?.pendingClicks.length > 0) {
    const mark = suppression.pendingClicks.find((candidate) => candidate.finished)
      ?? suppression.pendingClicks[0]
    removePointerMark(mark)
    return
  }

  if (!props.disabled) emit('press', item.value)
}

function preventKeyboardGesture(event) {
  event.preventDefault()
}

onMounted(() => {
  document.addEventListener('pointerup', handlePointerFinish)
  document.addEventListener('pointercancel', handlePointerFinish)
  window.addEventListener('pagehide', handleWindowLoss)
  window.addEventListener('blur', handleWindowLoss)
  panel.value?.addEventListener('gesturestart', preventKeyboardGesture, { passive: false })
  panel.value?.addEventListener('gesturechange', preventKeyboardGesture, { passive: false })
})

onUpdated(pruneDetachedMarks)

onBeforeUnmount(() => {
  document.removeEventListener('pointerup', handlePointerFinish)
  document.removeEventListener('pointercancel', handlePointerFinish)
  window.removeEventListener('pagehide', handleWindowLoss)
  window.removeEventListener('blur', handleWindowLoss)
  panel.value?.removeEventListener('gesturestart', preventKeyboardGesture, { passive: false })
  panel.value?.removeEventListener('gesturechange', preventKeyboardGesture, { passive: false })
  resetHomeTracking()
  clearPointerState()
})
</script>

<template>
  <section
    ref="panel"
    class="keyboard-panel"
    :class="{ complete: disabled && !homePosition, 'home-check': Boolean(homePosition) }"
    :data-hand="layout.hand"
    :aria-label="`${layout.label}のキーボード`"
    @contextmenu.prevent
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
            :aria-disabled="disabled ? 'true' : undefined"
            :aria-label="keyAriaLabel(item)"
            :aria-current="item.value === nextKey && !disabled ? 'true' : undefined"
            :data-key="item.value"
            @pointerdown="handlePointerDown($event, item)"
            @pointerup="handlePointerFinish"
            @pointercancel="handlePointerFinish"
            @click="handleClick($event, item)"
          >
            <span class="key-character">{{ item.value }}</span>
            <span class="finger-label" aria-hidden="true">{{ getFinger(item.finger).shortLabel }}</span>
            <span v-if="item.isHome" class="home-bump" aria-hidden="true"></span>
            <span
              v-if="homeEstablished && homeTargetKeys.has(item.value)"
              class="home-check-mark"
              aria-hidden="true"
            >✓</span>
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
