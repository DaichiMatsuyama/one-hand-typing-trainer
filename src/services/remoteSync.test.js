import { describe, expect, it, vi } from 'vitest'
import { buildCompletionRecord } from './completionRecord.js'
import { MAX_OUTBOX, OUTBOX_KEY, SEND_BATCH, createRemoteSync, loadOutbox } from './remoteSync.js'

const ENDPOINT = 'https://script.google.com/macros/s/test/exec'
const access = { granted: true, code: 'code-1', deviceId: 'dev-1', grantedAt: 1 }

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

const ok = () => ({ ok: true, json: async () => ({ ok: true }) })
const rec = (id) => ({ id, ts: 't', hand: 'left', level: 1, question: 'a' })

function setup(overrides = {}) {
  const storage = memoryStorage()
  const fetchImpl = overrides.fetchImpl ?? vi.fn().mockResolvedValue(ok())
  const sync = createRemoteSync({
    endpoint: ENDPOINT,
    storage,
    fetchImpl,
    getAccess: () => access,
    win: null,
    ...overrides,
  })
  return { storage, fetchImpl, sync }
}

describe('remoteSync', () => {
  it('送信先が未設定、またはコード未入力なら何も送らず、キューにも溜めない', async () => {
    const noEndpoint = setup({ endpoint: '' })
    expect(await noEndpoint.sync.recordCompletion(rec('a'))).toBe(false)
    expect(noEndpoint.fetchImpl).not.toHaveBeenCalled()
    expect(loadOutbox(noEndpoint.storage)).toEqual([])

    const noAccess = setup({ getAccess: () => null })
    expect(await noAccess.sync.recordCompletion(rec('a'))).toBe(false)
    expect(noAccess.fetchImpl).not.toHaveBeenCalled()
  })

  it('記録を送り、成功したらキューから消える(コードと端末IDを添える)', async () => {
    const { sync, fetchImpl, storage } = setup()
    await sync.recordCompletion(rec('a'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.headers).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ action: 'log', code: 'code-1', deviceId: 'dev-1', records: [rec('a')] })
    expect(loadOutbox(storage)).toEqual([])
  })

  it('通信失敗・サーバー異常ではキューに残し、次の機会に再送して一度だけ届く', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValue(ok())
    const { sync, storage } = setup({ fetchImpl })
    await sync.recordCompletion(rec('a'))
    expect(loadOutbox(storage).map((r) => r.id)).toEqual(['a'])
    await sync.flushPending()
    expect(loadOutbox(storage).map((r) => r.id)).toEqual(['a'])
    await sync.flushPending()
    expect(loadOutbox(storage)).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('SEND_BATCH件ずつに分けて送る', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(ok())
    const { sync, storage } = setup({ fetchImpl })
    const total = SEND_BATCH * 2 + 5
    for (let i = 0; i < total; i += 1) {
      // 最初の1回の失敗でキューに溜め、そのあとまとめて送る
      await sync.recordCompletion(rec(`r${i}`))
      if (i === 0) expect(loadOutbox(storage)).toHaveLength(1)
    }
    await sync.flushPending()
    const sizes = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).records.length)
    expect(sizes.every((size) => size <= SEND_BATCH)).toBe(true)
    expect(loadOutbox(storage)).toEqual([])
  })

  it('コードが拒否されたら、そのセッション中は再送せずキューを残す', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: 'invalid' }) })
    const { sync, storage } = setup({ fetchImpl })
    await sync.recordCompletion(rec('a'))
    await sync.flushPending()
    await sync.recordCompletion(rec('b'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(loadOutbox(storage).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('キューは最大件数で古いものから捨てる', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'))
    const { sync, storage } = setup({ fetchImpl })
    for (let i = 0; i < MAX_OUTBOX + 10; i += 1) await sync.recordCompletion(rec(`r${i}`))
    const queue = loadOutbox(storage)
    expect(queue).toHaveLength(MAX_OUTBOX)
    expect(queue[0].id).toBe('r10')
  })

  it('送信中に追加された記録を失わない', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const fetchImpl = vi.fn()
      .mockImplementationOnce(async () => { await gate; return ok() })
      .mockResolvedValue(ok())
    const { sync, storage } = setup({ fetchImpl })
    const first = sync.recordCompletion(rec('a'))
    await Promise.resolve()
    // 送信待ちの間に次のクリアが記録される(並行flushはスキップされ、キューには残る)
    const secondQueued = sync.recordCompletion(rec('b'))
    release()
    await first
    await secondQueued
    await sync.flushPending()
    expect(loadOutbox(storage)).toEqual([])
    const sentIds = fetchImpl.mock.calls.flatMap(([, init]) => JSON.parse(init.body).records.map((r) => r.id))
    expect(sentIds).toContain('a')
    expect(sentIds).toContain('b')
  })

  it('壊れた保存値のキューは空として扱う', () => {
    const storage = memoryStorage()
    storage.setItem(OUTBOX_KEY, '{oops')
    expect(loadOutbox(storage)).toEqual([])
    storage.setItem(OUTBOX_KEY, JSON.stringify([1, null, { id: 'x' }, { noId: true }]))
    expect(loadOutbox(storage).map((r) => r.id)).toEqual(['x'])
  })

  it('start()でオンライン復帰・画面再表示時に再送し、停止で解除される', async () => {
    const listeners = {}
    const docListeners = {}
    const win = {
      addEventListener: (type, fn) => { listeners[type] = fn },
      removeEventListener: (type) => { delete listeners[type] },
      document: {
        hidden: false,
        addEventListener: (type, fn) => { docListeners[type] = fn },
        removeEventListener: (type) => { delete docListeners[type] },
      },
    }
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(ok())
    const { sync, storage } = setup({ fetchImpl, win })
    await sync.recordCompletion(rec('a'))
    const stop = sync.start()
    expect(typeof listeners.online).toBe('function')
    await listeners.online()
    await vi.waitFor(() => expect(loadOutbox(storage)).toEqual([]))
    stop()
    expect(listeners.online).toBeUndefined()
    expect(docListeners.visibilitychange).toBeUndefined()
  })
})

describe('buildCompletionRecord', () => {
  it('練習内容だけを含む記録を作る(位置・個人情報なし)', () => {
    const record = buildCompletionRecord({
      session: { question: 'jk@', elapsedMs: 4321.6, attempts: 5, mistakes: 2 },
      settings: { hand: 'right', level: 2, includeSymbols: true, layoutVariant: 'jis' },
      wrongKeys: [['k', 'l'], ['@', 'p']],
      now: Date.UTC(2026, 10, 3, 3, 0, 0),
      id: 'rec-1',
    })
    expect(record).toEqual({
      id: 'rec-1',
      ts: '2026-11-03T03:00:00.000Z',
      hand: 'right',
      level: 2,
      includeSymbols: true,
      layout: 'jis',
      question: 'jk@',
      durationMs: 4322,
      attempts: 5,
      mistakes: 2,
      wrong: [['k', 'l'], ['@', 'p']],
    })
  })

  it('押し間違いは50件までに制限し、毎回異なるidを付ける', () => {
    const session = { question: 'a', elapsedMs: 1, attempts: 1, mistakes: 0 }
    const settings = { hand: 'left', level: 1, includeSymbols: false, layoutVariant: 'jis' }
    const wrongKeys = Array.from({ length: 80 }, () => ['a', 's'])
    const first = buildCompletionRecord({ session, settings, wrongKeys })
    const second = buildCompletionRecord({ session, settings })
    expect(first.wrong).toHaveLength(50)
    expect(first.id).not.toBe(second.id)
  })
})
