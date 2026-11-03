<script setup>
import { ref } from 'vue'
import { REMOTE_ENDPOINT } from '../remoteConfig.js'
import { createDeviceId, loadAccess, saveAccess, verifyCode } from '../services/access.js'

const props = defineProps({
  mode: { type: String, required: true },
  endpoint: { type: String, default: REMOTE_ENDPOINT },
})

const emit = defineEmits(['granted'])

const code = ref('')
const busy = ref(false)
const errorMessage = ref('')

const ERROR_MESSAGES = {
  invalid: 'コードが違います。もう一度確認してください。',
  locked: '間違いが続いたため、しばらく入力できません。少し待ってからやり直してください。',
  network: '通信できませんでした。電波のよい場所で、もう一度試してください。',
  server: 'うまく確認できませんでした。しばらくしてからやり直してください。',
}

async function submit() {
  const trimmed = code.value.trim()
  if (!trimmed || busy.value) return
  busy.value = true
  errorMessage.value = ''
  const deviceId = loadAccess()?.deviceId ?? createDeviceId()
  const result = await verifyCode(trimmed, { endpoint: props.endpoint, deviceId })
  busy.value = false
  if (!result.ok) {
    errorMessage.value = ERROR_MESSAGES[result.reason] ?? ERROR_MESSAGES.server
    return
  }
  saveAccess({ granted: true, code: trimmed, deviceId, grantedAt: Date.now() })
  emit('granted')
}
</script>

<template>
  <main class="access-gate" data-testid="access-gate" :data-mode="mode">
    <section class="gate-card" aria-labelledby="gate-title">
      <h1 id="gate-title">片手タイピング</h1>

      <template v-if="mode === 'need-standalone'">
        <p class="gate-lead">ホーム画面に追加してから、アイコンを開いて使います。</p>
        <ol class="gate-steps" data-testid="install-steps">
          <li>画面の下(または上)にある「共有」ボタン(四角から矢印が出るマーク)をタップ</li>
          <li>「ホーム画面に追加」をタップして、追加</li>
          <li>ホーム画面にできたアイコンから、もう一度開く</li>
        </ol>
        <p class="gate-note">Safariで開いているときは、ここまでです。</p>
      </template>

      <form v-else class="gate-form" @submit.prevent="submit">
        <p class="gate-lead">最初の1回だけ、教えてもらったコードを入力してください。</p>
        <label class="gate-label" for="access-code">コード</label>
        <input
          id="access-code"
          v-model="code"
          class="gate-input"
          data-testid="access-code"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck="false"
          :disabled="busy"
          :aria-invalid="errorMessage ? 'true' : 'false'"
          aria-describedby="gate-error gate-privacy"
        />
        <button class="gate-button" type="submit" data-testid="access-submit" :disabled="busy || !code.trim()">
          {{ busy ? '確認中…' : '使いはじめる' }}
        </button>
        <p id="gate-error" class="gate-error" role="alert" data-testid="access-error">{{ errorMessage }}</p>
        <p id="gate-privacy" class="gate-note">
          練習情報(日時・手・レベル・出題・所要時間・ミスしたキー)が記録されます。
        </p>
      </form>
    </section>
  </main>
</template>
