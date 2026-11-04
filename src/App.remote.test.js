import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sync = vi.hoisted(() => ({
  recordCompletion: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('./services/remoteSync.js', () => ({
  remoteSync: { recordCompletion: sync.recordCompletion, start: sync.start },
}))

const { default: App } = await import('./App.vue')
const { AUTO_ADVANCE_MS } = await import('./appConfig.js')
const { completeCurrentQuestion, startPractice } = await import('./test/app.js')

describe('App から練習記録を送る', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    sync.recordCompletion.mockReset().mockResolvedValue(true)
    sync.start.mockReset().mockReturnValue(sync.stop)
    sync.stop.mockReset()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('1問クリアごとに一度だけ記録を渡し、押し間違いを含める', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    const expected = wrapper.get('.prompt-text .current').text()
    const wrong = wrapper.findAll('.key').map((key) => key.attributes('data-key')).find((key) => key !== expected)
    await wrapper.get(`[data-key="${wrong}"]`).trigger('click')
    await completeCurrentQuestion(wrapper)

    expect(sync.recordCompletion).toHaveBeenCalledTimes(1)
    const record = sync.recordCompletion.mock.calls[0][0]
    expect(record).toMatchObject({
      hand: 'left',
      level: 1,
      includeSymbols: false,
      layout: 'jis',
      question: expected,
      mistakes: 1,
      attempts: 2,
      wrong: [[expected, wrong]],
    })
    expect(record.id).toBeTruthy()
    expect(typeof record.durationMs).toBe('number')

    // 自動で次の問題に進んでも、二重に記録しない
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()
    expect(sync.recordCompletion).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('次の問題の押し間違いは、前の問題の記録に混ざらない', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    const first = wrapper.get('.prompt-text .current').text()
    const wrongFirst = wrapper.findAll('.key').map((key) => key.attributes('data-key')).find((key) => key !== first)
    await wrapper.get(`[data-key="${wrongFirst}"]`).trigger('click')
    await completeCurrentQuestion(wrapper)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()

    await completeCurrentQuestion(wrapper)
    expect(sync.recordCompletion).toHaveBeenCalledTimes(2)
    expect(sync.recordCompletion.mock.calls[1][0].wrong).toEqual([])
    expect(sync.recordCompletion.mock.calls[1][0].mistakes).toBe(0)
    wrapper.unmount()
  })

  it('やり直しやリセットでは記録を送らない', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    const expected = wrapper.get('.prompt-text .current').text()
    // Lv.1は1文字でクリアになるので、誤タップのあとにやり直す
    const wrong = wrapper.findAll('.key').map((key) => key.attributes('data-key')).find((key) => key !== expected)
    await wrapper.get(`[data-key="${wrong}"]`).trigger('click')
    await wrapper.get('[data-testid="reset"]').trigger('click')
    expect(sync.recordCompletion).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('送信が失敗しても(例外・reject)練習は止まらず、クリア処理が続く', async () => {
    sync.recordCompletion.mockImplementationOnce(() => { throw new Error('boom') })
    const first = mount(App)
    await startPractice(first)
    await completeCurrentQuestion(first)
    expect(first.get('[data-testid="completed"]').text()).toBe('1問')
    first.unmount()

    localStorage.clear()
    sync.recordCompletion.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    const second = mount(App)
    await startPractice(second)
    await completeCurrentQuestion(second)
    expect(second.get('[data-testid="completed"]').text()).toBe('1問')
    second.unmount()
  })

  it('起動時に再送を開始し、アンマウントで停止する', () => {
    const wrapper = mount(App)
    expect(sync.start).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    expect(sync.stop).toHaveBeenCalledTimes(1)
  })
})
