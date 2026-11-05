import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LONG_PRESS_RESET_MS } from '../appConfig.js'
import ResultView from './ResultView.vue'

function mountView(props = {}) {
  return mount(ResultView, {
    props: { elapsedText: '0:05', accuracy: 100, mistakes: 0, isComplete: false, ...props },
  })
}

describe('ResultView のホームポジション確認中', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('確認中でなければ、タップでやり直し・長押しで全リセットを通知する', async () => {
    const wrapper = mountView()
    const reset = wrapper.get('[data-testid="reset"]')
    expect(reset.attributes('aria-disabled')).toBeUndefined()
    await reset.trigger('click')
    expect(wrapper.emitted('reset')).toHaveLength(1)

    await reset.trigger('pointerdown', { button: 0 })
    vi.advanceTimersByTime(LONG_PRESS_RESET_MS)
    expect(wrapper.emitted('reset-all')).toHaveLength(1)
  })

  it('確認中は「やり直す」をaria-disabledにし、タップも長押しも通知しない(nativeのdisabledは使わない)', async () => {
    const wrapper = mountView({ isComplete: true, homeChecking: true })
    const reset = wrapper.get('[data-testid="reset"]')
    expect(reset.attributes('aria-disabled')).toBe('true')
    expect(reset.attributes('disabled')).toBeUndefined()
    expect(reset.classes()).toContain('is-disabled')

    await reset.trigger('click')
    await reset.trigger('pointerdown', { button: 0 })
    vi.advanceTimersByTime(LONG_PRESS_RESET_MS * 2)
    expect(wrapper.emitted('reset')).toBeUndefined()
    expect(wrapper.emitted('reset-all')).toBeUndefined()
    expect(reset.classes()).not.toContain('pressing')
  })

  it('確認中の読み上げは「自動で進みます」と言わず、案内は出題欄に任せる', () => {
    expect(mountView({ isComplete: true }).get('.feedback').text())
      .toBe('クリア！ 自動で次の問題に進みます')
    expect(mountView({ isComplete: true, homeChecking: true }).get('.feedback').text())
      .toBe('クリア！')
  })
})
