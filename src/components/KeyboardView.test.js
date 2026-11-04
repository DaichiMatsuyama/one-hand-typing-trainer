import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeyboardLayout } from '../data/keyboardLayouts.js'
import KeyboardView from './KeyboardView.vue'

function dispatchPointer(target, type, { pointerId = 1, pointerType = 'touch', button = 0 } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
  })
  ;(target.element ?? target).dispatchEvent(event)
  return nextTick()
}

function dispatchClick(target, detail) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail })
  ;(target.element ?? target).dispatchEvent(event)
  return nextTick()
}

describe('KeyboardView', () => {
  let wrapper

  function mountKeyboard(props = {}) {
    wrapper = mount(KeyboardView, {
      props: {
        layout: getKeyboardLayout('left'),
        ...props,
      },
    })
    return wrapper
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('pointerdownだけで押したキーを1回入力する', async () => {
    mountKeyboard()

    await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', { pointerId: 11 })

    expect(wrapper.emitted('press')).toEqual([['q']])
  })

  it('pointerdown後の合成clickでは二重入力しない', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 12 })
    await dispatchPointer(key, 'pointerup', { pointerId: 12 })
    await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toEqual([['q']])
  })

  it('ポインタを伴わないclickで入力する', async () => {
    mountKeyboard()

    await dispatchClick(wrapper.get('[data-key="q"]'), 0)

    expect(wrapper.emitted('press')).toEqual([['q']])
  })

  it('入力不可中に始まったpointerdownの合成clickを有効化後も入力しない', async () => {
    mountKeyboard({ disabled: true })
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 13 })
    await wrapper.setProps({ disabled: false })
    await dispatchPointer(key, 'pointerup', { pointerId: 13 })
    await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toBeUndefined()
    expect(key.attributes('aria-disabled')).toBeUndefined()
    expect(key.attributes('disabled')).toBeUndefined()
  })

  it('クリア中の合成clickを抑止して次問のポインタを伴わないclickは入力する', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 14 })
    await wrapper.setProps({ disabled: true })
    await vi.advanceTimersByTimeAsync(500)
    await dispatchPointer(key, 'pointerup', { pointerId: 14 })
    await dispatchClick(key, 1)
    await wrapper.setProps({ disabled: false })
    await dispatchClick(key, 0)

    expect(wrapper.emitted('press')).toEqual([['q'], ['q']])
  })

  it('キー外でpointerupしても直後の同じキーのdetail=0合成clickを抑止する', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 15 })
    await dispatchPointer(document, 'pointerup', { pointerId: 15 })
    await dispatchClick(key, 0)

    expect(wrapper.emitted('press')).toEqual([['q']])
  })

  it('同じキーの複数pointerIdをそれぞれ入力し合成clickだけを抑止する', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 16 })
    await dispatchPointer(key, 'pointerdown', { pointerId: 17 })
    await dispatchPointer(key, 'pointerup', { pointerId: 16 })
    await dispatchPointer(key, 'pointerup', { pointerId: 17 })
    await dispatchClick(key, 1)
    await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toEqual([['q'], ['q']])
  })

  it.each([400, 999])('%dms後の遅延した合成clickでも二重入力しない', async (delay) => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 18 })
    await dispatchPointer(key, 'pointerup', { pointerId: 18 })
    await vi.advanceTimersByTimeAsync(delay)
    await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toEqual([['q']])
  })

  it('1001ms後の合成clickは押下印の失効後なので入力する', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 19 })
    await dispatchPointer(key, 'pointerup', { pointerId: 19 })
    await vi.advanceTimersByTimeAsync(1001)
    await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toEqual([['q'], ['q']])
  })

  it('pointercancel直後の同じキーのdetail=0合成clickを抑止する', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 20 })
    await dispatchPointer(key, 'pointercancel', { pointerId: 20 })
    await dispatchClick(key, 0)

    expect(wrapper.emitted('press')).toEqual([['q']])
  })

  it.each([6000, 35000])('%dms長押ししてもpointerup後の合成clickで二重入力しない', async (delay) => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 21 })
    await vi.advanceTimersByTimeAsync(delay)
    await dispatchPointer(key, 'pointerup', { pointerId: 21 })
    await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toEqual([['q']])
  })

  it('pointerupから50ms後の同じキーのdetail=0合成clickを抑止する', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 22 })
    await dispatchPointer(key, 'pointerup', { pointerId: 22 })
    await vi.advanceTimersByTimeAsync(50)
    await dispatchClick(key, 0)

    expect(wrapper.emitted('press')).toEqual([['q']])
  })

  it('pointerupから150ms後のdetail=0 clickはキーボード操作として入力する', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 23 })
    await dispatchPointer(key, 'pointerup', { pointerId: 23 })
    await vi.advanceTimersByTimeAsync(150)
    await dispatchClick(key, 0)

    expect(wrapper.emitted('press')).toEqual([['q'], ['q']])
  })

  it('別キーの終了済み押下印ではdetail=0 clickを抑止せず印も消費しない', async () => {
    mountKeyboard()
    const qKey = wrapper.get('[data-key="q"]')
    const wKey = wrapper.get('[data-key="w"]')

    await dispatchPointer(qKey, 'pointerdown', { pointerId: 24 })
    await dispatchPointer(qKey, 'pointerup', { pointerId: 24 })
    await vi.advanceTimersByTimeAsync(50)
    await dispatchClick(wKey, 0)
    await dispatchClick(qKey, 1)

    expect(wrapper.emitted('press')).toEqual([['q'], ['w']])
  })

  it('別々のpointerIdによる4キーの同時押下をそれぞれ入力する', async () => {
    mountKeyboard()
    const keys = ['q', 'w', 'e', 'r']

    await Promise.all(keys.map((key, index) => (
      dispatchPointer(wrapper.get(`[data-key="${key}"]`), 'pointerdown', { pointerId: index + 30 })
    )))

    expect(wrapper.emitted('press')).toEqual(keys.map((key) => [key]))
  })

  it('入力不可の間は入力をemitせず、aria-disabledだけを付ける', async () => {
    mountKeyboard({ disabled: true })
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 40 })
    await dispatchClick(key, 0)

    expect(wrapper.emitted('press')).toBeUndefined()
    expect(key.attributes('aria-disabled')).toBe('true')
    expect(key.attributes('disabled')).toBeUndefined()
    expect(key.classes()).toContain('is-disabled')
  })

  it('入力不可中のdetail=0のclickは押下印を消費しない', async () => {
    mountKeyboard({ disabled: true })
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 41 })
    await dispatchClick(key, 0)
    await wrapper.setProps({ disabled: false })
    await dispatchPointer(key, 'pointerup', { pointerId: 41 })
    await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toBeUndefined()
  })

  it('pointerId再利用時は以前のキーの押下印を先に破棄する', async () => {
    mountKeyboard()
    const qKey = wrapper.get('[data-key="q"]')
    const wKey = wrapper.get('[data-key="w"]')

    await dispatchPointer(qKey, 'pointerdown', { pointerId: 50 })
    await dispatchPointer(qKey, 'pointerup', { pointerId: 50 })
    await dispatchPointer(wKey, 'pointerdown', { pointerId: 50 })
    await dispatchClick(qKey, 1)
    await dispatchPointer(wKey, 'pointerup', { pointerId: 50 })
    await dispatchClick(wKey, 1)

    expect(wrapper.emitted('press')).toEqual([['q'], ['w'], ['q']])
  })

  it('キーごとの押下印を8件に制限する', async () => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    for (let index = 0; index < 9; index += 1) {
      await dispatchPointer(key, 'pointerdown', { pointerId: 60 + index })
    }
    for (let index = 0; index < 9; index += 1) {
      await dispatchPointer(document, 'pointerup', { pointerId: 60 + index })
    }
    for (let index = 0; index < 9; index += 1) await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toHaveLength(10)
  })

  it.each(['pagehide', 'blur'])('%sで押下印とポインタ記録を破棄する', async (eventType) => {
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')

    await dispatchPointer(key, 'pointerdown', { pointerId: 70 })
    window.dispatchEvent(new Event(eventType))
    await dispatchClick(key, 1)

    expect(wrapper.emitted('press')).toEqual([['q'], ['q']])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('レイアウト差し替えで古いキー要素の押下印を破棄する', async () => {
    mountKeyboard()

    await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', { pointerId: 80 })
    expect(vi.getTimerCount()).toBe(1)

    await wrapper.setProps({ layout: getKeyboardLayout('right') })

    expect(vi.getTimerCount()).toBe(0)
  })

  it('破棄時に抑止タイマーと登録したリスナーを解除する', async () => {
    const documentRemoveListener = vi.spyOn(document, 'removeEventListener')
    const windowRemoveListener = vi.spyOn(window, 'removeEventListener')
    mountKeyboard()
    const key = wrapper.get('[data-key="q"]')
    const panel = wrapper.get('.keyboard-panel').element

    const activeGesture = new Event('gesturestart', { bubbles: true, cancelable: true })
    panel.dispatchEvent(activeGesture)
    expect(activeGesture.defaultPrevented).toBe(true)

    await dispatchPointer(key, 'pointerdown', { pointerId: 90 })
    await dispatchPointer(key, 'pointerup', { pointerId: 90 })
    expect(vi.getTimerCount()).toBe(2)

    wrapper.unmount()
    wrapper = undefined

    expect(vi.getTimerCount()).toBe(0)
    expect(documentRemoveListener).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(documentRemoveListener).toHaveBeenCalledWith('pointercancel', expect.any(Function))
    expect(windowRemoveListener).toHaveBeenCalledWith('pagehide', expect.any(Function))
    expect(windowRemoveListener).toHaveBeenCalledWith('blur', expect.any(Function))
    for (const type of ['gesturestart', 'gesturechange']) {
      const removedGesture = new Event(type, { bubbles: true, cancelable: true })
      panel.dispatchEvent(removedGesture)
      expect(removedGesture.defaultPrevented).toBe(false)
    }
    documentRemoveListener.mockRestore()
    windowRemoveListener.mockRestore()
  })

  it('マウスの右ボタンのpointerdownでは入力しない', async () => {
    mountKeyboard()

    await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', {
      pointerId: 50,
      pointerType: 'mouse',
      button: 2,
    })

    expect(wrapper.emitted('press')).toBeUndefined()
  })

  it('キーボード領域のcontextmenuとSafariジェスチャーを抑止する', () => {
    mountKeyboard()
    const panel = wrapper.get('.keyboard-panel').element

    for (const type of ['contextmenu', 'gesturestart', 'gesturechange']) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      panel.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  })
})
