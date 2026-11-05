import { describe, expect, it, vi } from 'vitest'
import { buildCompletionRecord } from './completionRecord.js'
import {
  MAX_OUTBOX,
  MAX_RUN_REJECTED,
  MAX_RUN_OUTBOX,
  OUTBOX_KEY,
  RUN_OUTBOX_KEY,
  RUN_REJECTED_KEY,
  SEND_BATCH,
  createRemoteSync,
  loadOutbox,
  loadRejectedRuns,
  loadRunOutbox,
} from './remoteSync.js'

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
const runRec = (id) => ({ id, ts: 't', mode: 'free', hand: 'left', level: 1, attempts: 1 })

function setup(overrides = {}) {
  const storage = overrides.storage ?? memoryStorage()
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
    expect(await noEndpoint.sync.recordRun(runRec('run-a'))).toBe(false)
    expect(noEndpoint.fetchImpl).not.toHaveBeenCalled()
    expect(loadOutbox(noEndpoint.storage)).toEqual([])
    expect(loadRunOutbox(noEndpoint.storage)).toEqual([])

    const noAccess = setup({ getAccess: () => null })
    expect(await noAccess.sync.recordCompletion(rec('a'))).toBe(false)
    expect(await noAccess.sync.recordRun(runRec('run-a'))).toBe(false)
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

  it('run記録をlog_runとして送り、成功したら第2キューから消える', async () => {
    const { sync, fetchImpl, storage } = setup()
    await sync.recordRun(runRec('run-a'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body).toEqual({
      action: 'log_run', code: 'code-1', deviceId: 'dev-1', records: [runRec('run-a')],
    })
    expect(loadRunOutbox(storage)).toEqual([])
  })

  it('ホームポジション確認の項目を欠かさずlog_runの本文に載せる', async () => {
    const { sync, fetchImpl } = setup()
    const record = {
      ...runRec('run-hp'),
      homePosition: true,
      hpSuccessCount: 9,
      hpSkipCount: 1,
      hpAvgReturnMs: 1200,
      hpMinReturnMs: 800,
    }
    await sync.recordRun(record)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).records[0]).toMatchObject({
      homePosition: true, hpSuccessCount: 9, hpSkipCount: 1, hpAvgReturnMs: 1200, hpMinReturnMs: 800,
    })
  })

  it('runの通信失敗では第2キューに残し、次の契機で再送する', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue(ok())
    const { sync, storage } = setup({ fetchImpl })
    await sync.recordRun(runRec('run-a'))
    expect(loadRunOutbox(storage).map(({ id }) => id)).toEqual(['run-a'])
    await sync.flushPending()
    expect(loadRunOutbox(storage)).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('2つのキューを1バッチずつ交互に送る', async () => {
    const { sync, fetchImpl, storage } = setup()
    const completions = Array.from({ length: SEND_BATCH + 1 }, (_, index) => rec(`q-${index}`))
    const runs = Array.from({ length: SEND_BATCH + 2 }, (_, index) => runRec(`run-${index}`))
    storage.setItem(OUTBOX_KEY, JSON.stringify(completions))
    storage.setItem(RUN_OUTBOX_KEY, JSON.stringify(runs))

    await sync.flushPending()

    const bodies = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body))
    expect(bodies.map(({ action }) => action)).toEqual(['log', 'log_run', 'log', 'log_run'])
    expect(bodies.map(({ records }) => records.length)).toEqual([20, 20, 1, 2])
    expect(loadOutbox(storage)).toEqual([])
    expect(loadRunOutbox(storage)).toEqual([])
  })

  it('1問キューが応答中に増え続けてもrunキューを先に1バッチ送る', async () => {
    const storage = memoryStorage()
    let logCalls = 0
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.action === 'log') {
        logCalls += 1
        if (logCalls === 3) return { ok: false, json: async () => ({}) }
        const queue = loadOutbox(storage)
        queue.push(rec(`during-${logCalls}`))
        storage.setItem(OUTBOX_KEY, JSON.stringify(queue))
      }
      return ok()
    })
    const { sync } = setup({ storage, fetchImpl })
    storage.setItem(OUTBOX_KEY, JSON.stringify(
      Array.from({ length: SEND_BATCH }, (_, index) => rec(`q-${index}`)),
    ))
    storage.setItem(RUN_OUTBOX_KEY, JSON.stringify([runRec('run-important')]))

    await sync.flushPending()

    const actions = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).action)
    expect(actions.slice(0, 2)).toEqual(['log', 'log_run'])
    expect(loadRunOutbox(storage)).toEqual([])
  })

  it('GASが拒否したrunだけを隔離してキューから除き、他と重複済みは従来どおり除く', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, saved: 1, rejected: 1, rejectedIds: ['run-bad'] }),
    })
    const { sync, storage } = setup({ fetchImpl, getNow: () => Date.UTC(2026, 10, 5, 3) })
    const records = [runRec('run-saved'), runRec('run-bad'), runRec('run-duplicate')]
    storage.setItem(RUN_OUTBOX_KEY, JSON.stringify(records))

    await sync.flushPending()

    expect(loadRunOutbox(storage)).toEqual([])
    expect(loadRejectedRuns(storage)).toEqual([{
      id: 'run-bad',
      rejectedAt: '2026-11-05T03:00:00.000Z',
      record: runRec('run-bad'),
    }])
  })

  it('隔離runは新しい順で最大20件に保つ', async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body)
      return {
        ok: true,
        json: async () => ({
          ok: true,
          saved: 0,
          rejected: body.records.length,
          rejectedIds: body.records.map(({ id }) => id),
        }),
      }
    })
    const { sync, storage } = setup({ fetchImpl, getNow: () => Date.UTC(2026, 10, 5, 3) })
    const records = Array.from({ length: MAX_RUN_REJECTED + 2 }, (_, index) => runRec(`run-${index}`))
    storage.setItem(RUN_OUTBOX_KEY, JSON.stringify(records))

    await sync.flushPending()

    expect(loadRejectedRuns(storage).map(({ id }) => id)).toEqual(
      Array.from({ length: MAX_RUN_REJECTED }, (_, index) => `run-${MAX_RUN_REJECTED + 1 - index}`),
    )
  })

  it('隔離キーへの保存に失敗したrunはキューから黙って消さない', async () => {
    const base = memoryStorage()
    const storage = {
      getItem: base.getItem,
      setItem: (key, value) => {
        if (key === RUN_REJECTED_KEY) throw new Error('quota exceeded')
        base.setItem(key, value)
      },
    }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, saved: 0, rejected: 1, rejectedIds: ['run-bad'] }),
    })
    const { sync } = setup({ storage, fetchImpl })
    storage.setItem(RUN_OUTBOX_KEY, JSON.stringify([runRec('run-bad')]))

    await sync.flushPending()

    expect(loadRunOutbox(storage).map(({ id }) => id)).toEqual(['run-bad'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('1問ごとのlogではrejectedIdsを隔離に使わず従来どおり成功扱いにする', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, saved: 0, rejected: 1, rejectedIds: ['q-a'] }),
    })
    const { sync, storage } = setup({ fetchImpl })
    storage.setItem(OUTBOX_KEY, JSON.stringify([rec('q-a')]))

    await sync.flushPending()

    expect(loadOutbox(storage)).toEqual([])
    expect(storage.getItem(RUN_REJECTED_KEY)).toBeNull()
  })

  it('sheet_header_mismatchは一時エラーとしてrunキューを残して再送する', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ ok: false, error: 'sheet_header_mismatch' }),
      })
      .mockResolvedValue(ok())
    const { sync, storage } = setup({ fetchImpl })

    await sync.recordRun(runRec('run-a'))
    expect(loadRunOutbox(storage).map(({ id }) => id)).toEqual(['run-a'])
    expect(loadRejectedRuns(storage)).toEqual([])
    await sync.flushPending()
    expect(loadRunOutbox(storage)).toEqual([])
  })

  it('どちらかのコードがrejectedになったら両キューの再送をそのセッション中止める', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: 'invalid' }) })
    const { sync, storage } = setup({ fetchImpl })
    storage.setItem(OUTBOX_KEY, JSON.stringify([rec('q-a')]))
    storage.setItem(RUN_OUTBOX_KEY, JSON.stringify([runRec('run-a')]))

    await sync.flushPending()
    await sync.flushPending()
    await sync.recordRun(runRec('run-b'))

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(loadOutbox(storage).map(({ id }) => id)).toEqual(['q-a'])
    expect(loadRunOutbox(storage).map(({ id }) => id)).toEqual(['run-a', 'run-b'])
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

  it('lockedは一時エラーとしてキューを残し、次の契機で再送する', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false, error: 'locked' }) })
      .mockResolvedValue(ok())
    const { sync, storage } = setup({ fetchImpl })

    await sync.recordCompletion(rec('a'))
    expect(loadOutbox(storage).map((r) => r.id)).toEqual(['a'])
    await sync.flushPending()

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(loadOutbox(storage)).toEqual([])
  })

  it('キューは最大件数で古いものから捨てる', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'))
    const { sync, storage } = setup({ fetchImpl })
    for (let i = 0; i < MAX_OUTBOX + 10; i += 1) await sync.recordCompletion(rec(`r${i}`))
    const queue = loadOutbox(storage)
    expect(queue).toHaveLength(MAX_OUTBOX)
    expect(queue[0].id).toBe('r10')
  })

  it('runキューは100件を上限に古いものから捨てる', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('offline'))
    const { sync, storage } = setup({ fetchImpl })
    for (let i = 0; i < MAX_RUN_OUTBOX + 10; i += 1) await sync.recordRun(runRec(`run-${i}`))
    const queue = loadRunOutbox(storage)
    expect(queue).toHaveLength(MAX_RUN_OUTBOX)
    expect(queue[0].id).toBe('run-10')
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
    // 送信待ちの間に次のクリアが記録される(並行flushは同じPromiseを待ち、キューも処理する)
    const secondQueued = sync.recordCompletion(rec('b'))
    release()
    await first
    await secondQueued
    // 追加のflushに頼らず、共有しているdrainの完了時点でBも送信済みであること
    expect(loadOutbox(storage)).toEqual([])
    const sentIds = fetchImpl.mock.calls.flatMap(([, init]) => JSON.parse(init.body).records.map((r) => r.id))
    expect(sentIds).toContain('a')
    expect(sentIds).toContain('b')
  })

  it('1問の送信中に追加されたrunも共有Promise内で続けて送る', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const fetchImpl = vi.fn()
      .mockImplementationOnce(async () => { await gate; return ok() })
      .mockResolvedValue(ok())
    const { sync, storage } = setup({ fetchImpl })
    const completion = sync.recordCompletion(rec('q-a'))
    await Promise.resolve()
    const run = sync.recordRun(runRec('run-a'))
    release()
    await Promise.all([completion, run])

    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).action)).toEqual(['log', 'log_run'])
    expect(loadOutbox(storage)).toEqual([])
    expect(loadRunOutbox(storage)).toEqual([])
  })

  it('送信中のflushPendingを再度呼ぶと、二重送信せず同じ完了を待つ', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const fetchImpl = vi.fn(async () => {
      await gate
      return ok()
    })
    const { sync, storage } = setup({ fetchImpl })

    const sending = sync.recordCompletion(rec('a'))
    await Promise.resolve()
    const waiting = sync.flushPending()
    let finished = false
    waiting.then(() => { finished = true })
    await Promise.resolve()

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(finished).toBe(false)
    release()
    await Promise.all([sending, waiting])
    expect(finished).toBe(true)
    expect(loadOutbox(storage)).toEqual([])
  })

  it('空のflushが完了したあとに追加された記録も送る', async () => {
    const { sync, fetchImpl, storage } = setup()
    await sync.flushPending()
    await sync.recordCompletion(rec('later'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(loadOutbox(storage)).toEqual([])
  })

  it('空のflush直後にawaitせず追加した記録も、共有Promiseの完了までに送る', async () => {
    const { sync, fetchImpl, storage } = setup()
    const flushing = sync.flushPending()
    const recording = sync.recordCompletion(rec('later'))

    await Promise.all([flushing, recording])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(loadOutbox(storage)).toEqual([])
  })

  it('壊れた保存値のキューは空として扱う', () => {
    const storage = memoryStorage()
    storage.setItem(OUTBOX_KEY, '{oops')
    expect(loadOutbox(storage)).toEqual([])
    storage.setItem(OUTBOX_KEY, JSON.stringify([1, null, { id: 'x' }, { noId: true }]))
    expect(loadOutbox(storage).map((r) => r.id)).toEqual(['x'])
    storage.setItem(RUN_OUTBOX_KEY, '{oops')
    expect(loadRunOutbox(storage)).toEqual([])
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
