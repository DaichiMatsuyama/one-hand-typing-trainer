import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import KeyboardView from './components/KeyboardView.vue'
import { AUTO_ADVANCE_MS } from './appConfig.js'
import { getQuestion } from './data/questionBank.js'
import { STORAGE_KEY, STORAGE_VERSION } from './services/storage.js'

async function completeCurrentQuestion(wrapper) {
  while (wrapper.find('.prompt-text .current').exists()) {
    const expected = wrapper.get('.prompt-text .current').text()
    await wrapper.get(`[data-key="${expected}"]`).trigger('click')
  }
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: false })
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

  it('手を切り替えても情報ストリップを上部に保ち、キーボードだけ手側へ寄せる', async () => {
    const wrapper = mount(App)
    const shell = wrapper.get('.app-shell')
    const children = [...wrapper.get('.practice-layout').element.children]

    expect(shell.attributes('data-hand')).toBe('left')
    expect(shell.classes()).not.toContain('hand-left')
    expect(children[0].classList.contains('info-strip')).toBe(true)
    expect(children[1].classList.contains('keyboard-panel')).toBe(true)
    expect(wrapper.get('[data-testid="info-strip"]').find('.hand-selector').exists()).toBe(true)
    expect(wrapper.get('[data-testid="info-strip"]').find('.level-selector').exists()).toBe(true)
    expect(wrapper.get('[data-testid="info-strip"]').find('.prompt-card').exists()).toBe(true)
    expect(wrapper.get('[data-testid="info-strip"]').find('.stats').exists()).toBe(true)
    expect(wrapper.get('[data-testid="info-strip"]').find('[data-testid="reset"]').exists()).toBe(true)
    expect(wrapper.get('.keyboard-panel').attributes('data-hand')).toBe('left')

    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    expect(shell.attributes('data-hand')).toBe('right')
    expect(shell.classes()).not.toContain('hand-right')
    expect(wrapper.get('.keyboard-panel').attributes('data-hand')).toBe('right')
    expect(wrapper.get('.practice-layout').element.children[0].classList.contains('info-strip')).toBe(true)
    wrapper.unmount()
  })

  it('ホーム画面からの起動時は回転案内の追加方法を表示しない', () => {
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true })
    const wrapper = mount(App)
    expect(wrapper.find('[data-testid="install-hint"]').exists()).toBe(false)
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
    expect(symbolSetting.attributes('aria-describedby')).toBe('symbol-hand-hint')
    expect(symbolSetting.attributes('title')).toContain('右手の練習でのみ')
    expect(wrapper.get('.symbol-label-full').text()).toBe('記号を含める')
    expect(wrapper.get('.symbol-label-compact').text()).toBe('記号')

    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    expect(symbolSetting.element.disabled).toBe(false)
    await symbolSetting.setValue(true)

    await wrapper.get('[data-testid="hand-left"]').trigger('click')
    expect(symbolSetting.element.disabled).toBe(true)
    expect(symbolSetting.element.checked).toBe(true)
    wrapper.unmount()
  })

  it('正誤のキー色を約450ms保持し、最終文字の正解も解除する', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="level-2"]').trigger('click')
    const expected = wrapper.get('.prompt-text .current').text()
    const wrongKey = wrapper.findAll('.key')
      .find((keyWrapper) => keyWrapper.attributes('data-key') !== expected)

    await wrongKey.trigger('click')
    expect(wrongKey.classes()).toContain('incorrect')
    vi.advanceTimersByTime(449)
    await wrapper.vm.$nextTick()
    expect(wrongKey.classes()).toContain('incorrect')
    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()
    expect(wrongKey.classes()).not.toContain('incorrect')

    while (!wrapper.find('.info-strip.complete').exists()) {
      const next = wrapper.get('.prompt-text .current').text()
      await wrapper.get(`[data-key="${next}"]`).trigger('click')
    }
    expect(wrapper.find('.key.correct').exists()).toBe(true)
    vi.advanceTimersByTime(450)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.key.correct').exists()).toBe(false)
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
    window.dispatchEvent(new Event('pageshow'))
    vi.advanceTimersByTime(1000)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:03')
    wrapper.unmount()
  })

  it.each([
    ['小数', 1.5],
    ['負数', -1],
    ['文字列', '2'],
    ['null', null],
    ['配列', [2]],
  ])('questionIndexが%sの保存データでも初期状態で起動する', (_label, questionIndex) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, questionIndex }))
    const wrapper = mount(App)
    expect(wrapper.get('[data-testid="hand-left"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.prompt-text').text()).toHaveLength(1)
    wrapper.unmount()
  })

  it('questionIndexがInfinityの保存データでも初期状態で起動する', () => {
    localStorage.setItem(STORAGE_KEY, `{"version":${STORAGE_VERSION},"questionIndex":1e400}`)
    const wrapper = mount(App)
    expect(wrapper.get('.prompt-text').text()).toHaveLength(1)
    wrapper.unmount()
  })

  it('未知versionの保存データを破棄して起動する', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION + 1, questionIndex: 4 }))
    const wrapper = mount(App)
    expect(wrapper.get('[data-testid="hand-left"]').attributes('aria-pressed')).toBe('true')
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    wrapper.unmount()
  })

  it('クリア後に連打・再マウントしても結果を一度だけ加算する', async () => {
    const first = mount(App)
    const expected = first.get('.prompt-text .current').text()
    const key = first.get(`[data-key="${expected}"]`)
    await key.trigger('click')
    await key.trigger('click')
    await key.trigger('click')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).results.completedQuestions).toBe(1)
    first.unmount()

    const restored = mount(App)
    expect(restored.get('.stats').text()).toContain('クリア1問')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).results.completedQuestions).toBe(1)
    restored.unmount()
  })

  it('途中入力後の左右切替・レベル切替で位置・ミス・時間をリセットする', async () => {
    const wrapper = mount(App)
    await wrapper.get('[data-testid="level-2"]').trigger('click')

    async function addProgressAndMistake() {
      const expected = wrapper.get('.prompt-text .current').text()
      await wrapper.get(`[data-key="${expected}"]`).trigger('click')
      const nextExpected = wrapper.get('.prompt-text .current').text()
      const wrongKey = wrapper.findAll('.key').find((keyWrapper) => keyWrapper.attributes('data-key') !== nextExpected)
      await wrongKey.trigger('click')
      vi.advanceTimersByTime(2000)
      await wrapper.vm.$nextTick()
      expect(wrapper.findAll('.prompt-text .done')).toHaveLength(1)
      expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('1')
      expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:02')
    }

    await addProgressAndMistake()
    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    expect(wrapper.findAll('.prompt-text .done')).toHaveLength(0)
    expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('0')
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:00')

    await addProgressAndMistake()
    await wrapper.get('[data-testid="level-3"]').trigger('click')
    expect(wrapper.findAll('.prompt-text .done')).toHaveLength(0)
    expect(wrapper.get('[data-testid="mistakes"]').text()).toBe('0')
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:00')
    wrapper.unmount()
  })

  it('計時中は5秒ごとに途中経過を保存する', async () => {
    const wrapper = mount(App)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    vi.advanceTimersByTime(5000)
    await wrapper.vm.$nextTick()
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(saved.version).toBe(STORAGE_VERSION)
    expect(saved.session.elapsedMs).toBe(5000)
    wrapper.unmount()
  })

  it('次キー・ホームポジション・ライブ案内をVoiceOver向けに提供する', async () => {
    const wrapper = mount(App)
    const expected = wrapper.get('.prompt-text .current').text()
    expect(wrapper.get('.prompt-text .current').attributes('aria-current')).toBe('step')
    expect(wrapper.get(`[data-key="${expected}"]`).attributes('aria-current')).toBe('true')
    expect(wrapper.get('[data-key="f"]').attributes('aria-label')).toContain('ホームポジション')
    expect(wrapper.get('.feedback').text()).toMatch(/次は.+キーを.+指で押してください/)

    await wrapper.get('[data-testid="level-2"]').trigger('click')
    const firstExpected = wrapper.get('.prompt-text .current').text()
    const wrongKey = wrapper.findAll('.key').find((keyWrapper) => keyWrapper.attributes('data-key') !== firstExpected)
    await wrongKey.trigger('click')
    expect(wrapper.get('.feedback').text()).toContain('不正解')
    expect(wrapper.get('.feedback').text()).toContain(firstExpected.toUpperCase())

    await wrapper.get(`[data-key="${firstExpected}"]`).trigger('click')
    expect(wrapper.get('.feedback').text()).toContain('正解。次は')
    wrapper.unmount()
  })

  it('クリア表示を600ms保ってから自動で次の問題へ進み、遷移中の入力を無視する', async () => {
    const wrapper = mount(App)
    const firstQuestion = wrapper.get('.prompt-text').text()
    await completeCurrentQuestion(wrapper)

    expect(wrapper.get('.info-strip').classes()).toContain('complete')
    expect(wrapper.get('.prompt-text').text()).toContain('✓')
    expect(wrapper.get('.keyboard-panel').classes()).toContain('complete')
    expect(wrapper.get('.feedback').text()).toBe('クリア！ 自動で次の問題に進みます')
    expect(wrapper.find('[data-testid="next-question"]').exists()).toBe(false)
    expect(wrapper.findAll('.key').every((key) => key.element.disabled)).toBe(true)

    wrapper.getComponent(KeyboardView).vm.$emit('press', 'x')
    await wrapper.vm.$nextTick()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).session.attempts).toBe(1)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).results.completedQuestions).toBe(1)

    vi.advanceTimersByTime(AUTO_ADVANCE_MS - 1)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.info-strip').classes()).toContain('complete')
    expect(wrapper.get('.prompt-text').text()).toContain(firstQuestion)

    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.info-strip').classes()).not.toContain('complete')
    expect(wrapper.get('.prompt-text').text()).not.toBe(firstQuestion)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).questionIndex).toBe(1)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).results.completedQuestions).toBe(1)
    wrapper.unmount()
  })

  it('やり直し・手・レベル・記号設定の変更で自動遷移予約をキャンセルする', async () => {
    const cases = [
      {
        action: (wrapper) => wrapper.get('[data-testid="reset"]').trigger('click'),
      },
      {
        action: (wrapper) => wrapper.get('[data-testid="hand-right"]').trigger('click'),
      },
      {
        action: (wrapper) => wrapper.get('[data-testid="level-2"]').trigger('click'),
      },
      {
        setup: (wrapper) => wrapper.get('[data-testid="hand-right"]').trigger('click'),
        action: (wrapper) => wrapper.get('[data-testid="include-symbols"]').setValue(true),
      },
    ]

    for (const testCase of cases) {
      const wrapper = mount(App)
      if (testCase.setup) await testCase.setup(wrapper)
      await completeCurrentQuestion(wrapper)
      await testCase.action(wrapper)
      const changedQuestion = wrapper.get('.prompt-text').text()
      vi.advanceTimersByTime(AUTO_ADVANCE_MS)
      await wrapper.vm.$nextTick()
      expect(wrapper.get('.prompt-text').text()).toBe(changedQuestion)
      expect(wrapper.get('.info-strip').classes()).not.toContain('complete')
      wrapper.unmount()
      localStorage.clear()
    }
  })

  it('クリア済みのversion 1保存データを復元しても自動で次へ進み、結果を二重加算しない', async () => {
    const settings = { hand: 'left', level: 1, includeSymbols: false, layoutVariant: 'jis' }
    const question = getQuestion(settings, 0)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      settings,
      results: { completedQuestions: 1, correctCount: 1, mistakes: 0, attempts: 1, practiceMs: 250 },
      questionIndex: 0,
      session: { question, position: 1, elapsedMs: 250 },
    }))

    const wrapper = mount(App)
    expect(wrapper.get('.info-strip').classes()).toContain('complete')
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(saved.questionIndex).toBe(1)
    expect(saved.results.completedQuestions).toBe(1)
    expect(wrapper.get('.info-strip').classes()).not.toContain('complete')
    wrapper.unmount()
  })

  it('非表示中に自動遷移しても次問を一時停止し、再表示後に計時を再開する', async () => {
    const wrapper = mount(App)
    await completeCurrentQuestion(wrapper)

    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    await wrapper.vm.$nextTick()

    let saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(saved.questionIndex).toBe(1)
    expect(saved.session.isPaused).toBe(true)
    expect(saved.session.isComplete).toBe(false)

    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    window.dispatchEvent(new Event('pageshow'))
    vi.advanceTimersByTime(1400)
    await wrapper.vm.$nextTick()
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(wrapper.get('[data-testid="elapsed"]').text()).toBe('0:01')
    expect(saved.results.completedQuestions).toBe(1)
    wrapper.unmount()
  })

  it('アンマウント時に自動遷移を含む全タイマーを破棄する', async () => {
    const wrapper = mount(App)
    await completeCurrentQuestion(wrapper)
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    wrapper.unmount()
    // jsdomのlocalStorageはsetItemごとに0msタイマーを作る(Nodeの版で有無が変わる)ため、
    // タイマー総数ではなく「アンマウント後に時間が進んでも自動遷移・保存が走らない」ことを検証する。
    const savedAfterUnmount = localStorage.getItem(STORAGE_KEY)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 10)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(savedAfterUnmount)
    expect(JSON.parse(savedAfterUnmount).questionIndex).toBe(0)
  })

  it('JIS右手の記号キーへ読みやすいVoiceOver名と6.75ピッチを設定する', async () => {
    const wrapper = mount(App)
    expect(wrapper.get('.app-shell').attributes('style')).toContain('--keyboard-pitch-count: 5.75')
    await wrapper.get('[data-testid="hand-right"]').trigger('click')
    expect(wrapper.get('.app-shell').attributes('style')).toContain('--keyboard-pitch-count: 6.75')

    const labels = {
      ';': 'セミコロン',
      ',': 'カンマ',
      '.': 'ピリオド',
      '/': 'スラッシュ',
      '@': 'アットマーク',
      ':': 'コロン',
      _: 'アンダースコア',
    }
    for (const [key, reading] of Object.entries(labels)) {
      expect(wrapper.get(`[data-key="${key}"]`).attributes('aria-label')).toContain(`${reading}キー`)
    }
    expect(wrapper.get('.finger-legend-embedded').exists()).toBe(true)
    wrapper.unmount()
  })

  it('保存問題が選択中レイアウトの範囲外なら安全に新規問題へ切り替える', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      settings: { hand: 'right', level: 1, includeSymbols: false, layoutVariant: 'us' },
      questionIndex: 0,
      session: { question: '@', position: 1, isComplete: true, elapsedMs: 100 },
    }))
    const wrapper = mount(App)
    expect(wrapper.get('.prompt-text').text()).not.toContain('@')
    expect(wrapper.get('.prompt-text .current').exists()).toBe(true)
    expect(wrapper.get('.info-strip').classes()).not.toContain('complete')
    wrapper.unmount()
  })
})
