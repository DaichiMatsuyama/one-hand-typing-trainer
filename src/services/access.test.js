import { describe, expect, it, vi } from 'vitest'
import {
  ACCESS_KEY,
  evaluateGate,
  isLocalDevHost,
  isStandaloneDisplay,
  loadAccess,
  saveAccess,
  verifyCode,
} from './access.js'

const ENDPOINT = 'https://script.google.com/macros/s/test/exec'
const granted = { granted: true, code: 'abc12345', deviceId: 'dev-1', grantedAt: 1 }

describe('evaluateGate', () => {
  const base = { endpoint: ENDPOINT, hostname: 'daichimatsuyama.github.io', search: '', standalone: true, access: granted }

  it.each([
    ['送信先が未設定なら誰でも使える', { endpoint: '', standalone: false, access: null }, 'open'],
    ['Safariのタブでは案内だけ(コード入力済みでも)', { standalone: false }, 'need-standalone'],
    ['ホーム画面から開いてもコード未入力なら入力が必要', { access: null }, 'need-code'],
    ['ホーム画面かつコード入力済みなら使える', {}, 'open'],
    ['localhostでは制限しない', { hostname: 'localhost', standalone: false, access: null }, 'open'],
    ['127.0.0.1でも制限しない', { hostname: '127.0.0.1', standalone: false, access: null }, 'open'],
    ['localhostでも?forceGate=1なら制限する', { hostname: 'localhost', search: '?forceGate=1', standalone: false }, 'need-standalone'],
    ['本番ホストに?forceGate=0を付けても制限は外れない', { search: '?forceGate=0', standalone: false }, 'need-standalone'],
    ['granted=falseは入力済みと見なさない', { access: { ...granted, granted: false } }, 'need-code'],
  ])('%s', (_label, overrides, expected) => {
    expect(evaluateGate({ ...base, ...overrides })).toBe(expected)
  })
})

describe('isLocalDevHost / isStandaloneDisplay', () => {
  it('ローカル開発ホストだけを判定する', () => {
    expect(isLocalDevHost('localhost')).toBe(true)
    expect(isLocalDevHost('app.localhost')).toBe(true)
    expect(isLocalDevHost('example.com')).toBe(false)
    expect(isLocalDevHost('localhost.evil.com')).toBe(false)
  })

  it('navigator.standaloneまたはdisplay-mode:standaloneで判定する', () => {
    expect(isStandaloneDisplay({ navigator: { standalone: true } })).toBe(true)
    expect(isStandaloneDisplay({ navigator: {}, matchMedia: () => ({ matches: true }) })).toBe(true)
    expect(isStandaloneDisplay({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false)
    expect(isStandaloneDisplay({ navigator: {} })).toBe(false)
  })
})

describe('loadAccess / saveAccess', () => {
  const memory = (initial) => {
    const values = new Map(initial === undefined ? [] : [[ACCESS_KEY, initial]])
    return { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
  }

  it('保存して読み戻せる', () => {
    const storage = memory()
    expect(saveAccess(granted, storage)).toBe(true)
    expect(loadAccess(storage)).toEqual(granted)
  })

  it.each([
    ['壊れたJSON', '{oops'],
    ['null', 'null'],
    ['grantedがtrueでない', JSON.stringify({ ...granted, granted: 'yes' })],
    ['codeが空', JSON.stringify({ ...granted, code: '' })],
    ['deviceIdが無い', JSON.stringify({ granted: true, code: 'x' })],
    ['配列', '[]'],
  ])('不正な保存値(%s)は未入力として扱う', (_label, raw) => {
    expect(loadAccess(memory(raw))).toBeNull()
  })

  it('保存領域が使えなくても例外にしない', () => {
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(loadAccess(broken)).toBeNull()
    expect(saveAccess(granted, broken)).toBe(false)
  })
})

describe('verifyCode', () => {
  const respond = (body, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => body })

  it('成功・不正コード・ロック・サーバー異常を区別する', async () => {
    expect(await verifyCode('a', { endpoint: ENDPOINT, fetchImpl: respond({ ok: true }) })).toEqual({ ok: true })
    expect(await verifyCode('a', { endpoint: ENDPOINT, fetchImpl: respond({ ok: false, error: 'invalid' }) }))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(await verifyCode('a', { endpoint: ENDPOINT, fetchImpl: respond({ ok: false, error: 'locked' }) }))
      .toEqual({ ok: false, reason: 'locked' })
    expect(await verifyCode('a', { endpoint: ENDPOINT, fetchImpl: respond({ ok: false, error: 'not_configured' }) }))
      .toEqual({ ok: false, reason: 'server' })
    expect(await verifyCode('a', { endpoint: ENDPOINT, fetchImpl: respond({}, false) }))
      .toEqual({ ok: false, reason: 'server' })
  })

  it('通信失敗・JSONでない応答はnetwork扱いで、例外にしない', async () => {
    const offline = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await verifyCode('a', { endpoint: ENDPOINT, fetchImpl: offline })).toEqual({ ok: false, reason: 'network' })
    const html = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('not json') } })
    expect(await verifyCode('a', { endpoint: ENDPOINT, fetchImpl: html })).toEqual({ ok: false, reason: 'network' })
  })

  it('Content-Typeを指定せず(プリフライトを避ける)、コードと端末IDをPOSTする', async () => {
    const fetchImpl = respond({ ok: true })
    await verifyCode('abc', { endpoint: ENDPOINT, deviceId: 'dev-9', fetchImpl })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.headers).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ action: 'verify', code: 'abc', deviceId: 'dev-9' })
  })
})
