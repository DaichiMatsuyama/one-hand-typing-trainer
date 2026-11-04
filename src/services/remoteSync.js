import { REMOTE_ENDPOINT } from '../remoteConfig.js'
import { loadAccess } from './access.js'

export const OUTBOX_KEY = 'one-hand-typing-trainer:outbox:v1'
export const MAX_OUTBOX = 300
export const SEND_BATCH = 20
const SEND_TIMEOUT_MS = 15_000

export function loadOutbox(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(OUTBOX_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && typeof item.id === 'string') : []
  } catch {
    return []
  }
}

function saveOutbox(records, storage) {
  try {
    storage?.setItem(OUTBOX_KEY, JSON.stringify(records))
  } catch {
    // 保存に失敗しても練習は止めない
  }
}

/**
 * 練習記録の送信。練習の邪魔にならないよう、すべて失敗を握りつぶし、
 * 未送信分はlocalStorageのキューに残して、起動時・オンライン復帰時・次の記録時に再送する。
 */
export function createRemoteSync({
  endpoint = REMOTE_ENDPOINT,
  storage = globalThis.localStorage,
  fetchImpl = (...args) => globalThis.fetch(...args),
  getAccess = () => loadAccess(storage),
  win = globalThis.window,
} = {}) {
  let flushPromise = null
  // コードが拒否されたら、そのセッション中は再送を試みない(キューは残す)
  let rejected = false

  const isEnabled = () => Boolean(endpoint) && Boolean(getAccess())

  async function postBatch(batch, access) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timeout = controller ? setTimeout(() => controller.abort(), SEND_TIMEOUT_MS) : null
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        body: JSON.stringify({ action: 'log', code: access.code, deviceId: access.deviceId, records: batch }),
        redirect: 'follow',
        signal: controller?.signal,
      })
      if (!response.ok) return 'error'
      const data = await response.json()
      if (data?.ok === true) return 'ok'
      if (data?.error === 'invalid') return 'rejected'
      if (data?.error === 'locked') return 'error'
      return 'error'
    } catch {
      return 'error'
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  function flushPending() {
    if (!isEnabled() || rejected) {
      return Promise.resolve({ sent: 0, remaining: loadOutbox(storage).length })
    }
    // 送信中の呼び出し元も同じ処理の完了を待てるようにする。新しい送信は開始しない。
    if (flushPromise) return flushPromise
    const access = getAccess()
    const pending = (async () => {
      // 空キューでもIIFEを同期完了させず、先にflushPromiseへ共有Promiseを設定する。
      await Promise.resolve()
      let sent = 0
      try {
        for (;;) {
          const queue = loadOutbox(storage)
          if (queue.length === 0) break
          const batch = queue.slice(0, SEND_BATCH)
          const result = await postBatch(batch, access)
          if (result === 'rejected') {
            rejected = true
            break
          }
          if (result !== 'ok') break
          // 送信中に追加された記録を失わないよう、最新のキューから送信済みIDだけを除く
          const sentIds = new Set(batch.map((item) => item.id))
          saveOutbox(loadOutbox(storage).filter((item) => !sentIds.has(item.id)), storage)
          sent += batch.length
        }
        return { sent, remaining: loadOutbox(storage).length }
      } finally {
        // キューの終了判定からここまではawaitを挟まない。直後の記録は新しいdrainを開始できる。
        if (flushPromise === pending) flushPromise = null
      }
    })()
    flushPromise = pending
    return flushPromise
  }

  async function recordCompletion(record) {
    if (!isEnabled()) return false
    const queue = loadOutbox(storage)
    queue.push(record)
    saveOutbox(queue.slice(-MAX_OUTBOX), storage)
    await flushPending()
    return true
  }

  function start() {
    if (!win) return () => {}
    const onOnline = () => { flushPending() }
    const onVisible = () => {
      if (!win.document?.hidden) flushPending()
    }
    win.addEventListener('online', onOnline)
    win.document?.addEventListener('visibilitychange', onVisible)
    flushPending()
    return () => {
      win.removeEventListener('online', onOnline)
      win.document?.removeEventListener('visibilitychange', onVisible)
    }
  }

  return { isEnabled, flushPending, recordCompletion, start }
}

export const remoteSync = createRemoteSync()
