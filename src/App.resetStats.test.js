import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { AUTO_ADVANCE_MS, LONG_PRESS_RESET_MS } from './appConfig.js'
import { STORAGE_KEY } from './services/storage.js'
import { completeCurrentQuestion, openPracticeMenu, startPractice } from './test/app.js'

async function tapWrongKey(wrapper) {
  const expected = wrapper.get('.prompt-text .current').text()
  const wrong = wrapper.findAll('.key').map((key) => key.attributes('data-key')).find((key) => key !== expected)
  await wrapper.get(`[data-key="${wrong}"]`).trigger('click')
}

const stat = (wrapper, testid) => wrapper.get(`[data-testid="${testid}"]`).text()

describe('今回の成績とやり直すボタン', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('問題が自動で進んでも、時間・正答率・ミス・クリア数は今回に積み上がる', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await tapWrongKey(wrapper)
    await completeCurrentQuestion(wrapper)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()

    expect(stat(wrapper, 'completed')).toBe('1問')
    expect(stat(wrapper, 'mistakes')).toBe('1')
    expect(stat(wrapper, 'accuracy')).toBe('50%')

    await tapWrongKey(wrapper)
    expect(stat(wrapper, 'mistakes')).toBe('2')
    wrapper.unmount()
  })

  it('クリア済みの問題を今回の成績に二重加算しない', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    expect(stat(wrapper, 'completed')).toBe('1問')
    expect(stat(wrapper, 'accuracy')).toBe('100%')
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()
    expect(stat(wrapper, 'completed')).toBe('1問')
    expect(stat(wrapper, 'accuracy')).toBe('100%')
    wrapper.unmount()
  })

  it('短いタップは今の問題だけやり直し、進行中の時間・ミス・タップ数も今回に残る', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()
    await tapWrongKey(wrapper)
    vi.advanceTimersByTime(2_500)

    const reset = wrapper.get('[data-testid="reset"]')
    await reset.trigger('pointerdown')
    vi.advanceTimersByTime(LONG_PRESS_RESET_MS - 100)
    await reset.trigger('pointerup')
    await reset.trigger('click')

    expect(wrapper.findAll('.prompt-text .done')).toHaveLength(0)
    expect(stat(wrapper, 'completed')).toBe('1問')
    expect(stat(wrapper, 'mistakes')).toBe('1')
    expect(stat(wrapper, 'accuracy')).toBe('50%')
    expect(stat(wrapper, 'elapsed')).toBe('0:03')
    wrapper.unmount()
  })

  it('設定へ戻ると進行中の成績を内部累計へ一度だけ移し、始め直した今回はゼロになる', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await tapWrongKey(wrapper)
    vi.advanceTimersByTime(3_000)
    await openPracticeMenu(wrapper)
    await wrapper.get('[data-testid="menu-to-settings"]').trigger('click')
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    await wrapper.get('[data-testid="level-2"]').trigger('click')
    await wrapper.get('[data-testid="include-symbols"]').setValue(true)
    await startPractice(wrapper)
    expect(stat(wrapper, 'mistakes')).toBe('0')
    expect(stat(wrapper, 'accuracy')).toBe('100%')
    expect(stat(wrapper, 'elapsed')).toBe('0:00')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(saved.results.mistakes).toBe(1)
    expect(saved.results.attempts).toBe(1)
    expect(saved.results.practiceMs).toBe(3000)
    wrapper.unmount()
  })

  it('短いタップで移した進行中成績を、次の設定変更で二重加算しない', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await tapWrongKey(wrapper)
    await wrapper.get('[data-testid="reset"]').trigger('click')
    expect(stat(wrapper, 'mistakes')).toBe('1')

    await openPracticeMenu(wrapper)
    await wrapper.get('[data-testid="menu-to-settings"]').trigger('click')
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    await startPractice(wrapper)
    expect(stat(wrapper, 'mistakes')).toBe('0')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(saved.results.mistakes).toBe(1)
    expect(saved.results.attempts).toBe(1)
    wrapper.unmount()
  })

  it('長押しで今回の成績をゼロに戻し、直後のclickでは二重に処理しない', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()
    await tapWrongKey(wrapper)
    expect(stat(wrapper, 'completed')).toBe('1問')

    const reset = wrapper.get('[data-testid="reset"]')
    await reset.trigger('pointerdown')
    expect(reset.classes()).toContain('pressing')
    vi.advanceTimersByTime(LONG_PRESS_RESET_MS)
    await wrapper.vm.$nextTick()
    expect(reset.classes()).not.toContain('pressing')
    await reset.trigger('pointerup')
    await reset.trigger('click')

    expect(stat(wrapper, 'completed')).toBe('0問')
    expect(stat(wrapper, 'mistakes')).toBe('0')
    expect(stat(wrapper, 'accuracy')).toBe('100%')
    expect(stat(wrapper, 'elapsed')).toBe('0:00')
    expect(wrapper.get('.result-bar .feedback').text()).toBe('今回の成績をリセットしました')
    expect(wrapper.get('#reset-hint').text()).toContain('今回の時間・正答率・ミス・クリア数')

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(saved.results.completedQuestions).toBe(0)
    expect(saved.results.attempts).toBe(0)

    // 次の通常タップは通常のやり直しとして扱われる(長押しフラグが残らない)
    await tapWrongKey(wrapper)
    await reset.trigger('pointerdown')
    await reset.trigger('pointerup')
    await reset.trigger('click')
    expect(stat(wrapper, 'mistakes')).toBe('1')
    wrapper.unmount()
  })

  it('長押しの途中で指を離す/外れると成績リセットは走らない', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="level-2"]').trigger('click')
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()

    const expected = wrapper.get('.prompt-text .current').text()
    await wrapper.get(`[data-key="${expected}"]`).trigger('click')
    expect(wrapper.findAll('.prompt-text .done')).toHaveLength(1)

    const reset = wrapper.get('[data-testid="reset"]')
    await reset.trigger('pointerdown')
    vi.advanceTimersByTime(LONG_PRESS_RESET_MS / 2)
    await reset.trigger('pointerleave')
    vi.advanceTimersByTime(LONG_PRESS_RESET_MS * 2)
    await wrapper.vm.$nextTick()
    await reset.trigger('click')
    expect(stat(wrapper, 'completed')).toBe('1問')
    expect(wrapper.findAll('.prompt-text .done')).toHaveLength(1)
    expect(reset.classes()).not.toContain('pressing')

    // 次のpointerdownでキャンセルフラグが解除され、通常のタップとして使える。
    await reset.trigger('pointerdown')
    await reset.trigger('pointerup')
    await reset.trigger('click')
    expect(wrapper.findAll('.prompt-text .done')).toHaveLength(0)
    wrapper.unmount()
  })

  it('保存済みの累計は再読み込みしても内部に残り、新しい今回はゼロになる', async () => {
    const first = mount(App)
    await startPractice(first)
    await completeCurrentQuestion(first)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await first.vm.$nextTick()
    first.unmount()

    const second = mount(App)
    await startPractice(second)
    expect(stat(second, 'completed')).toBe('0問')
    expect(stat(second, 'accuracy')).toBe('100%')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).results.completedQuestions).toBe(1)
    second.unmount()
  })
})
