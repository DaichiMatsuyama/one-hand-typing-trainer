import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getKeyboardLayout } from '../data/keyboardLayouts.js'
import KeyboardView from './KeyboardView.vue'

const originalMatchMedia = window.matchMedia

function touchRipples() {
  return [...document.body.querySelectorAll('.touch-ripple')]
}

function dispatchPointer(target, type, {
  pointerId = 1,
  pointerType = 'touch',
  button = 0,
  clientX = 0,
  clientY = 0,
} = {}) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button,
    clientX,
    clientY,
  })
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
    if (originalMatchMedia) window.matchMedia = originalMatchMedia
    else delete window.matchMedia
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
    mountKeyboard({ touchRipple: false })

    await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', { pointerId: 80 })
    expect(vi.getTimerCount()).toBe(1)

    await wrapper.setProps({ layout: getKeyboardLayout('right') })

    expect(vi.getTimerCount()).toBe(0)
  })

  it('破棄時に抑止タイマーと登録したリスナーを解除する', async () => {
    const documentRemoveListener = vi.spyOn(document, 'removeEventListener')
    const windowRemoveListener = vi.spyOn(window, 'removeEventListener')
    mountKeyboard({ touchRipple: false })
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

  describe('タッチ位置の水滴演出', () => {
    it('正解と不正解のキーを色分けし、pointerdown座標へ入力emit後に表示する', async () => {
      mountKeyboard({ nextKey: 'q' })

      await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', {
        pointerId: 101, clientX: 125, clientY: 66,
      })
      await dispatchPointer(wrapper.get('[data-key="w"]'), 'pointerdown', {
        pointerId: 102, clientX: 225, clientY: 76,
      })

      expect(wrapper.emitted('press')).toEqual([['q'], ['w']])
      expect(touchRipples()).toHaveLength(2)
      expect(touchRipples()[0].classList).toContain('is-correct')
      expect(touchRipples()[0].style.left).toBe('125px')
      expect(touchRipples()[0].style.top).toBe('66px')
      expect(touchRipples()[1].classList).toContain('is-incorrect')
      expect(touchRipples()[1].style.left).toBe('225px')
      expect(touchRipples()[1].style.top).toBe('76px')
    })

    it('キー外と入力不可の通常キーはグレーにする', async () => {
      mountKeyboard({ nextKey: 'q' })
      await dispatchPointer(wrapper.get('.keyboard-stage'), 'pointerdown', {
        pointerId: 103, clientX: 12, clientY: 34,
      })
      await wrapper.setProps({ disabled: true })
      await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', {
        pointerId: 104, clientX: 56, clientY: 78,
      })

      expect(touchRipples()).toHaveLength(2)
      expect(touchRipples().every((ripple) => ripple.classList.contains('is-neutral'))).toBe(true)
    })

    it('同時表示は6個までとし、7個目で最古を消す', async () => {
      mountKeyboard({ nextKey: 'q' })
      const key = wrapper.get('[data-key="q"]')
      for (let index = 0; index < 7; index += 1) {
        await dispatchPointer(key, 'pointerdown', {
          pointerId: 110 + index,
          clientX: 10 + index,
          clientY: 20 + index,
        })
      }

      expect(touchRipples()).toHaveLength(6)
      expect(touchRipples().map((ripple) => ripple.style.left))
        .toEqual(['11px', '12px', '13px', '14px', '15px', '16px'])
    })

    it('アニメーション終了または600msのタイマーで確実に消す', async () => {
      mountKeyboard({ nextKey: 'q' })
      await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', { pointerId: 120 })
      expect(touchRipples()).toHaveLength(1)

      touchRipples()[0].dispatchEvent(new Event('animationend'))
      await nextTick()
      expect(touchRipples()).toHaveLength(0)

      await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', { pointerId: 121 })
      await vi.advanceTimersByTimeAsync(599)
      expect(touchRipples()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(touchRipples()).toHaveLength(0)
    })

    it('停止・画面喪失・アンマウントで輪とタイマーをすべて消す', async () => {
      mountKeyboard({ nextKey: 'q' })
      const key = wrapper.get('[data-key="q"]')
      await dispatchPointer(key, 'pointerdown', { pointerId: 130 })
      await wrapper.setProps({ homePositionPaused: true })
      expect(touchRipples()).toHaveLength(0)

      await wrapper.setProps({ homePositionPaused: false })
      await dispatchPointer(key, 'pointerdown', { pointerId: 131 })
      window.dispatchEvent(new Event('pagehide'))
      await nextTick()
      expect(touchRipples()).toHaveLength(0)

      await dispatchPointer(key, 'pointerdown', { pointerId: 132 })
      wrapper.unmount()
      wrapper = undefined
      expect(touchRipples()).toHaveLength(0)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('touchRipple=falseではDOMを作らない', async () => {
      mountKeyboard({ nextKey: 'q', touchRipple: false })
      await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', { pointerId: 140 })
      await dispatchPointer(wrapper.get('.keyboard-stage'), 'pointerdown', { pointerId: 141 })
      expect(wrapper.emitted('press')).toEqual([['q']])
      expect(touchRipples()).toHaveLength(0)
    })

    it('reduced-motionでは広がらない小さな円を300msだけ表示する', async () => {
      window.matchMedia = vi.fn(() => ({ matches: true }))
      mountKeyboard({ nextKey: 'q' })
      await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', { pointerId: 150 })

      expect(touchRipples()).toHaveLength(1)
      expect(touchRipples()[0].classList).toContain('is-reduced-motion')
      await vi.advanceTimersByTimeAsync(299)
      expect(touchRipples()).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(touchRipples()).toHaveLength(0)
    })

    it('輪はaria-hiddenでpointer-eventsを受け取らない', async () => {
      mountKeyboard({ nextKey: 'q' })
      await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', { pointerId: 160 })
      const ripple = touchRipples()[0]
      expect(ripple.getAttribute('aria-hidden')).toBe('true')
      expect(ripple.classList).toContain('touch-ripple')
    })
  })

  describe('ホームポジション確認の検出', () => {
    const LEFT_HOME = ['a', 's', 'd', 'f']

    function mountCheck(props = {}) {
      return mountKeyboard({
        disabled: true,
        homePosition: { id: 1, keys: LEFT_HOME, established: false },
        ...props,
      })
    }

    const press = (key, pointerId) => (
      dispatchPointer(wrapper.get(`[data-key="${key}"]`), 'pointerdown', { pointerId })
    )
    const lift = (key, pointerId, type = 'pointerup') => (
      dispatchPointer(wrapper.get(`[data-key="${key}"]`), type, { pointerId })
    )
    const established = () => wrapper.emitted('home-established')?.length ?? 0
    const released = () => wrapper.emitted('home-released')?.length ?? 0

    function rect(left, top, width, height) {
      return {
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        toJSON: () => {},
      }
    }

    function mockHomeGeometry(keys = LEFT_HOME) {
      vi.spyOn(wrapper.get('.keyboard-panel').element, 'getBoundingClientRect')
        .mockReturnValue(rect(0, 0, 600, 300))
      keys.forEach((key, index) => {
        vi.spyOn(wrapper.get(`[data-key="${key}"]`).element, 'getBoundingClientRect')
          .mockReturnValue(rect(100 + index * 100, 100, 90, 90))
      })
    }

    const touchPanel = (point, pointerId = 1) => dispatchPointer(
      wrapper.get('.keyboard-stage'),
      'pointerdown',
      { pointerId, ...point },
    )

    it('採用された対象キーと許容範囲内の隙間は認識色、対象外キーはグレーにする', async () => {
      mountCheck()
      mockHomeGeometry()
      await press('a', 171)
      await press('q', 172)
      await touchPanel({ clientX: 195, clientY: 145 }, 173)

      expect(touchRipples()).toHaveLength(3)
      expect(touchRipples()[0].classList).toContain('is-recognized')
      expect(touchRipples()[1].classList).toContain('is-neutral')
      expect(touchRipples()[2].classList).toContain('is-recognized')
    })

    it('4つの対象キーに順番に指を置くと、4本目で成立する(3本では成立しない)', async () => {
      mountCheck()
      await press('a', 1)
      await press('s', 2)
      await press('d', 3)
      expect(established()).toBe(0)
      await press('f', 4)
      expect(established()).toBe(1)
      expect(released()).toBe(0)
    })

    it('置く順番は問わず、同時に置いても成立する', async () => {
      mountCheck()
      await Promise.all(['f', 'd', 's', 'a'].map((key, index) => press(key, 10 + index)))
      expect(established()).toBe(1)
    })

    it('右手の対象キーは J K L ;', async () => {
      mountCheck({
        layout: getKeyboardLayout('right'),
        homePosition: { id: 1, keys: ['j', 'k', 'l', ';'], established: false },
      })
      await Promise.all([['j', 1], ['k', 2], ['l', 3], [';', 4]].map(([key, id]) => press(key, id)))
      expect(established()).toBe(1)
    })

    it.each([
      ['キーの隙間', { clientX: 195, clientY: 145 }],
      ['Aの左外側からパネル端まで', { clientX: 20, clientY: 145 }],
      ['ホーム段の縦方向の余裕', { clientX: 145, clientY: 78 }],
    ])('%sの接触を最寄りのAへの接触として成立に使う', async (_label, point) => {
      mountCheck()
      mockHomeGeometry()
      await touchPanel(point, 1)
      await Promise.all(['s', 'd', 'f'].map((key, index) => press(key, index + 2)))
      expect(established()).toBe(1)
    })

    it('通常の許容距離と外側端の縦範囲を超えた接触は無視する', async () => {
      mountCheck()
      mockHomeGeometry()
      await touchPanel({ clientX: 145, clientY: 65 }, 1)
      await touchPanel({ clientX: 20, clientY: 70 }, 2)
      await Promise.all(['s', 'd', 'f'].map((key, index) => press(key, index + 3)))
      expect(established()).toBe(0)
    })

    it('ほかの行と対象外のキー要素上では拡張判定しない', async () => {
      mountCheck()
      mockHomeGeometry()
      await press('q', 1)
      await press('g', 2)
      await Promise.all(['s', 'd', 'f'].map((key, index) => press(key, index + 3)))
      expect(established()).toBe(0)
      expect(wrapper.emitted('press')).toBeUndefined()
    })

    it('確認中でないときはパネル余白のpointerdownを入力にも接触にも使わない', async () => {
      mountKeyboard()
      await touchPanel({ clientX: 20, clientY: 145 }, 1)
      expect(established()).toBe(0)
      expect(wrapper.emitted('press')).toBeUndefined()
    })

    it('停止中はパネル余白の接触を追跡しない', async () => {
      mountCheck({ homePositionPaused: true })
      mockHomeGeometry()
      await touchPanel({ clientX: 20, clientY: 145 }, 1)
      await wrapper.setProps({ homePositionPaused: false })
      await Promise.all(['s', 'd', 'f'].map((key, index) => press(key, index + 2)))
      expect(established()).toBe(0)
    })

    it('パネル余白から始まった接触も同じpointerIdの離脱で成功する', async () => {
      mountCheck()
      mockHomeGeometry()
      await touchPanel({ clientX: 20, clientY: 145 }, 1)
      await Promise.all(['s', 'd', 'f'].map((key, index) => press(key, index + 2)))
      expect(established()).toBe(1)
      await dispatchPointer(document, 'pointerup', { pointerId: 1 })
      expect(released()).toBe(1)
    })

    it('右手でもセミコロンの右外側からパネル端までを対称に扱う', async () => {
      const rightHome = ['j', 'k', 'l', ';']
      mountCheck({
        layout: getKeyboardLayout('right'),
        homePosition: { id: 1, keys: rightHome, established: false },
      })
      mockHomeGeometry(rightHome)
      await touchPanel({ clientX: 580, clientY: 145 }, 4)
      await Promise.all(['j', 'k', 'l'].map((key, index) => press(key, index + 1)))
      expect(established()).toBe(1)
    })

    it('対象外のキーや余分な接触は無視し、通常の入力としても数えない', async () => {
      mountCheck()
      await press('q', 20)
      await press('g', 21)
      await press('a', 1)
      await press('s', 2)
      await press('z', 22)
      await press('d', 3)
      expect(established()).toBe(0)
      await press('f', 4)
      await press('b', 23)
      expect(established()).toBe(1)
      // 確認中は通常入力のpressを一切emitしない
      expect(wrapper.emitted('press')).toBeUndefined()
    })

    it('対象外の接触を離しても成功にしない(成立に使った接触だけが対象)', async () => {
      mountCheck()
      await press('q', 20)
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      await lift('q', 20)
      expect(released()).toBe(0)
    })

    it('同じキーを2本の接触で押しても1キーとして数える', async () => {
      mountCheck()
      await press('a', 1)
      await press('a', 2)
      await press('s', 3)
      await press('d', 4)
      expect(established()).toBe(0)
      await press('f', 5)
      expect(established()).toBe(1)
    })

    it('同じキーの余分な接触(成立に使っていない方)を離しても成功にしない', async () => {
      mountCheck()
      await press('a', 1)
      await press('a', 2)
      await press('s', 3)
      await press('d', 4)
      await press('f', 5)
      await lift('a', 2)
      expect(released()).toBe(0)
      await lift('a', 1)
      expect(released()).toBe(1)
    })

    it.each(LEFT_HOME)('成立後に%sの接触を離すと、その1本で成功を通知する', async (releasedKey) => {
      mountCheck()
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      await lift(releasedKey, LEFT_HOME.indexOf(releasedKey) + 1)
      expect(released()).toBe(1)
      // 残りの指を離しても二重に通知しない
      for (const key of LEFT_HOME.filter((item) => item !== releasedKey)) {
        await lift(key, LEFT_HOME.indexOf(key) + 1)
      }
      expect(released()).toBe(1)
    })

    it('キー外で離しても(document上のpointerup)成功を通知する', async () => {
      mountCheck()
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      await dispatchPointer(document, 'pointerup', { pointerId: 3 })
      expect(released()).toBe(1)
    })

    it('成立前に離した接触は外すだけで、成立も成功も通知しない(置き直すと成立する)', async () => {
      mountCheck()
      await press('a', 1)
      await press('s', 2)
      await press('d', 3)
      await lift('a', 1)
      await press('f', 4)
      expect(established()).toBe(0)
      expect(released()).toBe(0)
      await press('a', 5)
      expect(established()).toBe(1)
      expect(released()).toBe(0)
    })

    it('pointercancelも離したものとして扱う(成立前は外すだけ、成立後は成功)', async () => {
      mountCheck()
      await press('a', 1)
      await press('s', 2)
      await press('d', 3)
      await lift('a', 1, 'pointercancel')
      await press('f', 4)
      expect(established()).toBe(0)
      await press('a', 5)
      expect(established()).toBe(1)
      await lift('s', 2, 'pointercancel')
      expect(released()).toBe(1)
    })

    it('成立後に追加で置いた接触は、成立に使った接触ではない', async () => {
      mountCheck()
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      await press('a', 9)
      expect(established()).toBe(1)
      await lift('a', 9)
      expect(released()).toBe(0)
    })

    it('メニュー・縦向き・非表示などの停止で追跡中の接触をすべて捨てる(成立前)', async () => {
      mountCheck()
      await press('a', 1)
      await press('s', 2)
      await press('d', 3)
      await wrapper.setProps({ homePositionPaused: true })
      await wrapper.setProps({ homePositionPaused: false })
      await press('f', 4)
      expect(established()).toBe(0)
      // 置き直せば成立する
      await Promise.all(['a', 's', 'd'].map((key, index) => press(key, 11 + index)))
      expect(established()).toBe(1)
    })

    it('停止から戻ったあと、停止前の接触を離しても成功にならない(成立後)', async () => {
      mountCheck()
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      expect(established()).toBe(1)
      await wrapper.setProps({ homePositionPaused: true })
      await wrapper.setProps({ homePositionPaused: false })
      await lift('a', 1)
      expect(released()).toBe(0)
    })

    it('停止中に始まった接触は追跡しない', async () => {
      mountCheck({ homePositionPaused: true })
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      expect(established()).toBe(0)
      await wrapper.setProps({ homePositionPaused: false })
      await lift('a', 1)
      expect(established()).toBe(0)
      expect(released()).toBe(0)
    })

    it('確認が終わる/次の確認が始まると、追跡中の接触を捨てる', async () => {
      mountCheck()
      await press('a', 1)
      await press('s', 2)
      await press('d', 3)
      await wrapper.setProps({ homePosition: { id: 2, keys: LEFT_HOME, established: false } })
      await press('f', 4)
      expect(established()).toBe(0)

      await wrapper.setProps({ homePosition: null, disabled: false })
      await wrapper.setProps({ homePosition: { id: 3, keys: LEFT_HOME, established: false }, disabled: true })
      await Promise.all(['a', 's', 'd'].map((key, index) => press(key, 21 + index)))
      expect(established()).toBe(0)
    })

    it('成立の通知後にpropが成立済みに変わっても追跡は続き、離すと成功を通知する', async () => {
      mountCheck()
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      await wrapper.setProps({ homePosition: { id: 1, keys: LEFT_HOME, established: true } })
      await lift('f', 4)
      expect(released()).toBe(1)
    })

    it('pointerIdが再利用されたら新しい接触として数え直す', async () => {
      mountCheck()
      await press('a', 1)
      await press('s', 2)
      await press('d', 3)
      await press('f', 3)
      expect(established()).toBe(0)
      await press('d', 4)
      expect(established()).toBe(1)
    })

    it('再利用されたpointerIdは新しい接触として最後尾に数え、成立に使う接触の選び方も新しい順序に従う', async () => {
      mountCheck()
      await press('a', 1)
      await press('a', 2)
      // pointerupを取りこぼしたpointerId 1が、同じキーで再利用された
      await press('a', 1)
      await press('s', 3)
      await press('d', 4)
      await press('f', 5)
      expect(established()).toBe(1)
      // 成立に使ったのは、同じキーで先に置かれたままの接触2(再利用された1は後から)
      await lift('a', 1)
      expect(released()).toBe(0)
      await lift('a', 2)
      expect(released()).toBe(1)
    })

    it('マウスの右ボタンは接触として数えない', async () => {
      mountCheck()
      await Promise.all(['a', 's', 'd'].map((key, index) => press(key, index + 1)))
      await dispatchPointer(wrapper.get('[data-key="f"]'), 'pointerdown', {
        pointerId: 4, pointerType: 'mouse', button: 2,
      })
      expect(established()).toBe(0)
    })

    it.each(['pagehide', 'blur'])('%sで追跡中の接触を捨てる', async (eventType) => {
      mountCheck()
      await Promise.all(['a', 's', 'd'].map((key, index) => press(key, index + 1)))
      window.dispatchEvent(new Event(eventType))
      await press('f', 4)
      expect(established()).toBe(0)
    })

    it.each(['pagehide', 'blur'])('成立後に%sで追跡を捨てたらhome-resetを通知し、残った接触を離しても成功にしない', async (eventType) => {
      mountCheck()
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      expect(established()).toBe(1)
      window.dispatchEvent(new Event(eventType))
      expect(wrapper.emitted('home-reset')).toHaveLength(1)
      await lift('a', 1)
      expect(released()).toBe(0)
      // 置き直せば再び成立する
      await Promise.all(LEFT_HOME.map((key, index) => press(key, 11 + index)))
      expect(established()).toBe(2)
    })

    it('成立前のblurではhome-resetを通知しない(エンジンは未成立のまま)', async () => {
      mountCheck()
      await press('a', 1)
      window.dispatchEvent(new Event('blur'))
      expect(wrapper.emitted('home-reset')).toBeUndefined()
    })

    it('確認中でなければ接触を追跡せず、対象キーも通常どおり入力する', async () => {
      mountKeyboard()
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      await Promise.all(LEFT_HOME.map((key, index) => lift(key, index + 1)))
      expect(established()).toBe(0)
      expect(released()).toBe(0)
      expect(wrapper.emitted('press')).toEqual(LEFT_HOME.map((key) => [key]))
    })

    it('確認中はキーボード由来のclickやポインタ由来の合成clickも入力にしない', async () => {
      mountCheck()
      const key = wrapper.get('[data-key="a"]')
      await dispatchClick(key, 0)
      await press('a', 1)
      await lift('a', 1)
      await dispatchClick(key, 1)
      expect(wrapper.emitted('press')).toBeUndefined()
      expect(key.attributes('aria-disabled')).toBe('true')
      expect(key.attributes('disabled')).toBeUndefined()
    })

    it('確認後に始まった次の問題では、確認中に押した指の合成clickを入力にしない', async () => {
      mountCheck()
      await Promise.all(LEFT_HOME.map((key, index) => press(key, index + 1)))
      await lift('a', 1)
      await wrapper.setProps({ homePosition: null, disabled: false })
      await dispatchClick(wrapper.get('[data-key="a"]'), 1)
      expect(wrapper.emitted('press')).toBeUndefined()
    })

    it('対象の4キーを強調し、成立すると緑+チェックの見た目になる(確認中だけ)', async () => {
      mountCheck()
      const targetKeys = () => wrapper.findAll('.key.home-target').map((key) => key.attributes('data-key'))
      expect(targetKeys()).toEqual(LEFT_HOME)
      expect(wrapper.findAll('.key.home-confirmed')).toHaveLength(0)
      expect(wrapper.findAll('.home-check-mark')).toHaveLength(0)
      expect(wrapper.get('.keyboard-panel').classes()).toContain('home-check')
      expect(wrapper.get('.keyboard-panel').classes()).not.toContain('complete')
      // 指の色分けは維持する
      expect(wrapper.get('[data-key="a"]').classes()).toContain('finger-leftPinky')

      await wrapper.setProps({ homePosition: { id: 1, keys: LEFT_HOME, established: true } })
      expect(wrapper.findAll('.key.home-confirmed').map((key) => key.attributes('data-key'))).toEqual(LEFT_HOME)
      expect(wrapper.findAll('.home-check-mark')).toHaveLength(4)
      expect(wrapper.get('.home-check-mark').attributes('aria-hidden')).toBe('true')

      await wrapper.setProps({ homePosition: null, disabled: false })
      expect(wrapper.findAll('.key.home-target')).toHaveLength(0)
      expect(wrapper.findAll('.home-check-mark')).toHaveLength(0)
      expect(wrapper.get('.keyboard-panel').classes()).not.toContain('home-check')
    })

    it('確認中でなければ入力不可の見た目は従来どおり(completeのまま)', () => {
      mountKeyboard({ disabled: true })
      expect(wrapper.get('.keyboard-panel').classes()).toContain('complete')
      expect(wrapper.findAll('.key.home-target')).toHaveLength(0)
    })
  })
})
