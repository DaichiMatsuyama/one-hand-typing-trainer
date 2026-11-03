// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8')

// Apps Scriptのグローバル(PropertiesService等)を最小限に模擬して、Code.gsを実際に実行する
// 2026-11-03 21:00(日本時間)に固定する
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)
class FixedDate extends Date {
  constructor(...args) {
    if (args.length) super(...args)
    else super(NOW)
  }

  static now() { return NOW }
}

function createEnvironment({ accessCode = 'secret-code-123', adminCode = null } = {}) {
  const properties = accessCode ? { ACCESS_CODE: accessCode } : {}
  if (adminCode) properties.ADMIN_CODE = adminCode
  const cache = new Map()
  const sheetRows = []
  const calls = { lockAcquired: 0, lockReleased: 0 }

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
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { calls.lockAcquired += 1 },
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
  return { post, sheetRows, dataRows, calls, cache }
}

const record = (overrides = {}) => ({
  id: 'rec-1',
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

  it('壊れた本文・未知のactionは拒否する', () => {
    expect(env.post('not json')).toEqual({ ok: false, error: 'bad_request' })
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

  it('コードが違うlogは何も保存しない', () => {
    expect(env.post({ action: 'log', code: 'wrong', records: [record()] })).toEqual({ ok: false, error: 'invalid' })
    expect(env.dataRows()).toHaveLength(0)
  })

  it('logで1問ごとに1行を追記し、列の並びが見出しと一致する', () => {
    const result = env.post({ action: 'log', code: 'secret-code-123', deviceId: 'dev-1', records: [record()] })
    expect(result).toEqual({ ok: true, saved: 1 })
    expect(env.sheetRows[0]).toHaveLength(13)
    expect(env.sheetRows[0][0]).toBe('receivedAt')
    const row = env.dataRows()[0]
    expect(row[0]).toBeInstanceOf(Date)
    expect(row.slice(1)).toEqual([
      'rec-1', '2026-11-03T03:00:00.000Z', 'dev-1', 'right', 2, true, 'jis', 'jk@l', 4200, 5, 1, '[["k","l"]]',
    ])
    expect(env.calls.lockAcquired).toBe(1)
    expect(env.calls.lockReleased).toBe(1)
  })

  it('同じidの再送は二重に追記しない', () => {
    const body = { action: 'log', code: 'secret-code-123', deviceId: 'dev-1', records: [record()] }
    expect(env.post(body)).toEqual({ ok: true, saved: 1 })
    expect(env.post(body)).toEqual({ ok: true, saved: 0 })
    expect(env.dataRows()).toHaveLength(1)
  })

  it('数式として解釈されうる先頭文字に ' + "'" + ' を付け、数値は範囲内に丸める', () => {
    env.post({
      action: 'log',
      code: 'secret-code-123',
      deviceId: '=HYPERLINK("x")',
      records: [record({ question: '@abc', durationMs: -5, attempts: 'many', mistakes: 1e12, level: 99 })],
    })
    const row = env.dataRows()[0]
    expect(row[3]).toBe("'=HYPERLINK(\"x\")")
    expect(row[8]).toBe("'@abc")
    expect(row[5]).toBe(3)
    expect(row[9]).toBe(0)
    expect(row[10]).toBe(0)
    expect(row[11]).toBe(100000)
  })

  it('1回の送信は50件までに制限し、不正な要素は読み飛ばす', () => {
    const records = Array.from({ length: 60 }, (_, index) => record({ id: `r${index}` }))
    records.splice(3, 0, null, 'text', { id: '' })
    const result = env.post({ action: 'log', code: 'secret-code-123', records })
    expect(result.ok).toBe(true)
    expect(result.saved).toBeLessThanOrEqual(50)
    expect(env.dataRows().every((row) => row[1])).toBe(true)
  })
})

describe('Code.gs 成績の集計(振り返り画面用)', () => {
  const CODE = 'secret-code-123'
  const ADMIN = 'admin-code-456'
  let env

  const log = (deviceId, records) => env.post({ action: 'log', code: CODE, deviceId, records })
  const stats = (deviceId) => env.post({ action: 'stats', code: CODE, deviceId })
  const rec = (id, ts, overrides = {}) => record({ id, ts, ...overrides })

  beforeEach(() => {
    env = createEnvironment({ adminCode: ADMIN })
  })

  it('アクセスコードが違う、またはdeviceIdが無いときは集計を返さない', () => {
    expect(env.post({ action: 'stats', code: 'wrong', deviceId: 'dev-1' })).toEqual({ ok: false, error: 'invalid' })
    expect(env.post({ action: 'stats', code: CODE })).toEqual({ ok: false, error: 'bad_request' })
  })

  it('記録が無い端末には、空の集計を返す', () => {
    const { ok, stats: result } = stats('nobody')
    expect(ok).toBe(true)
    expect(result.totals).toMatchObject({ records: 0, practiceMs: 0, days: 0, firstDate: null, lastDate: null })
    expect(result.streak).toBe(0)
    expect(result.daily).toHaveLength(14)
    expect(result.daily.every((day) => day.records === 0)).toBe(true)
    expect(result.keys).toEqual({})
    expect(result.confusions).toEqual([])
  })

  it('自分の端末の記録だけを集計し、他の端末は含めない', () => {
    log('dev-mine', [rec('a1', '2026-11-03T03:00:00.000Z'), rec('a2', '2026-11-03T03:05:00.000Z')])
    log('dev-other', [rec('b1', '2026-11-03T03:00:00.000Z')])
    expect(stats('dev-mine').stats.totals.records).toBe(2)
    expect(stats('dev-other').stats.totals.records).toBe(1)
  })

  it('日付は日本時間でまとめる(UTC 15:00 で日が変わる)', () => {
    log('dev-1', [
      rec('x1', '2026-11-02T14:59:59.000Z'), // 日本時間 11/2 23:59
      rec('x2', '2026-11-02T15:00:00.000Z'), // 日本時間 11/3 00:00
    ])
    const { daily, today } = stats('dev-1').stats
    expect(daily.at(-2)).toMatchObject({ date: '2026-11-02', records: 1 })
    expect(daily.at(-1)).toMatchObject({ date: '2026-11-03', records: 1 })
    expect(today.date).toBe('2026-11-03')
    expect(today.records).toBe(1)
  })

  it('直近14日を、練習しなかった日も0で埋めて古い順に返す', () => {
    log('dev-1', [rec('d1', '2026-10-30T03:00:00.000Z', { durationMs: 60000, attempts: 10, mistakes: 2 })])
    const { daily } = stats('dev-1').stats
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
    log('dev-1', [
      rec('t1', '2026-10-28T03:00:00.000Z', { durationMs: 1000, attempts: 4, mistakes: 1 }),
      rec('t2', '2026-11-03T03:00:00.000Z', { durationMs: 2000, attempts: 6, mistakes: 0 }),
    ])
    expect(stats('dev-1').stats.totals).toEqual({
      records: 2, practiceMs: 3000, attempts: 10, mistakes: 1, days: 2, firstDate: '2026-10-28', lastDate: '2026-11-03',
    })
  })

  it('キーごとの出題回数とミス回数、取り違えの多い順を返す', () => {
    log('dev-1', [
      rec('k1', '2026-11-03T03:00:00.000Z', { question: 'jkl', mistakes: 2, wrong: [['k', 'l'], ['k', 'l']] }),
      rec('k2', '2026-11-03T03:01:00.000Z', { question: 'kj', mistakes: 1, wrong: [['j', 'h']] }),
    ])
    const { keys, confusions } = stats('dev-1').stats
    expect(keys.k).toEqual({ shown: 2, misses: 2 })
    expect(keys.j).toEqual({ shown: 2, misses: 1 })
    expect(keys.l).toEqual({ shown: 1, misses: 0 })
    expect(confusions).toEqual([
      { expected: 'k', pressed: 'l', count: 2 },
      { expected: 'j', pressed: 'h', count: 1 },
    ])
  })

  it('壊れた押し間違いデータは読み飛ばす', () => {
    log('dev-1', [rec('w1', '2026-11-03T03:00:00.000Z', { question: 'a', wrong: [['a'], 'x', null, ['a', 's']] })])
    const { keys, confusions } = stats('dev-1').stats
    expect(keys.a).toEqual({ shown: 1, misses: 1 })
    expect(confusions).toEqual([{ expected: 'a', pressed: 's', count: 1 }])
  })

  it.each([
    ['今日と過去2日が続く', ['2026-11-03', '2026-11-02', '2026-11-01'], 3],
    ['今日はまだで、昨日と一昨日が続く(昨日までを数える)', ['2026-11-02', '2026-11-01'], 2],
    ['途切れた日があると、そこまで', ['2026-11-03', '2026-11-01'], 1],
    ['昨日も今日も練習していない', ['2026-10-30'], 0],
  ])('連続練習日数: %s', (_label, dates, expected) => {
    log('dev-1', dates.map((date, index) => rec(`s${index}`, `${date}T03:00:00.000Z`)))
    expect(stats('dev-1').stats.streak).toBe(expected)
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
    log('dev-old', [rec('o1', '2026-10-20T03:00:00.000Z', { durationMs: 5000 })])
    log('dev-new', [rec('n1', '2026-11-03T03:00:00.000Z', { durationMs: 7000 }), rec('n2', '2026-11-03T04:00:00.000Z', { durationMs: 1000 })])

    const { devices } = env.post({ action: 'admin_devices', code: CODE, adminCode: ADMIN })
    expect(devices.map((device) => device.deviceId)).toEqual(['dev-new', 'dev-old'])
    expect(devices[0]).toMatchObject({ records: 2, practiceMs: 8000 })

    const target = env.post({ action: 'admin_stats', code: CODE, adminCode: ADMIN, targetDeviceId: 'dev-old' })
    expect(target.ok).toBe(true)
    expect(target.stats.totals).toMatchObject({ records: 1, practiceMs: 5000 })
    expect(env.post({ action: 'admin_stats', code: CODE, adminCode: ADMIN })).toEqual({ ok: false, error: 'bad_request' })
  })

  it('通常の端末は、管理者コードなしで他の端末の集計を取れない', () => {
    log('dev-other', [rec('z1', '2026-11-03T03:00:00.000Z')])
    expect(env.post({ action: 'admin_stats', code: CODE, targetDeviceId: 'dev-other' }).ok).toBe(false)
    expect(stats('dev-mine').stats.totals.records).toBe(0)
  })
})
