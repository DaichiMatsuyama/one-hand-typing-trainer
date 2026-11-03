// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8')

// Apps Scriptのグローバル(PropertiesService等)を最小限に模擬して、Code.gsを実際に実行する
// 2026-11-03 21:00(日本時間)に固定する
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)

function createEnvironment({ accessCode = 'secret-code-123', adminCode = null } = {}) {
  const properties = accessCode ? { ACCESS_CODE: accessCode } : {}
  if (adminCode) properties.ADMIN_CODE = adminCode
  const cache = new Map()
  const sheetRows = []
  const calls = { tryLock: 0, waitLock: 0, lockReleased: 0 }
  let currentNow = NOW

  class FixedDate extends Date {
    constructor(...args) {
      if (args.length) super(...args)
      else super(currentNow)
    }

    static now() { return currentNow }
  }

  const sheet = {
    getLastRow: () => sheetRows.length,
    getRange: (row, column, numRows, numColumns) => ({
      setValues: (values) => {
        values.forEach((value, index) => { sheetRows[row - 1 + index] = value })
        expect(column).toBe(1)
        expect(numColumns).toBe(values[0].length)
        expect(numRows).toBe(values.length)
      },
      getValues: () => sheetRows
        .slice(row - 1, row - 1 + numRows)
        .map((cells) => cells.slice(column - 1, column - 1 + numColumns)),
    }),
    setFrozenRows: () => {},
  }
  const spreadsheet = {
    getSheetByName: () => sheet,
    insertSheet: () => sheet,
  }

  const context = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] ?? null }) },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => cache.get(key) ?? null,
        put: (key, value) => { cache.set(key, value) },
        remove: (key) => { cache.delete(key) },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { calls.tryLock += 1; return true },
        waitLock: () => { calls.waitLock += 1 },
        releaseLock: () => { calls.lockReleased += 1 },
      }),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this } }),
    },
    JSON,
    Date: FixedDate,
    Object,
    Math,
    Number,
    String,
    Array,
    isFinite,
  }
  runInNewContext(source, context)
  const post = (body) => JSON.parse(context.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text)
  // 先頭(1行目)は見出し行。データは2行目から
  const dataRows = () => sheetRows.slice(1)
  const advanceTime = (ms) => { currentNow += ms }
  return { post, sheetRows, dataRows, calls, cache, advanceTime }
}

const record = (overrides = {}) => ({
  id: 'rec-0001',
  ts: '2026-11-03T03:00:00.000Z',
  hand: 'right',
  level: 2,
  includeSymbols: true,
  layout: 'jis',
  question: 'jk@l',
  durationMs: 4200,
  attempts: 5,
  mistakes: 1,
  wrong: [['k', 'l']],
  ...overrides,
})

describe('Code.gs', () => {
  let env
  beforeEach(() => {
    env = createEnvironment()
  })

  it('正しいコードならverifyが成功し、間違いはinvalidになる', () => {
    expect(env.post({ action: 'verify', code: 'secret-code-123' })).toEqual({ ok: true })
    expect(env.post({ action: 'verify', code: 'wrong' })).toEqual({ ok: false, error: 'invalid' })
    expect(env.post({ action: 'verify' })).toEqual({ ok: false, error: 'invalid' })
  })

  it('壊れた本文・null・配列・未知のactionは拒否する', () => {
    expect(env.post('not json')).toEqual({ ok: false, error: 'bad_request' })
    expect(env.post(null)).toEqual({ ok: false, error: 'bad_request' })
    expect(env.post([])).toEqual({ ok: false, error: 'bad_request' })
    expect(env.post({ action: 'nope', code: 'secret-code-123' })).toEqual({ ok: false, error: 'bad_request' })
  })

  it('ACCESS_CODE未設定ならnot_configured(誰も通さない)', () => {
    const unconfigured = createEnvironment({ accessCode: '' })
    expect(unconfigured.post({ action: 'verify', code: '' })).toEqual({ ok: false, error: 'not_configured' })
  })

  it('間違いが続くと、正しいコードでも一時的にlockedになる', () => {
    for (let i = 0; i < 30; i += 1) env.post({ action: 'verify', code: `bad${i}` })
    expect(env.post({ action: 'verify', code: 'secret-code-123' })).toEqual({ ok: false, error: 'locked' })
  })

  it('失敗回数は固定5分窓で期限切れになり、成功時にもリセットされる', () => {
    for (let i = 0; i < 30; i += 1) env.post({ action: 'verify', code: `expired${i}` })
    env.advanceTime(300_001)
    expect(env.post({ action: 'verify', code: 'secret-code-123' })).toEqual({ ok: true })

    for (let i = 0; i < 29; i += 1) env.post({ action: 'verify', code: `before${i}` })
    expect(env.post({ action: 'verify', code: 'secret-code-123' })).toEqual({ ok: true })
    for (let i = 0; i < 29; i += 1) env.post({ action: 'verify', code: `after${i}` })
    expect(env.post({ action: 'verify', code: 'secret-code-123' })).toEqual({ ok: true })
  })

  it('コードが違うlogは何も保存しない', () => {
    expect(env.post({ action: 'log', code: 'wrong', deviceId: 'dev-mine-01', records: [record()] })).toEqual({ ok: false, error: 'invalid' })
    expect(env.dataRows()).toHaveLength(0)
  })

  it('logで1問ごとに1行を追記し、列の並びが見出しと一致する', () => {
    const result = env.post({ action: 'log', code: 'secret-code-123', deviceId: 'dev-mine-01', records: [record()] })
    expect(result).toEqual({ ok: true, saved: 1, rejected: 0 })
    expect(env.sheetRows[0]).toHaveLength(13)
    expect(env.sheetRows[0][0]).toBe('receivedAt')
    const row = env.dataRows()[0]
    expect(row[0]).toBeInstanceOf(Date)
    expect(row.slice(1)).toEqual([
      'rec-0001', '2026-11-03T03:00:00.000Z', 'dev-mine-01', 'right', 2, true, 'jis', 'jk@l', 4200, 5, 1, '[["k","l"]]',
    ])
    expect(env.calls.waitLock).toBe(1)
  })

  it('同じidの再送は二重に追記しない', () => {
    const body = { action: 'log', code: 'secret-code-123', deviceId: 'dev-mine-01', records: [record()] }
    expect(env.post(body)).toEqual({ ok: true, saved: 1, rejected: 0 })
    expect(env.post(body)).toEqual({ ok: true, saved: 0, rejected: 0 })
    expect(env.dataRows()).toHaveLength(1)
  })

  it('同じバッチ内の重複と、シートに既にあるIDを追記しない', () => {
    const body = { action: 'log', code: 'secret-code-123', deviceId: 'dev-mine-01' }
    expect(env.post({ ...body, records: [record()] })).toEqual({ ok: true, saved: 1, rejected: 0 })
    expect(env.post({
      ...body,
      records: [record(), record({ id: 'rec-0002' }), record({ id: 'rec-0002' })],
    })).toEqual({ ok: true, saved: 1, rejected: 0 })
    expect(env.dataRows().map((row) => row[1])).toEqual(['rec-0001', 'rec-0002'])
  })

  it('不正なレコードだけを読み飛ばし、wrong内の不正要素は捨てる', () => {
    const valid = record({ wrong: [['k', 'l'], ['k'], ['k', 'LL'], 'x', ['@', ':']] })
    const invalid = [
      null,
      record({ id: 'short' }),
      record({ ts: '2019-12-31T23:59:59.000Z' }),
      record({ ts: '2026-11-04T12:00:01.000Z' }),
      record({ ts: 'not-a-date' }),
      record({ hand: 'both' }),
      record({ level: 1.5 }),
      record({ layout: 'dvorak' }),
      record({ includeSymbols: 'yes' }),
      record({ question: 'ABC' }),
      record({ durationMs: Infinity }),
      record({ attempts: 1.5 }),
      record({ attempts: 1, mistakes: 2 }),
      record({ wrong: Array.from({ length: 51 }, () => ['a', 's']) }),
    ]
    const result = env.post({
      action: 'log', code: 'secret-code-123', deviceId: 'dev-mine-01', records: [valid, ...invalid],
    })
    expect(result).toEqual({ ok: true, saved: 1, rejected: invalid.length })
    expect(env.dataRows()[0][12]).toBe('[["k","l"],["@",":"]]')
  })

  it('logのdeviceIdが不正ならリクエストを拒否する', () => {
    expect(env.post({ action: 'log', code: 'secret-code-123', deviceId: 'short', records: [record()] }))
      .toEqual({ ok: false, error: 'bad_request' })
  })

  it('1回の送信は50件までとし、超過分をrejectedに数える', () => {
    const records = Array.from({ length: 60 }, (_, index) => (
      record({ id: `rec-${String(index).padStart(4, '0')}` })
    ))
    expect(env.post({ action: 'log', code: 'secret-code-123', deviceId: 'dev-mine-01', records }))
      .toEqual({ ok: true, saved: 50, rejected: 10 })
    expect(env.dataRows()).toHaveLength(50)
  })
})

describe('Code.gs 成績の集計(振り返り画面用)', () => {
  const CODE = 'secret-code-123'
  const ADMIN = 'admin-code-456'
  let env

  const log = (deviceId, records) => env.post({ action: 'log', code: CODE, deviceId, records })
  const stats = (deviceId) => env.post({ action: 'stats', code: CODE, deviceId })
  const rec = (id, ts, overrides = {}) => record({ id: id.padEnd(8, '0'), ts, ...overrides })

  beforeEach(() => {
    env = createEnvironment({ adminCode: ADMIN })
  })

  it('アクセスコードが違う、またはdeviceIdが無いときは集計を返さない', () => {
    expect(env.post({ action: 'stats', code: 'wrong', deviceId: 'dev-mine-01' })).toEqual({ ok: false, error: 'invalid' })
    expect(env.post({ action: 'stats', code: CODE })).toEqual({ ok: false, error: 'bad_request' })
    expect(env.post({ action: 'stats', code: CODE, deviceId: 'short' })).toEqual({ ok: false, error: 'bad_request' })
  })

  it('記録が無い端末には、空の集計を返す', () => {
    const { ok, stats: result } = stats('dev-empty-01')
    expect(ok).toBe(true)
    expect(result.totals).toMatchObject({ records: 0, practiceMs: 0, days: 0, firstDate: null, lastDate: null })
    expect(result.streak).toBe(0)
    expect(result.daily).toHaveLength(14)
    expect(result.daily.every((day) => day.records === 0)).toBe(true)
    expect(result.keys).toEqual({})
    expect(result.confusions).toEqual([])
  })

  it('自分の端末の記録だけを集計し、他の端末は含めない', () => {
    log('dev-mine-01', [rec('a1', '2026-11-03T03:00:00.000Z'), rec('a2', '2026-11-03T03:05:00.000Z')])
    log('dev-other-01', [rec('b1', '2026-11-03T03:00:00.000Z')])
    expect(stats('dev-mine-01').stats.totals.records).toBe(2)
    expect(stats('dev-other-01').stats.totals.records).toBe(1)
  })

  it('日付は日本時間でまとめる(UTC 15:00 で日が変わる)', () => {
    log('dev-date-01', [
      rec('x1', '2026-11-02T14:59:59.000Z'), // 日本時間 11/2 23:59
      rec('x2', '2026-11-02T15:00:00.000Z'), // 日本時間 11/3 00:00
    ])
    const { daily, today } = stats('dev-date-01').stats
    expect(daily.at(-2)).toMatchObject({ date: '2026-11-02', records: 1 })
    expect(daily.at(-1)).toMatchObject({ date: '2026-11-03', records: 1 })
    expect(today.date).toBe('2026-11-03')
    expect(today.records).toBe(1)
  })

  it('直近14日を、練習しなかった日も0で埋めて古い順に返す', () => {
    log('dev-date-01', [rec('d1', '2026-10-30T03:00:00.000Z', { durationMs: 60000, attempts: 10, mistakes: 2 })])
    const { daily } = stats('dev-date-01').stats
    expect(daily).toHaveLength(14)
    expect(daily[0].date).toBe('2026-10-21')
    expect(daily.at(-1).date).toBe('2026-11-03')
    expect(daily.find((day) => day.date === '2026-10-30')).toEqual({
      date: '2026-10-30', records: 1, practiceMs: 60000, attempts: 10, mistakes: 2,
    })
    expect(daily.find((day) => day.date === '2026-10-31')).toEqual({
      date: '2026-10-31', records: 0, practiceMs: 0, attempts: 0, mistakes: 0,
    })
  })

  it('合計(練習時間・日数・最初と最後の日)を数える', () => {
    log('dev-mine-01', [
      rec('t1', '2026-10-28T03:00:00.000Z', { durationMs: 1000, attempts: 4, mistakes: 1 }),
      rec('t2', '2026-11-03T03:00:00.000Z', { durationMs: 2000, attempts: 6, mistakes: 0 }),
    ])
    expect(stats('dev-mine-01').stats.totals).toEqual({
      records: 2, practiceMs: 3000, attempts: 10, mistakes: 1, days: 2, firstDate: '2026-10-28', lastDate: '2026-11-03',
    })
  })

  it('キーごとの出題回数とミス回数、取り違えの多い順を返す', () => {
    log('dev-mine-01', [
      rec('k1', '2026-11-03T03:00:00.000Z', { question: 'jkl', mistakes: 2, wrong: [['k', 'l'], ['k', 'l']] }),
      rec('k2', '2026-11-03T03:01:00.000Z', { question: 'kj', mistakes: 1, wrong: [['j', 'h']] }),
    ])
    const { keys, confusions } = stats('dev-mine-01').stats
    expect(keys.k).toEqual({ shown: 2, misses: 2 })
    expect(keys.j).toEqual({ shown: 2, misses: 1 })
    expect(keys.l).toEqual({ shown: 1, misses: 0 })
    expect(confusions).toEqual([
      { expected: 'k', pressed: 'l', count: 2 },
      { expected: 'j', pressed: 'h', count: 1 },
    ])
  })

  it('壊れた押し間違いデータは読み飛ばす', () => {
    log('dev-mine-01', [rec('w1', '2026-11-03T03:00:00.000Z', { question: 'a', wrong: [['a'], 'x', null, ['a', 's']] })])
    const { keys, confusions } = stats('dev-mine-01').stats
    expect(keys.a).toEqual({ shown: 1, misses: 1 })
    expect(confusions).toEqual([{ expected: 'a', pressed: 's', count: 1 }])
  })

  it.each([
    ['今日と過去2日が続く', ['2026-11-03', '2026-11-02', '2026-11-01'], 3],
    ['今日はまだで、昨日と一昨日が続く(昨日までを数える)', ['2026-11-02', '2026-11-01'], 2],
    ['途切れた日があると、そこまで', ['2026-11-03', '2026-11-01'], 1],
    ['昨日も今日も練習していない', ['2026-10-30'], 0],
  ])('連続練習日数: %s', (_label, dates, expected) => {
    log('dev-streak-01', dates.map((date, index) => rec(`s${index}`, `${date}T03:00:00.000Z`)))
    expect(stats('dev-streak-01').stats.streak).toBe(expected)
  })

  it('管理者: ADMIN_CODE未設定なら使えない', () => {
    const noAdmin = createEnvironment()
    expect(noAdmin.post({ action: 'admin_devices', code: CODE, adminCode: 'x' })).toEqual({ ok: false, error: 'admin_not_configured' })
  })

  it('管理者: 間違った管理者コードは断り、総当たり対策の回数に数える', () => {
    expect(env.post({ action: 'admin_devices', code: CODE, adminCode: 'wrong' })).toEqual({ ok: false, error: 'invalid_admin' })
    expect(env.post({ action: 'admin_devices', code: 'wrong-access', adminCode: ADMIN })).toEqual({ ok: false, error: 'invalid' })
    for (let i = 0; i < 28; i += 1) env.post({ action: 'admin_devices', code: CODE, adminCode: `bad${i}` })
    expect(env.post({ action: 'admin_devices', code: CODE, adminCode: ADMIN })).toEqual({ ok: false, error: 'locked' })
  })

  it('管理者: 端末を最後に練習した順に一覧し、選んだ端末の集計を返す', () => {
    log('dev-old-01', [rec('o1', '2026-10-20T03:00:00.000Z', { durationMs: 5000 })])
    log('dev-new-01', [rec('n1', '2026-11-03T03:00:00.000Z', { durationMs: 7000 }), rec('n2', '2026-11-03T04:00:00.000Z', { durationMs: 1000 })])

    const { devices } = env.post({ action: 'admin_devices', code: CODE, adminCode: ADMIN })
    expect(devices.map((device) => device.deviceId)).toEqual(['dev-new-01', 'dev-old-01'])
    expect(devices[0]).toMatchObject({ records: 2, practiceMs: 8000 })

    const target = env.post({ action: 'admin_stats', code: CODE, adminCode: ADMIN, targetDeviceId: 'dev-old-01' })
    expect(target.ok).toBe(true)
    expect(target.stats.totals).toMatchObject({ records: 1, practiceMs: 5000 })
    expect(env.post({ action: 'admin_stats', code: CODE, adminCode: ADMIN })).toEqual({ ok: false, error: 'bad_request' })
    expect(env.post({ action: 'admin_stats', code: CODE, adminCode: ADMIN, targetDeviceId: 'short' }))
      .toEqual({ ok: false, error: 'bad_request' })
  })

  it('通常の端末は、管理者コードなしで他の端末の集計を取れない', () => {
    log('dev-other-01', [rec('z1', '2026-11-03T03:00:00.000Z')])
    expect(env.post({ action: 'admin_stats', code: CODE, targetDeviceId: 'dev-other-01' }).ok).toBe(false)
    expect(stats('dev-mine-01').stats.totals.records).toBe(0)
  })
})
