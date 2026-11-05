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
  const sheets = new Map()
  const calls = { tryLock: 0, waitLock: 0, lockReleased: 0 }
  // ロックと書き込みの順序を確かめるための記録
  const events = []
  let currentNow = NOW

  class FixedDate extends Date {
    constructor(...args) {
      if (args.length) super(...args)
      else super(currentNow)
    }

    static now() { return currentNow }
  }

  // 新規作成のシートの既定グリッドは26列。範囲外への書き込みは例外にする(実際のSheetsと同じ)。
  const createSheet = (name, initialMaxColumns = 26) => {
    const rows = []
    let maxColumns = initialMaxColumns
    const assertInGrid = (column, numColumns) => {
      if (column < 1 || column - 1 + numColumns > maxColumns) {
        throw new Error(`範囲がシートの列数(${maxColumns})を超えています`)
      }
    }
    const sheet = {
      getMaxColumns: () => maxColumns,
      insertColumnsAfter: (afterPosition, howMany) => {
        expect(afterPosition).toBe(maxColumns)
        maxColumns += howMany
        events.push(`insertColumnsAfter:${afterPosition}:${howMany}`)
      },
      getLastRow: () => rows.length,
      getLastColumn: () => rows.reduce((max, row) => Math.max(max, row.length), 0),
      getRange: (row, column, numRows, numColumns) => ({
        // 指定した列から書く。左側の既存セルは残す(ヘッダー移行で右側へ追記するため)。
        setValues: (values) => {
          assertInGrid(column, numColumns)
          expect(numColumns).toBe(values[0].length)
          expect(numRows).toBe(values.length)
          events.push(`set:${row}:${column}`)
          values.forEach((value, index) => {
            const target = rows[row - 1 + index] ?? []
            value.forEach((cell, offset) => { target[column - 1 + offset] = cell })
            rows[row - 1 + index] = target
          })
        },
        getValues: () => {
          assertInGrid(column, numColumns)
          return rows
            .slice(row - 1, row - 1 + numRows)
            .map((cells) => cells.slice(column - 1, column - 1 + numColumns))
        },
      }),
      setFrozenRows: () => {},
    }
    sheets.set(name, { rows, sheet })
    return sheet
  }
  const sheet = createSheet('records')
  const sheetRows = sheets.get('records').rows
  const spreadsheet = {
    getSheetByName: (name) => sheets.get(name)?.sheet ?? null,
    insertSheet: (name) => createSheet(name),
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
        waitLock: () => { calls.waitLock += 1; events.push('waitLock') },
        releaseLock: () => { calls.lockReleased += 1; events.push('releaseLock') },
      }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: () => spreadsheet,
      flush: () => { events.push('flush') },
    },
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
  const dataRows = (name = 'records') => (sheets.get(name)?.rows ?? []).slice(1)
  const rowsFor = (name) => sheets.get(name)?.rows ?? []
  const seedSheet = (name, rows, { maxColumns } = {}) => {
    if (!sheets.has(name)) {
      createSheet(name, maxColumns ?? Math.max(26, ...rows.map((row) => row.length)))
    }
    const target = sheets.get(name).rows
    rows.forEach((row) => target.push([...row]))
  }
  const advanceTime = (ms) => { currentNow += ms }
  return { post, sheetRows, dataRows, rowsFor, seedSheet, calls, events, cache, advanceTime }
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

const runRecord = (overrides = {}) => ({
  id: 'run-0001',
  ts: '2026-11-03T03:00:00.000Z',
  mode: 'timeAttack',
  hand: 'right',
  level: 2,
  includeSymbols: true,
  layout: 'jis',
  targetCount: 10,
  timeLimitSec: null,
  homePosition: false,
  endedBy: 'completed',
  activeMs: 12_345,
  inputMs: 10_000,
  completedQuestions: 10,
  correctCount: 40,
  mistakes: 2,
  attempts: 42,
  accuracy: 95,
  kpm: 240,
  menuOpenCount: 1,
  rankVersion: null,
  appVersion: 'abc1234',
  ...overrides,
})

// ホームポジション列を追加する前の旧ヘッダー(24列)
const LEGACY_RUN_HEADERS = [
  'receivedAt', 'id', 'ts', 'deviceId', 'mode', 'hand', 'level', 'includeSymbols',
  'layout', 'targetCount', 'timeLimitSec', 'homePosition', 'endedBy', 'activeMs',
  'inputMs', 'completedQuestions', 'correctCount', 'mistakes', 'attempts', 'accuracy',
  'kpm', 'menuOpenCount', 'rankVersion', 'appVersion',
]
const HP_HEADERS = ['hpSuccessCount', 'hpSkipCount', 'hpAvgReturnMs', 'hpMinReturnMs']
const RUN_HEADERS = [...LEGACY_RUN_HEADERS, ...HP_HEADERS]

const runResponse = (saved, rejected = 0, rejectedIds = []) => ({
  ok: true, saved, rejected, rejectedIds,
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

describe('Code.gs runごとの記録', () => {
  let env
  beforeEach(() => {
    env = createEnvironment()
  })

  const postRuns = (records, overrides = {}) => ({
    action: 'log_run', code: 'secret-code-123', deviceId: 'dev-mine-01', records, ...overrides,
  })

  it('runsシートを作成し、指定された28列の順でrunを保存する(旧クライアントの記録は新4列が空欄)', () => {
    expect(env.post(postRuns([runRecord()]))).toEqual(runResponse(1))
    expect(env.rowsFor('runs')[0]).toEqual(RUN_HEADERS)
    expect(RUN_HEADERS).toHaveLength(28)
    const row = env.dataRows('runs')[0]
    expect(row[0]).toBeInstanceOf(Date)
    expect(row.slice(1)).toEqual([
      'run-0001', '2026-11-03T03:00:00.000Z', 'dev-mine-01', 'timeAttack', 'right', 2,
      true, 'jis', 10, null, false, 'completed', 12_345, 10_000, 10, 40, 2, 42, 95,
      240, 1, '', 'abc1234', '', '', '', '',
    ])
  })

  it('nullable項目とrankVersion未指定を空欄として保存し、不正なappVersionはunknownへ置換する', () => {
    const withoutRank = runRecord({
      mode: 'free', targetCount: null, timeLimitSec: null, endedBy: 'ended',
      kpm: null, appVersion: '=bad',
    })
    delete withoutRank.rankVersion
    expect(env.post(postRuns([withoutRank]))).toEqual(runResponse(1))
    const row = env.dataRows('runs')[0]
    expect(row[9]).toBeNull()
    expect(row[10]).toBeNull()
    expect(row[20]).toBeNull()
    expect(row[22]).toBe('')
    expect(row[23]).toBe('unknown')
  })

  it.each([
    ['freeの手動終了', runRecord({ mode: 'free', targetCount: null, endedBy: 'ended' })],
    ['タイムアタック1問の完了', runRecord({ targetCount: 1 })],
    ['タイムアタック1000問の途中終了', runRecord({ targetCount: 1000, endedBy: 'ended' })],
    ['制限時間1秒の時間切れ', runRecord({
      mode: 'timeLimit', targetCount: null, timeLimitSec: 1, endedBy: 'timeUp',
    })],
    ['制限時間3600秒の途中終了', runRecord({
      mode: 'timeLimit', targetCount: null, timeLimitSec: 3600, endedBy: 'ended',
    })],
    ['inputMsがactiveMsより1000ms長い境界', runRecord({ activeMs: 9000 })],
    ['計算可能でもnullのKPM', runRecord({ kpm: null })],
    ['KPMの丸め差-1', runRecord({ kpm: 239 })],
    ['KPMの丸め差+1', runRecord({ kpm: 241 })],
  ])('%sは受理する', (_label, valid) => {
    expect(env.post(postRuns([valid]))).toEqual(runResponse(1))
  })

  const hpRecord = (overrides = {}) => runRecord({
    homePosition: true,
    hpSuccessCount: 9,
    hpSkipCount: 1,
    hpAvgReturnMs: 1200,
    hpMinReturnMs: 800,
    ...overrides,
  })

  it('ホームポジション確認の4項目を末尾の4列へ保存する', () => {
    expect(env.post(postRuns([hpRecord()]))).toEqual(runResponse(1))
    const row = env.dataRows('runs')[0]
    expect(row.slice(-4)).toEqual([9, 1, 1200, 800])
    expect(row[11]).toBe(true)
    expect(row).toHaveLength(RUN_HEADERS.length)
  })

  it('成功0回の確認ありrunは、平均・最短をnullで受理して空欄にする', () => {
    const none = hpRecord({
      hpSuccessCount: 0, hpSkipCount: 3, hpAvgReturnMs: null, hpMinReturnMs: null,
    })
    expect(env.post(postRuns([none]))).toEqual(runResponse(1))
    expect(env.dataRows('runs')[0].slice(-4)).toEqual([0, 3, '', ''])
  })

  it('新4項目の省略とnullは空欄で保存する(確認なしのrunが0回で送る場合も受理する)', () => {
    const nulls = runRecord({
      id: 'run-nulls', hpSuccessCount: null, hpSkipCount: null, hpAvgReturnMs: null, hpMinReturnMs: null,
    })
    const off = runRecord({
      id: 'run-off-1', homePosition: false, hpSuccessCount: 0, hpSkipCount: 0,
      hpAvgReturnMs: null, hpMinReturnMs: null,
    })
    expect(env.post(postRuns([nulls, off]))).toEqual(runResponse(2))
    expect(env.dataRows('runs').map((row) => row.slice(-4))).toEqual([
      ['', '', '', ''],
      [0, 0, '', ''],
    ])
  })

  it.each([
    ['回数の上限', hpRecord({
      activeMs: 86_400_000, inputMs: 1000, kpm: null, completedQuestions: 100_000,
      hpSuccessCount: 100_000, hpSkipCount: 0, hpAvgReturnMs: 864, hpMinReturnMs: 1,
    })],
    ['時間の上限', hpRecord({
      activeMs: 86_400_000, hpSuccessCount: 1, hpSkipCount: 0,
      hpAvgReturnMs: 86_400_000, hpMinReturnMs: 86_400_000,
    })],
    ['最短と平均が同じ', hpRecord({ hpAvgReturnMs: 500, hpMinReturnMs: 500 })],
    ['成功+スキップが完了問題数ちょうど', hpRecord({ hpSuccessCount: 5, hpSkipCount: 5, hpAvgReturnMs: 500, hpMinReturnMs: 400 })],
    ['平均×成功が総経過時間+1000ちょうど', hpRecord({
      activeMs: 9000, hpSuccessCount: 10, hpSkipCount: 0, hpAvgReturnMs: 1000, hpMinReturnMs: 1000,
    })],
    ['確認なしの回数0', runRecord({ homePosition: false, hpSuccessCount: 0, hpSkipCount: 0 })],
    ['確認なしで4項目とも省略', runRecord({ homePosition: false })],
  ])('ホームポジション項目: %sは受理する', (_label, valid) => {
    expect(env.post(postRuns([valid]))).toEqual(runResponse(1))
  })

  it.each([
    ['成功回数の小数', hpRecord({ hpSuccessCount: 1.5 })],
    ['成功回数の負数', hpRecord({ hpSuccessCount: -1 })],
    ['成功回数の上限超過', hpRecord({ hpSuccessCount: 100_001 })],
    ['成功回数の文字列', hpRecord({ hpSuccessCount: '9' })],
    ['スキップ回数の上限超過', hpRecord({ hpSkipCount: 100_001 })],
    ['スキップ回数の負数', hpRecord({ hpSkipCount: -1 })],
    ['平均の上限超過', hpRecord({ hpAvgReturnMs: 86_400_001 })],
    ['平均の小数', hpRecord({ hpAvgReturnMs: 1200.5 })],
    ['最短の負数', hpRecord({ hpMinReturnMs: -1 })],
    ['最短の上限超過', hpRecord({ hpMinReturnMs: 86_400_001 })],
    ['確認なしなのに成功あり', runRecord({ homePosition: false, hpSuccessCount: 1 })],
    ['確認なしなのにスキップあり', runRecord({ homePosition: false, hpSkipCount: 1 })],
    ['確認なしなのに平均あり', runRecord({ homePosition: false, hpAvgReturnMs: 1000 })],
    ['確認なしなのに最短あり', runRecord({ homePosition: false, hpMinReturnMs: 1000 })],
    ['成功0なのに平均あり', hpRecord({ hpSuccessCount: 0, hpMinReturnMs: null })],
    ['成功0なのに最短あり', hpRecord({ hpSuccessCount: 0, hpAvgReturnMs: null })],
    ['最短が平均より2以上大きい', hpRecord({ hpAvgReturnMs: 500, hpMinReturnMs: 502 })],
    ['最短が平均より1大きい(丸めの許容なし)', hpRecord({ hpAvgReturnMs: 500, hpMinReturnMs: 501 })],
    ['確認ありで成功回数が省略', hpRecord({ hpSuccessCount: undefined })],
    ['確認ありでスキップ回数が省略', hpRecord({ hpSkipCount: undefined })],
    ['確認ありで成功回数がnull', hpRecord({ hpSuccessCount: null })],
    ['確認ありで4項目とも省略', runRecord({ homePosition: true })],
    ['成功ありなのに平均がnull', hpRecord({ hpAvgReturnMs: null })],
    ['成功ありなのに最短がnull', hpRecord({ hpMinReturnMs: null })],
    ['成功+スキップが完了問題数を超える', hpRecord({ hpSuccessCount: 9, hpSkipCount: 2 })],
    ['平均が総経過時間を超える', hpRecord({
      hpSuccessCount: 1, hpSkipCount: 0, hpAvgReturnMs: 12_346, hpMinReturnMs: 800,
    })],
    ['平均×成功が総経過時間+1000を超える', hpRecord({
      activeMs: 9000, hpSuccessCount: 10, hpSkipCount: 0, hpAvgReturnMs: 1001, hpMinReturnMs: 1000,
    })],
  ])('ホームポジション項目: %sは拒否する', (_label, invalid) => {
    expect(env.post(postRuns([invalid]))).toEqual(runResponse(0, 1, [invalid.id]))
    expect(env.dataRows('runs')).toEqual([])
  })

  describe('runsシートのヘッダー移行', () => {
    const legacyRow = () => [
      new Date(NOW), 'run-old-1', '2026-11-02T03:00:00.000Z', 'dev-mine-01', 'free', 'left', 1,
      false, 'jis', null, null, false, 'ended', 5000, 4000, 3, 20, 1, 21, 95, 300, 0, '', 'old1234',
    ]

    it('旧24列ヘッダーなら、ロック内で新4列の見出しを追記して続行し、既存行は変えない', () => {
      env.seedSheet('runs', [LEGACY_RUN_HEADERS, legacyRow()])
      expect(env.post(postRuns([hpRecord()]))).toEqual(runResponse(1))

      const rows = env.rowsFor('runs')
      expect(rows[0]).toEqual(RUN_HEADERS)
      // 旧行はそのまま(新4列は空欄=セルなし)
      expect(rows[1]).toEqual(legacyRow())
      expect(rows[1]).toHaveLength(24)
      expect(rows[2]).toHaveLength(28)
      expect(rows[2].slice(-4)).toEqual([9, 1, 1200, 800])
      // ヘッダー追記はロックの内側(waitLockの後、releaseLockの前)で、25列目から4セルだけ
      const headerWrite = env.events.indexOf('set:1:25')
      expect(headerWrite).toBeGreaterThan(env.events.indexOf('waitLock'))
      expect(headerWrite).toBeLessThan(env.events.lastIndexOf('releaseLock'))
      expect(env.events.filter((event) => event === 'set:1:25')).toHaveLength(1)
    })

    it('二重に移行せず、移行済みのシートへそのまま追記する', () => {
      env.seedSheet('runs', [LEGACY_RUN_HEADERS])
      expect(env.post(postRuns([hpRecord()]))).toEqual(runResponse(1))
      expect(env.post(postRuns([hpRecord({ id: 'run-0002' })]))).toEqual(runResponse(1))
      expect(env.rowsFor('runs')[0]).toEqual(RUN_HEADERS)
      expect(env.rowsFor('runs')[0]).toHaveLength(28)
      expect(env.events.filter((event) => event === 'set:1:25')).toHaveLength(1)
      expect(env.dataRows('runs').map((row) => row[1])).toEqual(['run-0001', 'run-0002'])
    })

    it('旧クライアントの記録(新4項目なし)でも旧ヘッダーを移行して受理する', () => {
      env.seedSheet('runs', [LEGACY_RUN_HEADERS])
      expect(env.post(postRuns([runRecord()]))).toEqual(runResponse(1))
      expect(env.rowsFor('runs')[0]).toEqual(RUN_HEADERS)
      expect(env.dataRows('runs')[0].slice(-4)).toEqual(['', '', '', ''])
    })

    it('検証で拒否された記録だけの送信では、シートを触らず移行もしない', () => {
      env.seedSheet('runs', [LEGACY_RUN_HEADERS])
      expect(env.post(postRuns([runRecord({ accuracy: 0 })]))).toEqual(runResponse(0, 1, ['run-0001']))
      expect(env.rowsFor('runs')).toEqual([LEGACY_RUN_HEADERS])
    })

    it.each([
      ['旧ヘッダーの1セルが違う', [...LEGACY_RUN_HEADERS.slice(0, 5), 'modeX', ...LEGACY_RUN_HEADERS.slice(6)]],
      ['旧ヘッダーの末尾が欠けている(23列)', LEGACY_RUN_HEADERS.slice(0, 23)],
      ['25列(新列が途中まで)', [...LEGACY_RUN_HEADERS, 'hpSuccessCount']],
      ['27列(新列が途中まで)', RUN_HEADERS.slice(0, 27)],
      ['29列', [...RUN_HEADERS, 'extra']],
      ['新4列の名前が違う', [...LEGACY_RUN_HEADERS, 'hpSuccessCount', 'hpSkipCount', 'avg', 'hpMinReturnMs']],
      ['24列で順序が違う', [LEGACY_RUN_HEADERS[1], LEGACY_RUN_HEADERS[0], ...LEGACY_RUN_HEADERS.slice(2)]],
    ])('%sは書き込まずsheet_header_mismatchにする', (_label, header) => {
      env.seedSheet('runs', [header])
      expect(env.post(postRuns([hpRecord()]))).toEqual({ ok: false, error: 'sheet_header_mismatch' })
      expect(env.rowsFor('runs')).toEqual([header])
    })

    it('列を足さないと範囲外の書き込みで落ちる(新規作成の26列グリッド・24列だけの旧シート)', () => {
      // 新規作成: 既定26列に28列のヘッダーを書くため、先に列を足す
      expect(env.post(postRuns([hpRecord()]))).toEqual(runResponse(1))
      expect(env.events).toContain('insertColumnsAfter:26:2')
      expect(env.events.indexOf('insertColumnsAfter:26:2')).toBeLessThan(env.events.indexOf('set:1:1'))
      expect(env.rowsFor('runs')[0]).toEqual(RUN_HEADERS)

      // 24列ちょうどのグリッドの旧シート: 25〜28列目を書く前に4列足す
      const legacy = createEnvironment()
      legacy.seedSheet('runs', [LEGACY_RUN_HEADERS, legacyRow()], { maxColumns: 24 })
      expect(legacy.post(postRuns([hpRecord()]))).toEqual(runResponse(1))
      expect(legacy.events).toContain('insertColumnsAfter:24:4')
      expect(legacy.events.indexOf('insertColumnsAfter:24:4')).toBeLessThan(legacy.events.indexOf('set:1:25'))
      expect(legacy.rowsFor('runs')[0]).toEqual(RUN_HEADERS)
    })

    it('既定の26列グリッドの旧シートも、27〜28列目が範囲外にならないよう列を足してから移行する', () => {
      env.seedSheet('runs', [LEGACY_RUN_HEADERS, legacyRow()])
      expect(env.post(postRuns([hpRecord()]))).toEqual(runResponse(1))
      expect(env.events).toContain('insertColumnsAfter:26:2')
      expect(env.rowsFor('runs')[0]).toEqual(RUN_HEADERS)
    })

    it('ヘッダー移行・追記のあと、ロックを手放す前にflushする', () => {
      env.seedSheet('runs', [LEGACY_RUN_HEADERS])
      expect(env.post(postRuns([hpRecord()]))).toEqual(runResponse(1))
      const flush = env.events.lastIndexOf('flush')
      expect(flush).toBeGreaterThan(env.events.lastIndexOf('set:2:1'))
      expect(flush).toBeLessThan(env.events.lastIndexOf('releaseLock'))
    })

    it('新ヘッダーと完全一致するシートはそのまま使い、ヘッダーを書き直さない', () => {
      env.seedSheet('runs', [RUN_HEADERS])
      expect(env.post(postRuns([hpRecord()]))).toEqual(runResponse(1))
      expect(env.events.filter((event) => event.startsWith('set:1:'))).toEqual([])
    })
  })

  it.each([
    ['レコード本体', null],
    ['id', runRecord({ id: 'short' })],
    ['tsの型', runRecord({ ts: 123 })],
    ['tsの下限', runRecord({ ts: '2019-12-31T23:59:59.000Z' })],
    ['tsの未来上限', runRecord({ ts: '2026-11-04T12:00:01.000Z' })],
    ['mode', runRecord({ mode: 'speed' })],
    ['hand', runRecord({ hand: 'both' })],
    ['level', runRecord({ level: 4 })],
    ['includeSymbols', runRecord({ includeSymbols: 1 })],
    ['layout', runRecord({ layout: 'dvorak' })],
    ['freeのtargetCount', runRecord({ mode: 'free', targetCount: 1, endedBy: 'ended' })],
    ['freeのtimeLimitSec', runRecord({
      mode: 'free', targetCount: null, timeLimitSec: 1, endedBy: 'ended',
    })],
    ['timeAttackのtargetCount下限', runRecord({ targetCount: 0 })],
    ['timeAttackのtargetCount上限', runRecord({ targetCount: 1001 })],
    ['timeAttackのtimeLimitSec', runRecord({ timeLimitSec: 30 })],
    ['timeLimitのtimeLimitSec下限', runRecord({
      mode: 'timeLimit', targetCount: null, timeLimitSec: 0, endedBy: 'timeUp',
    })],
    ['timeLimitのtimeLimitSec上限', runRecord({
      mode: 'timeLimit', targetCount: null, timeLimitSec: 3601, endedBy: 'timeUp',
    })],
    ['timeLimitのtargetCount', runRecord({
      mode: 'timeLimit', targetCount: 10, timeLimitSec: 30, endedBy: 'timeUp',
    })],
    ['homePosition', runRecord({ homePosition: 'no' })],
    ['endedBy', runRecord({ endedBy: 'abandoned' })],
    ['freeのcompleted', runRecord({
      mode: 'free', targetCount: null, endedBy: 'completed',
    })],
    ['timeLimitのcompleted', runRecord({
      mode: 'timeLimit', targetCount: null, timeLimitSec: 30, endedBy: 'completed',
    })],
    ['timeAttackのtimeUp', runRecord({ endedBy: 'timeUp' })],
    ['activeMs', runRecord({ activeMs: 86_400_001 })],
    ['inputMsの整数', runRecord({ inputMs: 1.5 })],
    ['inputMsとactiveMsの差', runRecord({ activeMs: 8999 })],
    ['completedQuestions', runRecord({ completedQuestions: 100_001 })],
    ['correctCount', runRecord({ correctCount: -1 })],
    ['attemptsより内訳が多い', runRecord({ correctCount: 41 })],
    ['attemptsより内訳が少ない', runRecord({ correctCount: 39 })],
    ['attemptsの下限', runRecord({ attempts: 0, mistakes: 0 })],
    ['attemptsの整数', runRecord({ attempts: 1.5, mistakes: 0 })],
    ['accuracyの計算不一致', runRecord({ accuracy: 94 })],
    ['1秒未満のKPM', runRecord({ activeMs: 999, inputMs: 999, kpm: 2402 })],
    ['KPMの計算差2', runRecord({ kpm: 242 })],
    ['menuOpenCount', runRecord({ menuOpenCount: 1001 })],
    ['rankVersion', runRecord({ rankVersion: 1000 })],
  ])('%sが不正なrunをrejectedに数える', (_field, invalid) => {
    const rejectedIds = invalid && typeof invalid.id === 'string' ? [invalid.id] : []
    expect(env.post(postRuns([invalid]))).toEqual(runResponse(0, 1, rejectedIds))
    expect(env.dataRows('runs')).toEqual([])
  })

  it('logと同じアクセスコード・deviceId検証を通す', () => {
    expect(env.post(postRuns([runRecord()], { code: 'wrong' }))).toEqual({ ok: false, error: 'invalid' })
    expect(env.post(postRuns([runRecord()], { deviceId: 'short' }))).toEqual({ ok: false, error: 'bad_request' })
    expect(env.dataRows('runs')).toEqual([])
  })

  it('既存IDと同一バッチ内の重複を保存しない', () => {
    expect(env.post(postRuns([runRecord()]))).toEqual(runResponse(1))
    expect(env.post(postRuns([
      runRecord(), runRecord({ id: 'run-0002' }), runRecord({ id: 'run-0002' }),
    ]))).toEqual(runResponse(1))
    expect(env.dataRows('runs').map((row) => row[1])).toEqual(['run-0001', 'run-0002'])
  })

  it('数式になり得る文字列をtext_で保護し、保護後のIDも重複判定する', () => {
    const protectedRecord = runRecord({ id: '-run-0001', appVersion: '-build' })
    const body = postRuns([protectedRecord], { deviceId: '-dev-0001' })
    expect(env.post(body)).toEqual(runResponse(1))
    const row = env.dataRows('runs')[0]
    expect(row[1]).toBe("'-run-0001")
    expect(row[3]).toBe("'-dev-0001")
    expect(row[23]).toBe("'-build")
    expect(env.post(body)).toEqual(runResponse(0))
  })

  it('1リクエストは20件までとし、超過分をrejectedに数える', () => {
    const records = Array.from({ length: 25 }, (_, index) => (
      runRecord({ id: `run-${String(index).padStart(4, '0')}` })
    ))
    expect(env.post(postRuns(records))).toEqual(runResponse(20, 5, [
      'run-0020', 'run-0021', 'run-0022', 'run-0023', 'run-0024',
    ]))
    expect(env.dataRows('runs')).toHaveLength(20)
  })

  it('records未設定は空バッチとして成功し、runsシートを作らない', () => {
    expect(env.post(postRuns(undefined))).toEqual(runResponse(0))
    expect(env.rowsFor('runs')).toEqual([])
  })

  it('log_runは既存recordsとstatsの結果を変えない', () => {
    expect(env.post({
      action: 'log', code: 'secret-code-123', deviceId: 'dev-mine-01', records: [record()],
    })).toEqual({ ok: true, saved: 1, rejected: 0 })
    const before = env.post({ action: 'stats', code: 'secret-code-123', deviceId: 'dev-mine-01' })
    expect(env.post(postRuns([runRecord()]))).toEqual(runResponse(1))
    const after = env.post({ action: 'stats', code: 'secret-code-123', deviceId: 'dev-mine-01' })
    expect(after).toEqual(before)
    expect(env.dataRows()).toHaveLength(1)
    expect(env.dataRows('runs')).toHaveLength(1)
  })

  it('拒否IDは取得できたものだけ重複なく最大20件返す', () => {
    const records = Array.from({ length: 25 }, (_, index) => (
      runRecord({ id: `bad-${String(index).padStart(4, '0')}`, accuracy: 0 })
    ))
    const result = env.post(postRuns(records))
    expect(result.rejected).toBe(25)
    expect(result.rejectedIds).toHaveLength(20)
    expect(result.rejectedIds).toEqual(records.slice(20).concat(records.slice(0, 15)).map(({ id }) => id))
  })

  it('runsの既存ヘッダーが一致しなければ書き込まずエラーにする', () => {
    env.seedSheet('runs', [['old', ...RUN_HEADERS.slice(1)]])
    expect(env.post(postRuns([runRecord()]))).toEqual({ ok: false, error: 'sheet_header_mismatch' })
    expect(env.rowsFor('runs')).toEqual([['old', ...RUN_HEADERS.slice(1)]])
  })

  it('recordsの既存ヘッダーは従来どおり検証しない', () => {
    env.sheetRows.push(['old-header'])
    expect(env.post({
      action: 'log', code: 'secret-code-123', deviceId: 'dev-mine-01', records: [record()],
    })).toEqual({ ok: true, saved: 1, rejected: 0 })
    expect(env.dataRows()).toHaveLength(1)
  })

  it('log_runの書き込みをwaitLockで囲み、必ずreleaseLockする', () => {
    expect(env.post(postRuns([runRecord()]))).toEqual(runResponse(1))
    expect(env.calls.tryLock).toBe(1)
    expect(env.calls.waitLock).toBe(1)
    expect(env.calls.lockReleased).toBe(2)
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
