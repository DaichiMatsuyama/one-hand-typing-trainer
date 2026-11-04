<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import PracticeScreen from './components/PracticeScreen.vue'
import ReviewView from './components/ReviewView.vue'
import { usePracticeEngine } from './composables/usePracticeEngine.js'
import { REMOTE_ENDPOINT } from './remoteConfig.js'
import { loadAccess } from './services/access.js'
import { remoteSync } from './services/remoteSync.js'

const engine = usePracticeEngine()
const { settings, layoutPitchCount } = engine

// 縦向きの振り返り画面は、送信先が設定され、コード入力済みの端末だけで使える(それ以外は従来の回転案内)
const reviewAccess = REMOTE_ENDPOINT ? loadAccess() : null
const reviewEnabled = Boolean(reviewAccess)

const isStandalone = ref(
  Boolean(window.navigator.standalone)
  || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches),
)

let displayModeQuery
let stopRemoteSync = () => {}

function updateStandaloneStatus() {
  isStandalone.value = Boolean(window.navigator.standalone)
    || Boolean(displayModeQuery?.matches)
}

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    displayModeQuery = window.matchMedia('(display-mode: standalone)')
    displayModeQuery.addEventListener?.('change', updateStandaloneStatus)
  }
  updateStandaloneStatus()
  // 画面を切り替えても再送処理が動き続けるよう、アプリ全体で開始する。
  stopRemoteSync = remoteSync.start() ?? stopRemoteSync
})

onBeforeUnmount(() => {
  stopRemoteSync()
  displayModeQuery?.removeEventListener?.('change', updateStandaloneStatus)
})
</script>

<template>
  <div
    class="app-shell"
    :data-hand="settings.hand"
    :data-layout-variant="settings.layoutVariant"
    :style="{ '--keyboard-pitch-count': layoutPitchCount }"
  >
    <PracticeScreen :engine="engine" />
  </div>

  <ReviewView
    v-if="reviewEnabled"
    :endpoint="REMOTE_ENDPOINT"
    :access="reviewAccess"
    :hand="settings.hand"
  />
  <aside v-else class="rotate-notice" role="status" aria-live="polite" aria-labelledby="rotate-title">
    <div class="phone-icon" aria-hidden="true">↻</div>
    <h2 id="rotate-title">iPhoneを横向きにしてください</h2>
    <p>横画面にすると、キーを大きく表示できます。</p>
    <p v-if="!isStandalone" class="install-hint" data-testid="install-hint">
      全画面で使うには 共有 → ホーム画面に追加
    </p>
  </aside>
</template>
