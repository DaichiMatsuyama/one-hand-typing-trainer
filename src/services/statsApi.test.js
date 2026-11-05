import { describe, expect, it, vi } from 'vitest'
import { fetchDevices, fetchDeviceStats, fetchStats } from './statsApi.js'

const ENDPOINT = 'https://script.google.com/macros/s/test/exec'
const access = { granted: true, code: 'code-1', deviceId: 'dev-1', grantedAt: 1 }
const respond = (body, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => body })
const validRun = {
  ts: '2026-11-03T03:00:00.000Z', mode: 'timeAttack', hand: 'left', level: 1,
  includeSymbols: false, layout: 'jis', targetCount: 10, timeLimitSec: null,
  homePosition: false, endedBy: 'completed', activeMs: 12_000, inputMs: 10_000,
  completedQuestions: 10, correctCount: 40, mistakes: 2, attempts: 42, accuracy: 95,
  kpm: 240, menuOpenCount: 0, hpSuccessCount: 0, hpSkipCount: 0,
  hpAvgReturnMs: null, hpMinReturnMs: null, rankVersion: null,
}

describe('statsApi', () => {
  it('statsは、コードと端末IDをtext/plainのPOSTで送り、集計を返す', async () => {
    const fetchImpl = respond({ ok: true, stats: { streak: 2 } })
    const result = await fetchStats({ endpoint: ENDPOINT, access, fetchImpl })
    expect(result).toEqual({ ok: true, stats: { streak: 2 } })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(ENDPOINT)
    expect(init.headers).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ action: 'stats', code: 'code-1', deviceId: 'dev-1' })
  })

  it('管理者の端末一覧と、選んだ端末の集計を取る', async () => {
    const devices = respond({ ok: true, devices: [{ deviceId: 'a' }] })
    expect(await fetchDevices({ endpoint: ENDPOINT, access, adminCode: 'adm', fetchImpl: devices }))
      .toEqual({ ok: true, devices: [{ deviceId: 'a' }] })
    expect(JSON.parse(devices.mock.calls[0][1].body)).toEqual({ action: 'admin_devices', code: 'code-1', adminCode: 'adm' })

    const target = respond({ ok: true, stats: { streak: 1 } })
    expect(await fetchDeviceStats({ endpoint: ENDPOINT, access, adminCode: 'adm', targetDeviceId: 'a', fetchImpl: target }))
      .toEqual({ ok: true, stats: { streak: 1 } })
    expect(JSON.parse(target.mock.calls[0][1].body)).toEqual({
      action: 'admin_stats', code: 'code-1', adminCode: 'adm', targetDeviceId: 'a',
    })
  })

  it('端末一覧が空でも配列で返す', async () => {
    expect(await fetchDevices({ endpoint: ENDPOINT, access, adminCode: 'adm', fetchImpl: respond({ ok: true }) }))
      .toEqual({ ok: true, devices: [] })
  })

  it('statsとadmin_statsのrunsは不正行だけを捨て、旧GASのrunsなしもそのまま扱う', async () => {
    const own = respond({ ok: true, stats: { streak: 2, runs: [validRun, { ...validRun, hand: 'both' }] } })
    expect(await fetchStats({ endpoint: ENDPOINT, access, fetchImpl: own })).toEqual({
      ok: true, stats: { streak: 2, runs: [validRun] },
    })

    const admin = respond({ ok: true, stats: { streak: 3, runs: 'broken' } })
    expect(await fetchDeviceStats({
      endpoint: ENDPOINT, access, adminCode: 'adm', targetDeviceId: 'a', fetchImpl: admin,
    })).toEqual({ ok: true, stats: { streak: 3 } })
  })

  it.each([
    ['invalid', 'invalid'],
    ['invalid_admin', 'invalid_admin'],
    ['admin_not_configured', 'admin_not_configured'],
    ['locked', 'locked'],
    ['bad_request', 'server'],
    ['something_else', 'server'],
  ])('GASのエラー %s は reason %s にする', async (error, reason) => {
    expect(await fetchStats({ endpoint: ENDPOINT, access, fetchImpl: respond({ ok: false, error }) }))
      .toEqual({ ok: false, reason })
  })

  it('HTTPエラーはserver、通信失敗・JSONでない応答はnetwork', async () => {
    expect(await fetchStats({ endpoint: ENDPOINT, access, fetchImpl: respond({}, false) })).toEqual({ ok: false, reason: 'server' })
    expect(await fetchStats({ endpoint: ENDPOINT, access, fetchImpl: vi.fn().mockRejectedValue(new TypeError('offline')) }))
      .toEqual({ ok: false, reason: 'network' })
    const html = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('x') } })
    expect(await fetchStats({ endpoint: ENDPOINT, access, fetchImpl: html })).toEqual({ ok: false, reason: 'network' })
  })
})
