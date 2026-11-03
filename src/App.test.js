import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { STORAGE_KEY } from './services/storage.js'

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('左右切替で表示キーと問題を切り替える', async () => {
    const wrapper = mount(App)
    expect(wrapper.find('[data-key="a"]').exists()).toBe(true)
    expect(wrapper.find('[data-key="j"]').exists()).toBe(false)

    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    expect(wrapper.find('[data-key="a"]').exists()).toBe(false)
    expect(wrapper.find('[data-key="j"]').exists()).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).settings.hand).toBe('right')
    wrapper.unmount()
  })

  it('レベル切替で指定範囲の長さの問題にリセットする', async () => {
    const wrapper = mount(App)
    expect(wrapper.get('.prompt-text').text()).toHaveLength(1)

    await wrapper.get('[data-testid="level-2"]').trigger('click')
    expect(wrapper.get('.prompt-text').text().length).toBeGreaterThanOrEqual(3)
    expect(wrapper.get('.prompt-text').text().length).toBeLessThanOrEqual(5)

    await wrapper.get('[data-testid="level-3"]').trigger('click')
    expect(wrapper.get('.prompt-text').text().length).toBeGreaterThanOrEqual(5)
    expect(wrapper.get('.prompt-text').text().length).toBeLessThanOrEqual(10)
    wrapper.unmount()
  })

  it('やり直しで現在位置・ミス・時間をリセットする', async () => {
    const wrapper = mount(App)
    const expected = wrapper.get('.prompt-text .current').text()
    const wrongKey = expected === 'a' ? 's' : 'a'
    await wrapper.get(`[data-key="${wrongKey}"]`).trigger('click')
    expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('1')

    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:02')

    await wrapper.get('[data-testid="reset"]').trigger('click')
    expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('0')
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:00')
    expect(wrapper.get('.prompt-text .current').exists()).toBe(true)
    wrapper.unmount()
  })

  it('保存済み設定・結果・途中位置を再マウント時に復元する', async () => {
    const first = mount(App)
    await first.get('[data-testid="hand-right"]').trigger('click')
    await first.get('[data-testid="level-2"]').trigger('click')
    const expected = first.get('.prompt-text .current').text()
    await first.get(`[data-key="${expected}"]`).trigger('click')
    expect(first.findAll('.prompt-text .done')).toHaveLength(1)
    first.unmount()

    const restored = mount(App)
    expect(restored.get('[data-testid="hand-right"]').attributes('aria-pressed')).toBe('true')
    expect(restored.get('[data-testid="level-2"]').attributes('aria-pressed')).toBe('true')
    expect(restored.findAll('.prompt-text .done')).toHaveLength(1)
    restored.unmount()
  })

  it('左手では記号設定を無効化し、右手で設定した値は保持する', async () => {
    const wrapper = mount(App)
    const symbolSetting = wrapper.get('[data-testid="include-symbols"]')
    expect(symbolSetting.element.disabled).toBe(true)
    expect(wrapper.get('.symbol-toggle').text()).toContain('右手のみ')

    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    expect(symbolSetting.element.disabled).toBe(false)
    await symbolSetting.setValue(true)

    await wrapper.get('[data-testid="hand-left"]').trigger('click')
    expect(symbolSetting.element.disabled).toBe(true)
    expect(symbolSetting.element.checked).toBe(true)
    wrapper.unmount()
  })

  it('画面がhiddenの間は計時を止め、hidden時点を保存する', async () => {
    const wrapper = mount(App)
    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:02')

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    const hiddenSnapshot = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(hiddenSnapshot.session.elapsedMs).toBe(2000)
    expect(hiddenSnapshot.session.isPaused).toBe(true)

    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:02')

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:03')
    wrapper.unmount()
  })
})
