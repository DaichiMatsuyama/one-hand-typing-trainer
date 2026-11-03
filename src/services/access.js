export const ACCESS_KEY = 'one-hand-typing-trainer:access:v1'

const VERIFY_TIMEOUT_MS = 10_000

export function isLocalDevHost(hostname = '') {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname) || hostname.endsWith('.localhost')
}

export function isStandaloneDisplay(win = globalThis.window) {
  if (!win) return false
  return Boolean(win.navigator?.standalone)
    || (typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches)
}

export function createDeviceId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function loadAccess(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(ACCESS_KEY) ?? 'null')
    if (!parsed || parsed.granted !== true) return null
    if (typeof parsed.code !== 'string' || parsed.code.length === 0) return null
    if (typeof parsed.deviceId !== 'string' || parsed.deviceId.length === 0) return null
    return { granted: true, code: parsed.code, deviceId: parsed.deviceId, grantedAt: Number(parsed.grantedAt) || 0 }
  } catch {
    return null
  }
}

export function saveAccess(access, storage = globalThis.localStorage) {
  try {
    storage?.setItem(ACCESS_KEY, JSON.stringify(access))
    return true
  } catch {
    return false
  }
}

/**
 * 利用条件の判定。'open'=使える / 'need-standalone'=ホーム画面から開く必要あり / 'need-code'=初回コード入力が必要。
 * 送信先未設定、またはローカル開発環境(?forceGate=1で強制)では制限しない。
 */
export function evaluateGate({ endpoint, hostname, search = '', standalone, access }) {
  if (!endpoint) return 'open'
  if (isLocalDevHost(hostname) && !/[?&]forceGate=1(?:&|$)/.test(search)) return 'open'
  if (!standalone) return 'need-standalone'
  if (!access?.granted) return 'need-code'
  return 'open'
}

/**
 * アクセスコードをGAS側で確認する。
 * 戻り値: { ok: true } | { ok: false, reason: 'invalid' | 'locked' | 'network' | 'server' }
 * Content-Typeを指定しない(text/plain)ことで、CORSのプリフライトを避ける。
 */
export async function verifyCode(code, { endpoint, deviceId, fetchImpl = globalThis.fetch } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timeout = controller ? setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS) : null
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      body: JSON.stringify({ action: 'verify', code, deviceId }),
      redirect: 'follow',
      signal: controller?.signal,
    })
    if (!response.ok) return { ok: false, reason: 'server' }
    const data = await response.json()
    if (data?.ok === true) return { ok: true }
    if (data?.error === 'invalid') return { ok: false, reason: 'invalid' }
    if (data?.error === 'locked') return { ok: false, reason: 'locked' }
    return { ok: false, reason: 'server' }
  } catch {
    return { ok: false, reason: 'network' }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
