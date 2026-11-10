import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import KeyboardView from './components/KeyboardView.vue'
import { AUTO_ADVANCE_MS } from './appConfig.js'
import { STORAGE_KEY } from './services/storage.js'
import { completeCurrentQuestion, openPracticeMenu, startPractice } from './test/app.js'

async function confirmFinish(wrapper) {
  await openPracticeMenu(wrapper)
  await wrapper.get('[data-testid="menu-finish"]').trigger('click')
  await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
}

describe('設定・練習・結果の3画面', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.removeAttribute('tabindex')
    document.body.innerHTML = ''
  })

  it('設定を反映・保存し、文字数の目安とビルド識別子を表示する', async () => {
    const wrapper = mount(App)
    expect(wrapper.find('[data-testid="settings-screen"]').exists()).toBe(true)
    expect(wrapper.find('.keyboard').exists()).toBe(false)
    expect(wrapper.get('[data-testid="level-lengths"]').text()).toContain('Lv.1 1文字')
    expect(wrapper.get('[data-testid="level-lengths"]').text()).toContain('Lv.2 3〜5文字')
    expect(wrapper.get('[data-testid="level-lengths"]').text()).toContain('Lv.3 5〜10文字')
    expect(wrapper.get('[data-testid="build-id"]').text()).toMatch(/^版 (?:[0-9a-f]+|dev) · (?:\d{4}-\d{2}-\d{2}|dev)$/)
    const touchRipple = wrapper.get('[data-testid="touch-ripple"]')
    expect(touchRipple.element.checked).toBe(true)
    expect(wrapper.get('.touch-ripple-toggle').text()).toContain('タッチ位置の演出')
    expect(wrapper.get('.touch-ripple-toggle').text()).toContain('触れた位置に、水滴のような輪を出します')
    await touchRipple.setValue(false)

    const symbols = wrapper.get('[data-testid="include-symbols"]')
    expect(symbols.element.disabled).toBe(true)
    expect(wrapper.get('.symbol-toggle').text()).toContain('右手のみ')
    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    await wrapper.get('[data-testid="level-3"]').trigger('click')
    await symbols.setValue(true)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({
      settings: { hand: 'right', level: 3, includeSymbols: true, touchRipple: false },
      questionIndex: 0,
    })
    await startPractice(wrapper)
    expect(wrapper.get('.keyboard-panel').attributes('data-hand')).toBe('right')
    expect(wrapper.get('.prompt-text').text().length).toBeGreaterThanOrEqual(5)
    expect(wrapper.get('.prompt-text').text().length).toBeLessThanOrEqual(10)
    wrapper.unmount()
  })

  it('設定画面では練習監視を登録せず、練習画面を離れると解除する', async () => {
    const addDocumentListener = vi.spyOn(document, 'addEventListener')
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener')
    const wrapper = mount(App)
    const settingsVisibilityListeners = addDocumentListener.mock.calls
      .filter(([name]) => name === 'visibilitychange').length

    await startPractice(wrapper)
    expect(addDocumentListener.mock.calls.filter(([name]) => name === 'visibilitychange')).toHaveLength(
      settingsVisibilityListeners + 1,
    )
    await openPracticeMenu(wrapper)
    await wrapper.get('[data-testid="menu-to-settings"]').trigger('click')
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
    expect(wrapper.find('[data-testid="settings-screen"]').exists()).toBe(true)
    expect(removeDocumentListener.mock.calls.some(([name]) => name === 'visibilitychange')).toBe(true)

    addDocumentListener.mockRestore()
    removeDocumentListener.mockRestore()
    wrapper.unmount()
  })

  it('設定→練習→結果→同じ設定で練習→設定と遷移する', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await confirmFinish(wrapper)
    expect(wrapper.find('[data-testid="run-result"]').exists()).toBe(true)

    await wrapper.get('[data-testid="result-again"]').trigger('click')
    expect(wrapper.find('.keyboard').exists()).toBe(true)
    await confirmFinish(wrapper)
    await wrapper.get('[data-testid="result-to-settings"]').trigger('click')
    expect(wrapper.find('[data-testid="settings-screen"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('同じ設定でもう一度を選ぶと、右上の今回の成績がゼロから始まる', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    const expected = wrapper.get('.prompt-text .current').text()
    const wrong = wrapper.findAll('.key')
      .find((key) => key.attributes('data-key') !== expected)
    await wrong.trigger('click')
    await completeCurrentQuestion(wrapper)
    expect(wrapper.get('[data-testid="completed"]').text()).toBe('1問')
    expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('1')
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:02')

    await confirmFinish(wrapper)
    await wrapper.get('[data-testid="result-again"]').trigger('click')

    expect(wrapper.get('[data-testid="completed"]').text()).toBe('0問')
    expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('0')
    expect(wrapper.get('[data-testid="accuracy"]').text()).toBe('100%')
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:00')
    wrapper.unmount()
  })

  it('設定画面へ戻って始め直すと、右上の今回の成績がゼロから始まる', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    const expected = wrapper.get('.prompt-text .current').text()
    const wrong = wrapper.findAll('.key')
      .find((key) => key.attributes('data-key') !== expected)
    await wrong.trigger('click')

    await openPracticeMenu(wrapper)
    await wrapper.get('[data-testid="menu-to-settings"]').trigger('click')
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
    await startPractice(wrapper)

    expect(wrapper.get('[data-testid="completed"]').text()).toBe('0問')
    expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('0')
    expect(wrapper.get('[data-testid="accuracy"]').text()).toBe('100%')
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:00')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).results).toMatchObject({
      mistakes: 1,
      attempts: 1,
      practiceMs: 1000,
    })
    wrapper.unmount()
  })

  it('練習中の右上と結果画面で、時間・クリア・ミス・正答率が一致する', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="level-2"]').trigger('click')
    await startPractice(wrapper)
    vi.advanceTimersByTime(2500)
    await wrapper.vm.$nextTick()
    const expected = wrapper.get('.prompt-text .current').text()
    const wrong = wrapper.findAll('.key')
      .find((key) => key.attributes('data-key') !== expected)
    await wrong.trigger('click')
    await wrapper.get(`[data-key="${expected}"]`).trigger('click')

    const practiceStats = {
      time: wrapper.get('[data-testid="elapsed"]').text(),
      completed: wrapper.get('[data-testid="completed"]').text(),
      mistakes: wrapper.get('[data-testid="mistakes"]').text(),
      accuracy: wrapper.get('[data-testid="accuracy"]').text(),
    }
    await confirmFinish(wrapper)

    expect(wrapper.get('[data-testid="result-time"]').text()).toBe(practiceStats.time)
    expect(wrapper.get('[data-testid="result-completed"]').text()).toBe(practiceStats.completed)
    expect(wrapper.get('[data-testid="result-mistakes"]').text()).toBe(practiceStats.mistakes)
    expect(wrapper.get('[data-testid="result-accuracy"]').text()).toBe(practiceStats.accuracy)
    wrapper.unmount()
  })

  it('途中の問題を含めて今回の値とKPMを表示する', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="level-2"]').trigger('click')
    await startPractice(wrapper)
    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    const expected = wrapper.get('.prompt-text .current').text()
    await wrapper.get(`[data-key="${expected}"]`).trigger('click')
    await confirmFinish(wrapper)

    expect(wrapper.get('[data-testid="result-time"]').text()).toBe('0:02')
    expect(wrapper.get('[data-testid="result-completed"]').text()).toBe('0問')
    expect(wrapper.get('[data-testid="result-correct"]').text()).toBe('1')
    expect(wrapper.get('[data-testid="result-mistakes"]').text()).toBe('0')
    expect(wrapper.get('[data-testid="result-accuracy"]').text()).toBe('100%')
    expect(wrapper.get('[data-testid="result-kpm"]').text()).toBe('30 KPM')
    wrapper.unmount()
  })

  it('入力時間が1秒未満ならKPMを表示しない', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    vi.advanceTimersByTime(999)
    await wrapper.vm.$nextTick()
    await confirmFinish(wrapper)
    expect(wrapper.get('[data-testid="result-kpm"]').text()).toBe('--')
    wrapper.unmount()
  })

  it('メニュー中に時間が進んでも、終了時のsummaryはメニューを開いた時点で確定する', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="level-2"]').trigger('click')
    await startPractice(wrapper)
    vi.advanceTimersByTime(999)
    await wrapper.vm.$nextTick()
    const expected = wrapper.get('.prompt-text .current').text()
    await wrapper.get(`[data-key="${expected}"]`).trigger('click')
    await openPracticeMenu(wrapper)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).session.elapsedMs).toBe(999)

    vi.advanceTimersByTime(5000)
    await wrapper.get('[data-testid="menu-finish"]').trigger('click')
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click')

    expect(wrapper.get('[data-testid="result-time"]').text()).toBe('0:00')
    expect(wrapper.get('[data-testid="result-kpm"]').text()).toBe('--')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).results.practiceMs).toBe(999)
    wrapper.unmount()
  })

  it('モードに応じて問題数・制限時間の選択を出し分け、選択を保存する', async () => {
    const wrapper = mount(App)
    expect(wrapper.find('[data-testid="count-10"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="limit-30"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="mode-description"]').text()).toContain('時間も問題数も')

    await wrapper.get('[data-testid="mode-timeAttack"]').trigger('click')
    expect(wrapper.find('[data-testid="count-10"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="limit-30"]').exists()).toBe(false)
    await wrapper.get('[data-testid="count-30"]').trigger('click')

    await wrapper.get('[data-testid="mode-timeLimit"]').trigger('click')
    expect(wrapper.find('[data-testid="count-10"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="limit-30"]').exists()).toBe(true)
    await wrapper.get('[data-testid="limit-120"]').trigger('click')

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toMatchObject({
      settings: { mode: 'timeLimit', targetCount: 30, timeLimitSec: 120 },
      questionIndex: 0,
    })
    wrapper.unmount()
  })

  it('競技モードは最初のキーで表示を切り替え、やり直すを表示しない', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="mode-timeAttack"]').trigger('click')
    await startPractice(wrapper)
    expect(wrapper.get('[data-testid="start-hint"]').text()).toBe('最初のキーでスタート')
    expect(wrapper.find('[data-testid="reset"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="progress"]').text()).toBe('0/10')
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:00')

    await wrapper.get(`[data-key="${wrapper.get('.prompt-text .current').text()}"]`).trigger('click')
    expect(wrapper.find('[data-testid="start-hint"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="progress"]').text()).toBe('1/10')
    wrapper.unmount()
  })

  it('タイムアタックを全問完了するとクリアタイムとn/n問の結果を表示する', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="mode-timeAttack"]').trigger('click')
    await startPractice(wrapper)

    for (let index = 0; index < 10; index += 1) {
      await completeCurrentQuestion(wrapper)
      vi.advanceTimersByTime(AUTO_ADVANCE_MS)
      await wrapper.vm.$nextTick()
    }

    expect(wrapper.get('h1').text()).toBe('タイムアタック 結果')
    expect(wrapper.get('[data-testid="result-clear-time"]').text()).toBe('0:05.4')
    expect(wrapper.get('[data-testid="result-count"]').text()).toBe('10/10問')
    wrapper.unmount()
  })

  it('制限時間は残り時間と完了数を表示し、時間切れですぐ結果へ進む', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="mode-timeLimit"]').trigger('click')
    await wrapper.get('[data-testid="limit-30"]').trigger('click')
    await startPractice(wrapper)
    expect(wrapper.get('[data-testid="remaining"]').text()).toBe('0:30')
    expect(wrapper.find('[data-testid="reset"]').exists()).toBe(false)
    await completeCurrentQuestion(wrapper)

    vi.advanceTimersByTime(30_000)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('h1').text()).toBe('制限時間 結果')
    expect(wrapper.get('[data-testid="result-count"]').text()).toBe('1問')
    expect(wrapper.get('[data-testid="result-limit"]').text()).toBe('30秒')
    wrapper.unmount()
  })

  it('競技モードを手動終了すると途中終了と進捗を表示する', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="mode-timeAttack"]').trigger('click')
    await startPractice(wrapper)
    await completeCurrentQuestion(wrapper)
    await confirmFinish(wrapper)

    expect(wrapper.get('h1').text()).toContain('タイムアタック 結果(途中終了)')
    expect(wrapper.get('[data-testid="result-ended-early"]').text()).toBe('途中終了')
    expect(wrapper.get('[data-testid="result-count"]').text()).toBe('1/10問')
    wrapper.unmount()
  })
})

describe('練習中メニュー', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.removeAttribute('tabindex')
    document.body.innerHTML = ''
  })

  it('runの途中でメニューを開閉しても、開いている間は今回の時間を増やさない', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    const expected = wrapper.get('.prompt-text .current').text()
    await openPracticeMenu(wrapper)
    wrapper.getComponent(KeyboardView).vm.$emit('press', expected)
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.prompt-text .done')).toHaveLength(0)

    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:02')
    await wrapper.get('[data-testid="practice-menu"]').trigger('click')
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:03')
    wrapper.unmount()
  })

  it('Escapeで閉じ、最初のボタンとメニューボタンへフォーカスを移す', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await startPractice(wrapper)
    const menuButton = wrapper.get('[data-testid="menu-button"]')
    await openPracticeMenu(wrapper)
    const resume = wrapper.get('[data-testid="menu-resume"]').element
    const finish = wrapper.get('[data-testid="menu-finish"]').element
    expect(document.activeElement).toBe(resume)
    document.body.setAttribute('tabindex', '-1')
    document.body.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(wrapper.get('.practice-menu-dialog').element.contains(document.activeElement)).toBe(true)
    finish.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(resume)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(finish)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="practice-menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(menuButton.element)
    wrapper.unmount()
  })

  it('表示中は背面をinertにし、閉じると解除する', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await openPracticeMenu(wrapper)
    expect(wrapper.get('[data-testid="info-strip"]').attributes()).toHaveProperty('inert')
    expect(wrapper.get('.keyboard-panel').attributes()).toHaveProperty('inert')
    expect(wrapper.get('[data-testid="info-strip"]').attributes('aria-hidden')).toBe('true')

    await wrapper.get('[data-testid="menu-resume"]').trigger('click')
    expect(wrapper.get('[data-testid="info-strip"]').attributes()).not.toHaveProperty('inert')
    expect(wrapper.get('.keyboard-panel').attributes()).not.toHaveProperty('inert')
    wrapper.unmount()
  })

  it('確認の「やめる」はメニューへ戻り、「はい」は結果なしで設定へ戻る', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    await openPracticeMenu(wrapper)
    await wrapper.get('[data-testid="menu-to-settings"]').trigger('click')
    expect(wrapper.get('.practice-menu-dialog').text()).toContain('練習設定へ戻りますか?')
    await wrapper.get('[data-testid="confirm-cancel"]').trigger('click')
    expect(wrapper.get('.practice-menu-dialog').text()).toContain('練習を再開')

    await wrapper.get('[data-testid="menu-to-settings"]').trigger('click')
    await wrapper.get('[data-testid="confirm-yes"]').trigger('click')
    expect(wrapper.find('[data-testid="settings-screen"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="run-result"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('自動で次への予約を止め、再開時に600msを予約し直す', async () => {
    const wrapper = mount(App)
    await startPractice(wrapper)
    const firstQuestion = wrapper.get('.prompt-text').text()
    await completeCurrentQuestion(wrapper)
    await openPracticeMenu(wrapper)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.prompt-text').text()).toContain(firstQuestion)

    await wrapper.get('[data-testid="menu-resume"]').trigger('click')
    vi.advanceTimersByTime(AUTO_ADVANCE_MS - 1)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.info-strip').classes()).toContain('complete')
    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.info-strip').classes()).not.toContain('complete')
    wrapper.unmount()
  })
})
