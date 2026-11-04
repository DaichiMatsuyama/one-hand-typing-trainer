import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_ADVANCE_MS } from '../appConfig.js'
import { getElapsedMs } from '../domain/practiceSession.js'
import { usePracticeEngine } from './usePracticeEngine.js'

function createMemoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function createEventSource(extra = {}) {
  const listeners = new Map()
  return {
    ...extra,
    listeners,
    addEventListener: vi.fn((type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    }),
    removeEventListener: vi.fn((type, listener) => {
      listeners.get(type)?.delete(listener)
    }),
  }
}

function createEnvironment() {
  const portrait = createEventSource({ matches: false })
  const doc = createEventSource({ hidden: false })
  const win = createEventSource({ matchMedia: vi.fn(() => portrait) })
  return { portrait, doc, win }
}

function listenerCount(source) {
  return [...source.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0)
}

function createEngine(environment = createEnvironment(), storage = createMemoryStorage()) {
  return {
    environment,
    storage,
    engine: usePracticeEngine({
      ...environment,
      storage,
      syncService: { recordCompletion: vi.fn() },
    }),
  }
}

describe('usePracticeEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('停止理由が一つでもあれば停止し、すべて外れたときだけ再開する', () => {
    const { engine } = createEngine()
    engine.startRun()

    expect(engine.setPauseReason('hidden', true, 101_000)).toBe(true)
    expect(engine.session.value.isPaused).toBe(true)
    expect(engine.session.value.elapsedMs).toBe(1000)

    expect(engine.setPauseReason('hidden', true, 102_000)).toBe(false)
    expect(engine.setPauseReason('menu', true, 103_000)).toBe(true)
    expect(engine.setPauseReason('hidden', false, 104_000)).toBe(true)
    expect(engine.session.value.isPaused).toBe(true)
    expect(getElapsedMs(engine.session.value, 105_000)).toBe(1000)

    expect(engine.setPauseReason('menu', false, 105_000)).toBe(true)
    expect(engine.session.value.isPaused).toBe(false)
    expect(getElapsedMs(engine.session.value, 107_000)).toBe(3000)
    expect(engine.setPauseReason('menu', false, 108_000)).toBe(false)
    expect(engine.session.value.isPaused).toBe(false)
  })

  it.each([
    ['hiddenを先に外す', 'hidden', false],
    ['menuを先に外す(hidden)', 'hidden', true],
    ['portraitを先に外す', 'portrait', false],
    ['menuを先に外す(portrait)', 'portrait', true],
  ])('menuとの複合停止で%s場合も、最後の理由が外れるまで再開しない', (_label, other, menuFirst) => {
    const { engine } = createEngine()
    engine.startRun()
    engine.setPauseReason('menu', true, 101_000)
    engine.setPauseReason(other, true, 102_000)

    engine.setPauseReason(menuFirst ? 'menu' : other, false, 110_000)
    expect(engine.session.value.isPaused).toBe(true)
    expect(getElapsedMs(engine.session.value, 119_000)).toBe(1000)

    engine.setPauseReason(menuFirst ? other : 'menu', false, 120_000)
    expect(engine.session.value.isPaused).toBe(false)
    expect(getElapsedMs(engine.session.value, 121_000)).toBe(2000)
  })

  it('detachでタイマーとすべてのリスナーを解除する', () => {
    const { engine, environment } = createEngine()

    engine.attach()
    expect(vi.getTimerCount()).toBe(1)
    expect(listenerCount(environment.win)).toBe(2)
    expect(listenerCount(environment.doc)).toBe(1)
    expect(listenerCount(environment.portrait)).toBe(1)

    engine.detach()
    expect(vi.getTimerCount()).toBe(0)
    expect(listenerCount(environment.win)).toBe(0)
    expect(listenerCount(environment.doc)).toBe(0)
    expect(listenerCount(environment.portrait)).toBe(0)
  })

  it('detach後にattachし直してもタイマーとリスナーを二重登録しない', () => {
    const { engine, environment } = createEngine()

    engine.attach()
    engine.attach()
    expect(vi.getTimerCount()).toBe(1)
    expect(listenerCount(environment.win)).toBe(2)

    engine.detach()
    engine.attach()
    expect(vi.getTimerCount()).toBe(1)
    expect(listenerCount(environment.win)).toBe(2)
    expect(listenerCount(environment.doc)).toBe(1)
    expect(listenerCount(environment.portrait)).toBe(1)

    engine.detach()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('startRunは累計をbaselineにして今回をゼロから始める', () => {
    const { engine } = createEngine()
    engine.results.value = {
      completedQuestions: 4,
      correctCount: 20,
      mistakes: 2,
      attempts: 22,
      practiceMs: 5000,
    }

    engine.startRun()
    expect(engine.results.value.completedQuestions).toBe(4)
    expect(engine.run.value.baseline).toEqual(engine.results.value)
    expect(engine.runSummary.value).toMatchObject({
      completedQuestions: 0,
      correctCount: 0,
      mistakes: 0,
      attempts: 0,
      inputMs: 0,
    })
  })

  it('設定画面で待った時間はstartRun時の累計へ入れない', () => {
    const { engine } = createEngine()
    vi.advanceTimersByTime(5000)
    engine.startRun()

    expect(engine.results.value.practiceMs).toBe(0)
    expect(engine.run.value.baseline.practiceMs).toBe(0)
  })

  it('メニューを開いた回数を数え、表示中の入力を無視する', () => {
    const { engine } = createEngine()
    engine.startRun()
    const expected = engine.nextKey.value

    expect(engine.openMenu()).toBe(true)
    expect(engine.openMenu()).toBe(false)
    engine.pressKey(expected)
    expect(engine.session.value.position).toBe(0)
    expect(engine.runSummary.value.menuOpenCount).toBe(1)
    engine.closeMenu()
    engine.openMenu()
    expect(engine.runSummary.value.menuOpenCount).toBe(2)
  })

  it('メニュー中は問題のやり直しと全成績リセットも無視する', () => {
    const { engine } = createEngine()
    engine.updateSettings({ level: 2 })
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    engine.openMenu()
    const sessionBefore = { ...engine.session.value }
    const resultsBefore = { ...engine.results.value }

    expect(engine.resetQuestion()).toBe(false)
    expect(engine.resetAllStats()).toBe(false)
    expect(engine.session.value).toEqual(sessionBefore)
    expect(engine.results.value).toEqual(resultsBefore)
  })

  it('前のmenu停止理由が残っていても次のstartRunで解除する', () => {
    const { engine } = createEngine()
    engine.startRun()
    engine.openMenu()
    engine.finishRun({ keepPaused: true })
    expect(engine.pauseReasons.has('menu')).toBe(true)

    engine.startRun()
    expect(engine.pauseReasons.has('menu')).toBe(false)
    expect(engine.session.value.isPaused).toBe(false)
  })

  it('全リセットでrunのbaselineもゼロへ戻す', () => {
    const { engine } = createEngine()
    engine.results.value = {
      completedQuestions: 2,
      correctCount: 8,
      mistakes: 2,
      attempts: 10,
      practiceMs: 3000,
    }
    engine.startRun()
    engine.resetAllStats()

    expect(engine.results.value).toEqual({
      completedQuestions: 0,
      correctCount: 0,
      mistakes: 0,
      attempts: 0,
      practiceMs: 0,
    })
    expect(engine.run.value.baseline).toEqual(engine.results.value)
    expect(engine.runSummary.value).toMatchObject({ correctCount: 0, mistakes: 0, inputMs: 0 })
  })

  it('全リセット後の入力を新しいbaselineから数える', () => {
    const { engine } = createEngine()
    engine.results.value = {
      completedQuestions: 2,
      correctCount: 8,
      mistakes: 2,
      attempts: 10,
      practiceMs: 3000,
    }
    engine.startRun()
    engine.resetAllStats()
    const wrong = engine.nextKey.value === 'a' ? 's' : 'a'
    engine.pressKey(wrong)

    expect(engine.runSummary.value).toMatchObject({ correctCount: 0, mistakes: 1, attempts: 1 })
  })

  it('再読み込み後の未移管sessionをstartRunで一度だけ累計へ移す', () => {
    const storage = createMemoryStorage()
    const first = createEngine(createEnvironment(), storage).engine
    first.updateSettings({ level: 2 })
    first.startRun()
    vi.advanceTimersByTime(1500)
    first.pressKey(first.nextKey.value)

    const second = createEngine(createEnvironment(), storage).engine
    expect(second.session.value.elapsedMs).toBe(1500)
    vi.advanceTimersByTime(5000)
    second.startRun()
    expect(second.results.value).toMatchObject({ correctCount: 1, attempts: 1, practiceMs: 1500 })
    expect(second.run.value.baseline).toEqual(second.results.value)

    second.startRun()
    expect(second.results.value).toMatchObject({ correctCount: 1, attempts: 1, practiceMs: 1500 })
  })

  it('finishRunで移管したsessionは再読み込み後に二重加算しない', () => {
    const storage = createMemoryStorage()
    const first = createEngine(createEnvironment(), storage).engine
    first.updateSettings({ level: 2 })
    first.startRun()
    vi.advanceTimersByTime(700)
    first.pressKey(first.nextKey.value)
    first.openMenu()
    first.finishRun()
    const finishedResults = { ...first.results.value }
    expect(first.session.value.preserved).toBe(true)

    const second = createEngine(createEnvironment(), storage).engine
    expect(second.session.value.preserved).toBe(true)
    second.startRun()
    expect(second.results.value).toEqual(finishedResults)
  })

  it('全リセット前のsessionは再読み込み後にも再加算しない', () => {
    const storage = createMemoryStorage()
    const first = createEngine(createEnvironment(), storage).engine
    first.updateSettings({ level: 2 })
    first.startRun()
    vi.advanceTimersByTime(800)
    first.pressKey(first.nextKey.value)
    first.resetAllStats()

    const second = createEngine(createEnvironment(), storage).engine
    second.startRun()
    expect(second.results.value).toEqual({
      completedQuestions: 0,
      correctCount: 0,
      mistakes: 0,
      attempts: 0,
      practiceMs: 0,
    })
  })

  it('クリア済みsessionは再読み込み後のstartRunで加算しない', () => {
    const storage = createMemoryStorage()
    const first = createEngine(createEnvironment(), storage).engine
    first.startRun()
    vi.advanceTimersByTime(400)
    first.pressKey(first.nextKey.value)
    const completedResults = { ...first.results.value }

    const second = createEngine(createEnvironment(), storage).engine
    expect(second.session.value.isComplete).toBe(true)
    second.startRun()
    expect(second.results.value).toEqual(completedResults)
  })

  it('完了済み1問と進行中1問をrun結果へ合計する', () => {
    const { engine } = createEngine()
    engine.updateSettings({ level: 2 })
    engine.startRun()
    vi.advanceTimersByTime(500)
    const firstQuestion = engine.session.value.question
    for (const key of firstQuestion) engine.pressKey(key)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    vi.advanceTimersByTime(900)
    engine.pressKey(engine.nextKey.value)
    const wrong = engine.nextKey.value === 'a' ? 's' : 'a'
    engine.pressKey(wrong)
    engine.openMenu()

    expect(engine.finishRun()).toMatchObject({
      completedQuestions: 1,
      correctCount: firstQuestion.length + 1,
      mistakes: 1,
      attempts: firstQuestion.length + 2,
      inputMs: 1400,
    })
  })
})
