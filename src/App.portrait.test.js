import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sync = vi.hoisted(() => ({
  recordCompletion: vi.fn(),
  start: vi.fn(),
}))

vi.mock('./services/remoteSync.js', () => ({
  remoteSync: { recordCompletion: sync.recordCompletion, start: sync.start },
}))

const { default: App } = await import('./App.vue')
const { AUTO_ADVANCE_MS } = await import('./appConfig.js')
const { startPractice } = await import('./test/app.js')

// 縦向き(練習画面が隠れる)の状態を、テストから切り替えられるmatchMediaの代用品
function installMatchMedia(initialPortrait) {
  const state = {
    portrait: initialPortrait,
    listeners: new Set(),
    set(value) {
      state.portrait = value
      state.listeners.forEach((listener) => listener({ matches: value }))
    },
    // 向きの変更イベントが届かない環境(値だけが変わる)
    setSilently(value) {
      state.portrait = value
    },
  }
  window.matchMedia = vi.fn((query) => {
    if (query.includes('orientation: portrait')) {
      return {
        get matches() { return state.portrait },
        media: query,
        addEventListener: (_type, listener) => state.listeners.add(listener),
        removeEventListener: (_type, listener) => state.listeners.delete(listener),
      }
    }
    return { matches: false, media: query, addEventListener() {}, removeEventListener() {} }
  })
  return state
}

const elapsed = (wrapper) => wrapper.get('[data-testid="elapsed"]').text()

async function tick(wrapper, ms) {
  vi.advanceTimersByTime(ms)
  await wrapper.vm.$nextTick()
}

describe('縦向きの間は練習時間を止める', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    sync.recordCompletion.mockReset().mockResolvedValue(true)
    sync.start.mockReset().mockReturnValue(() => {})
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    delete window.matchMedia
  })

  it('縦向きにしている間は時間が進まず、横向きに戻すと続きから数える', async () => {
    const orientation = installMatchMedia(false)
    const wrapper = mount(App)
    await startPractice(wrapper)
    await tick(wrapper, 5000)
    expect(elapsed(wrapper)).toBe('0:05')

    orientation.set(true)
    await tick(wrapper, 120_000)
    expect(elapsed(wrapper)).toBe('0:05')

    orientation.set(false)
    await tick(wrapper, 3000)
    expect(elapsed(wrapper)).toBe('0:08')
    wrapper.unmount()
  })

  it('縦向きのまま起動したときも、時間は進まない', async () => {
    const orientation = installMatchMedia(true)
    const wrapper = mount(App)
    await startPractice(wrapper)
    await tick(wrapper, 30_000)
    expect(elapsed(wrapper)).toBe('0:00')

    orientation.set(false)
    await tick(wrapper, 2000)
    expect(elapsed(wrapper)).toBe('0:02')
    wrapper.unmount()
  })

  it('クリア直後に縦向きにしても、次の問題の時間は横向きに戻すまで始まらない', async () => {
    const orientation = installMatchMedia(false)
    const wrapper = mount(App)
    await startPractice(wrapper)
    const expected = wrapper.get('.prompt-text .current').text()
    await tick(wrapper, 2000)
    await wrapper.get(`[data-key="${expected}"]`).trigger('click') // Lv.1は1文字でクリア
    expect(elapsed(wrapper)).toBe('0:02')

    orientation.set(true)
    // 画面の時間表示は1秒ごとに更新されるので、秒の区切りにそろえる
    await tick(wrapper, AUTO_ADVANCE_MS)
    await tick(wrapper, 1000 - AUTO_ADVANCE_MS)
    await tick(wrapper, 60_000)
    expect(elapsed(wrapper)).toBe('0:02')

    orientation.set(false)
    await tick(wrapper, 4000)
    expect(elapsed(wrapper)).toBe('0:06')
    wrapper.unmount()
  })

  it('スプレッドシートへ送る1問ごとの所要時間に、縦向きの間の時間を含めない', async () => {
    const orientation = installMatchMedia(false)
    const wrapper = mount(App)
    await startPractice(wrapper)
    const expected = wrapper.get('.prompt-text .current').text()
    await tick(wrapper, 2000)
    orientation.set(true)
    await tick(wrapper, 90_000)
    orientation.set(false)
    await tick(wrapper, 1000)
    await wrapper.get(`[data-key="${expected}"]`).trigger('click')

    expect(sync.recordCompletion).toHaveBeenCalledTimes(1)
    expect(sync.recordCompletion.mock.calls[0][0].durationMs).toBe(3000)
    wrapper.unmount()
  })

  it('向きの変更イベントが届かなくても、1秒ごとの確認で停止・再開する', async () => {
    const orientation = installMatchMedia(false)
    const wrapper = mount(App)
    await startPractice(wrapper)
    await tick(wrapper, 5000)
    expect(elapsed(wrapper)).toBe('0:05')

    orientation.setSilently(true)
    await tick(wrapper, 1000) // 次の確認で停止(この1秒は数える)
    await tick(wrapper, 60_000)
    expect(elapsed(wrapper)).toBe('0:06')

    orientation.setSilently(false)
    await tick(wrapper, 1000) // 次の確認で再開
    await tick(wrapper, 3000)
    expect(elapsed(wrapper)).toBe('0:09')
    wrapper.unmount()
  })

  it('縦向きの間も、アプリが隠れたときと同じく状態を保存し、アンマウントで監視を外す', async () => {
    const orientation = installMatchMedia(false)
    const wrapper = mount(App)
    await startPractice(wrapper)
    await tick(wrapper, 1000)
    orientation.set(true)
    const saved = JSON.parse(localStorage.getItem('one-hand-typing-trainer:v1'))
    expect(saved.session.isPaused).toBe(true)
    expect(orientation.listeners.size).toBeGreaterThan(0)
    wrapper.unmount()
    expect(orientation.listeners.size).toBe(0)
  })
})
