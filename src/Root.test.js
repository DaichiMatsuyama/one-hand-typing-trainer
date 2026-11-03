import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Root from './Root.vue'
import { ACCESS_KEY } from './services/access.js'

const ENDPOINT = 'https://script.google.com/macros/s/test/exec'

function setLocation(search) {
  window.history.replaceState({}, '', `/${search}`)
}

describe('Root(利用制限)', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: false })
  })

  afterEach(() => {
    setLocation('')
  })

  it('送信先が未設定なら制限なしで練習画面が出る', () => {
    const wrapper = mount(Root, { props: { endpoint: '' } })
    expect(wrapper.find('.keyboard').exists()).toBe(true)
    expect(wrapper.find('[data-testid="access-gate"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('localhostでは送信先があっても制限しない', () => {
    const wrapper = mount(Root, { props: { endpoint: ENDPOINT } })
    expect(wrapper.find('.keyboard').exists()).toBe(true)
    wrapper.unmount()
  })

  it('?forceGate=1のSafari相当では、練習画面を出さず追加手順だけを出す', () => {
    setLocation('?forceGate=1')
    const wrapper = mount(Root, { props: { endpoint: ENDPOINT } })
    expect(wrapper.get('[data-testid="access-gate"]').attributes('data-mode')).toBe('need-standalone')
    expect(wrapper.find('.keyboard').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ホーム画面起動でコード未入力なら入力画面、入力済みなら練習画面', () => {
    setLocation('?forceGate=1')
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true })

    const needCode = mount(Root, { props: { endpoint: ENDPOINT } })
    expect(needCode.get('[data-testid="access-gate"]').attributes('data-mode')).toBe('need-code')
    expect(needCode.find('.keyboard').exists()).toBe(false)
    needCode.unmount()

    localStorage.setItem(ACCESS_KEY, JSON.stringify({ granted: true, code: 'abc12345', deviceId: 'dev-1', grantedAt: 1 }))
    const open = mount(Root, { props: { endpoint: ENDPOINT } })
    expect(open.find('.keyboard').exists()).toBe(true)
    expect(open.find('[data-testid="access-gate"]').exists()).toBe(false)
    open.unmount()
  })

  it('コード入力に成功すると、その場で練習画面に切り替わる', async () => {
    setLocation('?forceGate=1')
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true })
    const wrapper = mount(Root, { props: { endpoint: ENDPOINT } })
    await wrapper.getComponent({ name: 'AccessGate' }).vm.$emit('granted')
    expect(wrapper.find('.keyboard').exists()).toBe(true)
    wrapper.unmount()
  })
})
