import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { AUTO_ADVANCE_MS } from './appConfig.js'
import { loadHistory } from './services/history.js'
import { STORAGE_KEY } from './services/storage.js'
import { completeCurrentQuestion, openPracticeMenu, startPractice } from './test/app.js'

function dispatchPointer(target, type, pointerId) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'touch' },
  })
  ;(target.element ?? target).dispatchEvent(event)
  return nextTick()
}

function dispatchClick(target, detail) {
  target.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }))
  return nextTick()
}

const LEFT_HOME = ['a', 's', 'd', 'f']

async function placeFingers(wrapper, keys = LEFT_HOME, firstPointerId = 1) {
  for (const [index, key] of keys.entries()) {
    await dispatchPointer(wrapper.get(`[data-key="${key}"]`), 'pointerdown', firstPointerId + index)
  }
}

async function enableHomePosition(wrapper) {
  await wrapper.get('[data-testid="home-position"]').setValue(true)
}

describe('ホームポジション確認(画面全体)', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('設定画面に切替があり、既定はOFFで、保存され、モード・手・レベルと独立している', async () => {
    const wrapper = mount(App)
    const toggle = wrapper.get('[data-testid="home-position"]')
    expect(toggle.element.checked).toBe(false)
    expect(toggle.element.disabled).toBe(false)
    expect(wrapper.get('.home-position-toggle').text()).toContain('ホームポジション確認')
    expect(wrapper.get('.home-position-toggle').text()).toContain('問題ごとに、指を置き直したか確認します')
    expect(toggle.attributes('aria-label')).toBe('ホームポジション確認')

    await toggle.setValue(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).settings.homePosition).toBe(true)

    // 手・レベル・モードを変えても、ホームポジションの設定は変わらない(問題番号の初期化にも影響しない)
    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    await wrapper.get('[data-testid="level-3"]').trigger('click')
    await wrapper.get('[data-testid="mode-timeLimit"]').trigger('click')
    expect(wrapper.get('[data-testid="home-position"]').element.checked).toBe(true)
    await wrapper.get('[data-testid="mode-timeAttack"]').trigger('click')
    expect(wrapper.get('[data-testid="home-position"]').element.checked).toBe(true)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).settings).toMatchObject({
      hand: 'right', level: 3, mode: 'timeAttack', homePosition: true,
    })
    wrapper.unmount()
  })

  it('保存済みのON設定を設定画面に復元する', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1, settings: { homePosition: true }, results: {}, questionIndex: 0, session: null,
    }))
    const wrapper = mount(App)
    expect(wrapper.get('[data-testid="home-position"]').element.checked).toBe(true)
    wrapper.unmount()
  })

  it('OFFでは従来どおり、クリア表示のあと600msで自動的に次の問題へ進む', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    const first = wrapper.get('.prompt-text').text()
    await completeCurrentQuestion(wrapper)
    expect(wrapper.find('[data-testid="home-skip"]').exists()).toBe(false)
    expect(wrapper.findAll('.key.home-target')).toHaveLength(0)
    expect(wrapper.get('.feedback').text()).toBe('クリア！ 自動で次の問題に進みます')
    await vi.advanceTimersByTimeAsync(AUTO_ADVANCE_MS)
    expect(wrapper.get('.prompt-text').text()).not.toBe(first + 'x')
    expect(wrapper.find('.prompt-card.home-check').exists()).toBe(false)
    wrapper.unmount()
  })

  it('ONでは最初の問題の前に確認せず、クリア後に案内・強調・スキップを出して自動では進まない', async () => {
    const wrapper = mount(App)
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    expect(wrapper.find('.prompt-card.home-check').exists()).toBe(false)
    expect(wrapper.find('.prompt-text').exists()).toBe(true)

    await completeCurrentQuestion(wrapper)
    expect(wrapper.get('[data-testid="home-check-text"]').text()).toBe('A S D F に指を置いてください')
    expect(wrapper.get('[data-testid="home-skip"]').text()).toBe('スキップ')
    expect(wrapper.find('.prompt-text').exists()).toBe(false)
    expect(wrapper.findAll('.key.home-target').map((key) => key.attributes('data-key'))).toEqual(LEFT_HOME)
    expect(wrapper.get('[data-testid="home-check-live"]').text())
      .toBe('ホームポジション確認。A S D F に指を置いてください')
    expect(wrapper.get('.feedback').text()).toBe('クリア！')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('4本置くと成立表示になり、どれか1本を離すと次の問題へ進む', async () => {
    const wrapper = mount(App)
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)

    await placeFingers(wrapper)
    expect(wrapper.get('[data-testid="home-check-text"]').text())
      .toBe('✓確認できました。指を離すと次へ進みます')
    expect(wrapper.get('[data-testid="home-check-live"]').text())
      .toBe('確認できました。指を離すと次へ進みます')
    expect(wrapper.findAll('.key.home-confirmed')).toHaveLength(4)
    expect(wrapper.findAll('.home-check-mark')).toHaveLength(4)
    // まだ進まない
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(true)

    await dispatchPointer(wrapper.get('[data-key="d"]'), 'pointerup', 3)
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(false)
    expect(wrapper.find('.prompt-text').exists()).toBe(true)
    expect(wrapper.findAll('.key.home-target')).toHaveLength(0)
    expect(wrapper.get('[data-testid="home-check-live"]').text()).toBe('')

    // 次の問題の入力を受け付ける。確認の指の合成clickは入力にならない
    const attemptsOf = () => JSON.parse(localStorage.getItem(STORAGE_KEY)).session.attempts
    expect(attemptsOf()).toBe(0)
    await dispatchClick(wrapper.get('[data-key="d"]'), 1)
    expect(attemptsOf()).toBe(0)
    // 合成clickではない通常のclick(ポインタを伴わない)は、次の問題の入力になる
    await dispatchClick(wrapper.get('[data-key="d"]'), 0)
    expect(attemptsOf()).toBe(1)
    wrapper.unmount()
  })

  it('確認中は通常のキー入力(ポインタ・click)とやり直しを受け付けない', async () => {
    const wrapper = mount(App)
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)

    await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerdown', 40)
    await dispatchPointer(wrapper.get('[data-key="q"]'), 'pointerup', 40)
    await dispatchClick(wrapper.get('[data-key="q"]'), 0)
    await dispatchClick(wrapper.get('[data-key="a"]'), 0)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).session.attempts).toBe(1)
    expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('0')
    expect(wrapper.get('[data-key="q"]').attributes('aria-disabled')).toBe('true')

    const reset = wrapper.get('[data-testid="reset"]')
    expect(reset.attributes('aria-disabled')).toBe('true')
    expect(reset.attributes('disabled')).toBeUndefined()
    await reset.trigger('click')
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="completed"]').text()).toBe('1問')
    wrapper.unmount()
  })

  it('スキップで次の問題へ進み、結果にはスキップ回数が出て成功は0回・平均/最短は「-」', async () => {
    const wrapper = mount(App)
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    await wrapper.get('[data-testid="home-skip"]').trigger('click')
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(false)
    expect(wrapper.find('.prompt-text').exists()).toBe(true)

    await openPracticeMenu(wrapper)
    await wrapper.get('[data-testid="menu-finish"]').trigger('click')
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
    const card = wrapper.get('[data-testid="result-home-position"]')
    expect(card.get('[data-testid="result-hp-success"]').text()).toBe('0回')
    expect(card.get('[data-testid="result-hp-skip"]').text()).toBe('1回')
    expect(card.get('[data-testid="result-hp-avg"]').text()).toBe('-')
    expect(card.get('[data-testid="result-hp-min"]').text()).toBe('-')
    expect(loadHistory()[0]).toMatchObject({ homePosition: true, hpSuccessCount: 0, hpSkipCount: 1 })
    wrapper.unmount()
  })

  it('メニューを開くと確認の接触を破棄し、閉じたあとは置き直すまで成立しない', async () => {
    const wrapper = mount(App)
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    await placeFingers(wrapper)
    expect(wrapper.findAll('.key.home-confirmed')).toHaveLength(4)

    await openPracticeMenu(wrapper)
    expect(wrapper.findAll('.key.home-confirmed')).toHaveLength(0)
    await wrapper.get('[data-testid="menu-resume"]').trigger('click')
    await nextTick()
    await vi.advanceTimersByTimeAsync(5000)
    // 閉じても自動では進まず、確認へ戻る
    expect(wrapper.get('[data-testid="home-check-text"]').text()).toBe('A S D F に指を置いてください')

    // 古い接触を離しても成功にならない
    await dispatchPointer(wrapper.get('[data-key="a"]'), 'pointerup', 1)
    expect(wrapper.get('[data-testid="home-check-text"]').exists()).toBe(true)
    await placeFingers(wrapper, LEFT_HOME, 11)
    await dispatchPointer(wrapper.get('[data-key="a"]'), 'pointerup', 11)
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('成立後にウィンドウがblurしたら未成立へ戻り、残った指を離しても進まない(置き直せば進む)', async () => {
    const wrapper = mount(App)
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    await placeFingers(wrapper)
    expect(wrapper.findAll('.key.home-confirmed')).toHaveLength(4)

    window.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(wrapper.findAll('.key.home-confirmed')).toHaveLength(0)
    expect(wrapper.get('[data-testid="home-check-text"]').text()).toBe('A S D F に指を置いてください')
    await dispatchPointer(wrapper.get('[data-key="a"]'), 'pointerup', 1)
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(true)

    await placeFingers(wrapper, LEFT_HOME, 21)
    await dispatchPointer(wrapper.get('[data-key="a"]'), 'pointerup', 21)
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('a/s/dを置いたままメニューを開閉すると接触は捨てられ、fだけ置いても成立しない', async () => {
    const wrapper = mount(App)
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    await placeFingers(wrapper, ['a', 's', 'd'])
    await openPracticeMenu(wrapper)
    await wrapper.get('[data-testid="menu-resume"]').trigger('click')
    await nextTick()

    await placeFingers(wrapper, ['f'], 4)
    expect(wrapper.findAll('.key.home-confirmed')).toHaveLength(0)
    expect(wrapper.get('[data-testid="home-check-text"]').text()).toBe('A S D F に指を置いてください')
    await placeFingers(wrapper, ['a', 's', 'd'], 11)
    expect(wrapper.findAll('.key.home-confirmed')).toHaveLength(4)
    wrapper.unmount()
  })

  it('スキップ後はフォーカスがbodyへ落ちず出題欄へ移り、ボタンには対象キーが入る', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    const skip = wrapper.get('[data-testid="home-skip"]')
    expect(skip.attributes('aria-label')).toBe('ホームポジション確認をスキップ(A S D F)')
    skip.element.focus()
    expect(document.activeElement).toBe(skip.element)

    await skip.trigger('click')
    await nextTick()
    expect(wrapper.find('[data-testid="home-skip"]').exists()).toBe(false)
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(wrapper.get('.prompt-card').element)
    wrapper.unmount()
  })

  it('右手では J K L ; を案内・強調する', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    expect(wrapper.get('[data-testid="home-check-text"]').text()).toBe('J K L ; に指を置いてください')
    expect(wrapper.findAll('.key.home-target').map((key) => key.attributes('data-key')))
      .toEqual(['j', 'k', 'l', ';'])
    wrapper.unmount()
  })

  it('タイムアタックの最終問題では確認せず結果へ進み、成績に成功回数と平均/最短復帰時間を出す', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="mode-timeAttack"]').trigger('click')
    await enableHomePosition(wrapper)
    await startPractice(wrapper)
    for (let index = 0; index < 10; index += 1) {
      await completeCurrentQuestion(wrapper)
      if (index < 9) {
        expect(wrapper.find('[data-testid="home-check-text"]').exists(), `${index + 1}問目`).toBe(true)
        await placeFingers(wrapper, LEFT_HOME, 100 + index * 10)
        await vi.advanceTimersByTimeAsync(0)
        await dispatchPointer(wrapper.get('[data-key="a"]'), 'pointerup', 100 + index * 10)
        // 離した直後の指(s d f)は、次の確認の前に離す
        for (const [i, key] of ['s', 'd', 'f'].entries()) {
          await dispatchPointer(wrapper.get(`[data-key="${key}"]`), 'pointerup', 101 + index * 10 + i)
        }
      }
    }
    expect(wrapper.find('[data-testid="home-check-text"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(AUTO_ADVANCE_MS)
    expect(wrapper.find('[data-testid="run-result"]').exists()).toBe(true)
    const card = wrapper.get('[data-testid="result-home-position"]')
    expect(card.get('[data-testid="result-hp-success"]').text()).toBe('9回')
    expect(card.get('[data-testid="result-hp-skip"]').text()).toBe('0回')
    expect(card.get('[data-testid="result-hp-avg"]').text()).toBe('0.0秒')
    expect(card.get('[data-testid="result-hp-min"]').text()).toBe('0.0秒')
    wrapper.unmount()
  })

  it('OFFのrunの結果にはホームポジションの成績を出さない', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    await openPracticeMenu(wrapper)
    await wrapper.get('[data-testid="menu-finish"]').trigger('click')
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
    expect(wrapper.find('[data-testid="run-result"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="result-home-position"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
