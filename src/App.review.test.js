import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { REMOTE_ENDPOINT } from './remoteConfig.js'
import { ACCESS_KEY } from './services/access.js'

const emptyStats = {
  generatedAt: 0,
  totals: { records: 0, practiceMs: 0, attempts: 0, mistakes: 0, days: 0, firstDate: null, lastDate: null },
  today: { date: '2026-11-03', records: 0, practiceMs: 0, attempts: 0, mistakes: 0 },
  streak: 0,
  daily: [],
  keys: {},
  confusions: [],
}

describe('縦向きの振り返り画面の出し分け', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, stats: emptyStats }) }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('送信先が設定済みで、コード入力済みの端末では、回転案内の代わりに振り返り画面を出す', async () => {
    expect(REMOTE_ENDPOINT).not.toBe('')
    localStorage.setItem(ACCESS_KEY, JSON.stringify({ granted: true, code: 'abc12345', deviceId: 'dev-1', grantedAt: 1 }))
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('[data-testid="review-screen"]').exists()).toBe(true)
    expect(wrapper.find('.rotate-notice').exists()).toBe(false)
    // 起動時の設定画面は残っている(縦向きのときだけCSSで隠す)
    expect(wrapper.find('[data-testid="settings-screen"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('コード未入力(制限のない開発環境など)では、従来の回転案内のまま', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('.rotate-notice').exists()).toBe(true)
    expect(wrapper.find('[data-testid="review-screen"]').exists()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
