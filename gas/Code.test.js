// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8')

// Apps Scriptのグローバル(PropertiesService等)を最小限に模擬して、Code.gsを実際に実行する
function createEnvironment({ accessCode = 'secret-code-123' } = {}) {
  const properties = accessCode ? { ACCESS_CODE: accessCode } : {}
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
    Date,
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
