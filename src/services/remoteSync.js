import { REMOTE_ENDPOINT } from '../remoteConfig.js'
import { loadAccess } from './access.js'

export const OUTBOX_KEY = 'one-hand-typing-trainer:outbox:v1'
export const MAX_OUTBOX = 300
export const RUN_OUTBOX_KEY = 'one-hand-typing-trainer:run-outbox:v1'
export const MAX_RUN_OUTBOX = 100
export const RUN_REJECTED_KEY = 'one-hand-typing-trainer:run-rejected:v1'
export const MAX_RUN_REJECTED = 20
export const SEND_BATCH = 20
const SEND_TIMEOUT_MS = 15_000

function loadQueue(key, storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === 'object' && typeof item.id === 'string') : []
  } catch {
    return []
  }
}

export function loadOutbox(storage = globalThis.localStorage) {
  return loadQueue(OUTBOX_KEY, storage)
}

export function loadRunOutbox(storage = globalThis.localStorage) {
  return loadQueue(RUN_OUTBOX_KEY, storage)
}

export function loadRejectedRuns(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(RUN_REJECTED_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item === 'object'
        && typeof item.id === 'string' && typeof item.rejectedAt === 'string'
        && item.record && typeof item.record === 'object')
      : []
  } catch {
    return []
  }
}

function saveQueue(key, records, storage) {
  try {
    storage?.setItem(key, JSON.stringify(records))
    return true
  } catch {
    // 保存に失敗しても練習は止めない
    return false
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
  getNow = () => Date.now(),
} = {}) {
  let flushPromise = null
  // コードが拒否されたら、そのセッション中は再送を試みない(キューは残す)
  let rejected = false

  const isEnabled = () => Boolean(endpoint) && Boolean(getAccess())

  async function postBatch(action, batch, access) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timeout = controller ? setTimeout(() => controller.abort(), SEND_TIMEOUT_MS) : null
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        body: JSON.stringify({ action, code: access.code, deviceId: access.deviceId, records: batch }),
        redirect: 'follow',
        signal: controller?.signal,
      })
      if (!response.ok) return { status: 'error', rejectedIds: [] }
      const data = await response.json()
      if (data?.ok === true) {
        return {
          status: 'ok',
          rejectedIds: action === 'log_run' && Array.isArray(data.rejectedIds)
            ? data.rejectedIds.filter((id) => typeof id === 'string').slice(0, MAX_RUN_REJECTED)
            : [],
        }
      }
      if (data?.error === 'invalid') return { status: 'rejected', rejectedIds: [] }
      return { status: 'error', rejectedIds: [] }
    } catch {
      return { status: 'error', rejectedIds: [] }
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  function quarantineRejected(batch, rejectedIds) {
    const ids = new Set(rejectedIds)
    if (ids.size === 0) return ids
    const existing = loadRejectedRuns(storage)
    const rejectedAt = new Date(getNow()).toISOString()
    const newEntries = []
    const added = new Set()
    batch.forEach((record) => {
      if (ids.has(record.id) && !added.has(record.id)) {
        newEntries.unshift({ id: record.id, rejectedAt, record })
        added.add(record.id)
      }
    })
    const next = [
      ...newEntries,
      ...existing.filter((item) => !added.has(item.id)),
    ].slice(0, MAX_RUN_REJECTED)
    return saveQueue(RUN_REJECTED_KEY, next, storage) ? added : new Set()
  }

  function flushPending() {
    if (!isEnabled() || rejected) {
      return Promise.resolve({
        sent: 0,
        remaining: loadOutbox(storage).length,
        runSent: 0,
        runRemaining: loadRunOutbox(storage).length,
      })
    }
    // 送信中の呼び出し元も同じ処理の完了を待てるようにする。新しい送信は開始しない。
    if (flushPromise) return flushPromise
    const access = getAccess()
    const pending = (async () => {
      // 空キューでもIIFEを同期完了させず、先にflushPromiseへ共有Promiseを設定する。
      await Promise.resolve()
      let sent = 0
      let runSent = 0
      try {
        const drains = [
          { action: 'log', load: loadOutbox, key: OUTBOX_KEY, count: (amount) => { sent += amount } },
          { action: 'log_run', load: loadRunOutbox, key: RUN_OUTBOX_KEY, count: (amount) => { runSent += amount } },
        ]
        // localStorageへの反映に失敗しても、同じflush内では送信済みIDを再送しない。
        const sentIds = new Map(drains.map((drain) => [drain.action, new Set()]))
        let stopped = false
        for (;;) {
          let processed = false
          for (const drain of drains) {
            const queue = drain.load(storage)
            if (queue.length === 0) continue
            const batch = queue
              .filter((item) => !sentIds.get(drain.action).has(item.id))
              .slice(0, SEND_BATCH)
            if (batch.length === 0) continue
            const result = await postBatch(drain.action, batch, access)
            if (result.status === 'rejected') rejected = true
            if (result.status !== 'ok') {
              stopped = true
              break
            }
            batch.forEach((item) => sentIds.get(drain.action).add(item.id))
            const rejectedIds = drain.action === 'log_run'
              ? new Set(result.rejectedIds.filter((id) => batch.some((item) => item.id === id)))
              : new Set()
            const quarantinedIds = drain.action === 'log_run'
              ? quarantineRejected(batch, rejectedIds)
              : new Set()
            const quarantineFailed = rejectedIds.size > quarantinedIds.size
            // 送信中に追加された記録を失わないよう、最新キューからこのバッチだけを除く。
            // GASで拒否されたrunは、隔離保存に成功したものだけを除く。
            const removableIds = new Set(batch
              .filter((item) => !rejectedIds.has(item.id) || quarantinedIds.has(item.id))
              .map((item) => item.id))
            const queueSaved = saveQueue(
              drain.key,
              drain.load(storage).filter((item) => !removableIds.has(item.id)),
              storage,
            )
            drain.count(batch.length - rejectedIds.size)
            processed = true
            if (!queueSaved || quarantineFailed) {
              stopped = true
              break
            }
          }
          if (stopped || !processed
            || (loadOutbox(storage).length === 0 && loadRunOutbox(storage).length === 0)) break
        }
        return {
          sent,
          remaining: loadOutbox(storage).length,
          runSent,
          runRemaining: loadRunOutbox(storage).length,
        }
      } finally {
        // キューの終了判定からここまではawaitを挟まない。直後の記録は新しいdrainを開始できる。
        if (flushPromise === pending) flushPromise = null
      }
    })()
    flushPromise = pending
    return flushPromise
  }

  async function sendDirect(action, record) {
    if (rejected) return false
    const result = await postBatch(action, [record], getAccess())
    if (result.status === 'rejected') rejected = true
    if (result.status !== 'ok') return false
    return action !== 'log_run' || !result.rejectedIds.includes(record.id)
  }

  async function recordCompletion(record) {
    if (!isEnabled()) return false
    const queue = loadOutbox(storage)
    queue.push(record)
    if (!saveQueue(OUTBOX_KEY, queue.slice(-MAX_OUTBOX), storage)) {
      return sendDirect('log', record)
    }
    await flushPending()
    return true
  }

  async function recordRun(record) {
    if (!isEnabled()) return false
    const queue = loadRunOutbox(storage)
    queue.push(record)
    if (!saveQueue(RUN_OUTBOX_KEY, queue.slice(-MAX_RUN_OUTBOX), storage)) {
      return sendDirect('log_run', record)
    }
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

  return { isEnabled, flushPending, recordCompletion, recordRun, start }
}

export const remoteSync = createRemoteSync()
