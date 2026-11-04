import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_ADVANCE_MS, CLOCK_TICK_MS } from '../appConfig.js'
import { getElapsedMs } from '../domain/practiceSession.js'
import { loadHistory } from '../services/history.js'
import { usePracticeEngine } from './usePracticeEngine.js'

const gasSource = readFileSync(resolve(process.cwd(), 'gas/Code.gs'), 'utf8')

function gasAcceptsRun(record) {
  const context = { JSON, Date, Object, Math, Number, String, Array, Set, isFinite }
  runInNewContext(gasSource, context)
  return context.normalizeRunRecord_(record) !== null
}

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

function createEngine(
  environment = createEnvironment(),
  storage = createMemoryStorage(),
  syncService = { recordCompletion: vi.fn(), recordRun: vi.fn() },
  options = {},
) {
  return {
    environment,
    storage,
    syncService,
    engine: usePracticeEngine({
      ...environment,
      storage,
      syncService,
      ...options,
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
    expect(vi.getTimerCount()).toBe(2)
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
    expect(vi.getTimerCount()).toBe(2)
    expect(listenerCount(environment.win)).toBe(2)

    engine.detach()
    engine.attach()
    expect(vi.getTimerCount()).toBe(2)
    expect(listenerCount(environment.win)).toBe(2)
    expect(listenerCount(environment.doc)).toBe(1)
    expect(listenerCount(environment.portrait)).toBe(1)

    engine.detach()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('表示時計は200ms以内で追従し、メニューを開いても表示秒が増えない', () => {
    const { engine } = createEngine()
    engine.startRun()
    engine.attach()

    vi.advanceTimersByTime(1950)
    expect(Date.now() - engine.now.value).toBeLessThanOrEqual(CLOCK_TICK_MS)
    expect(engine.elapsedMs.value).toBe(1800)
    expect(engine.runElapsedText.value).toBe('0:01')

    engine.openMenu()
    expect(engine.elapsedMs.value).toBe(1950)
    expect(engine.runElapsedText.value).toBe('0:01')

    engine.closeMenu()
    vi.advanceTimersByTime(50)
    expect(engine.elapsedMs.value).toBe(2000)
    expect(engine.runElapsedText.value).toBe('0:02')
  })

  it('細かい表示tickでも停止判定は1秒ごと、保存は5秒ごとに行う', () => {
    const environment = createEnvironment()
    const storage = createMemoryStorage()
    const matchesRead = vi.fn(() => false)
    Object.defineProperty(environment.portrait, 'matches', {
      configurable: true,
      get: matchesRead,
    })
    const save = vi.spyOn(storage, 'setItem')
    const { engine } = createEngine(environment, storage)
    engine.startRun()
    engine.attach()
    matchesRead.mockClear()
    save.mockClear()

    vi.advanceTimersByTime(1000 - CLOCK_TICK_MS)
    expect(matchesRead).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(CLOCK_TICK_MS)
    expect(matchesRead).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(4000)
    expect(matchesRead).toHaveBeenCalledTimes(5)
    expect(save).toHaveBeenCalledTimes(1)
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

  it('run開始前の今回の成績と表示時間はゼロになる', () => {
    const { engine } = createEngine()

    expect(engine.runSummary.value).toMatchObject({
      completedQuestions: 0,
      correctCount: 0,
      mistakes: 0,
      attempts: 0,
      inputMs: 0,
      accuracy: 100,
    })
    expect(engine.runElapsedText.value).toBe('0:00')
  })

  it('設定画面で待った時間はstartRun時の累計へ入れない', () => {
    const { engine } = createEngine()
    vi.advanceTimersByTime(5000)
    engine.startRun()

    expect(engine.results.value.practiceMs).toBe(0)
    expect(engine.run.value.baseline.practiceMs).toBe(0)
  })

  it('モード・問題数・制限時間の変更では問題番号を保ち、手・レベル・記号の変更では0へ戻す', () => {
    const { engine } = createEngine()
    engine.questionIndex.value = 4
    engine.updateSettings({ mode: 'timeAttack' })
    engine.updateSettings({ targetCount: 30 })
    engine.updateSettings({ timeLimitSec: 120 })
    expect(engine.questionIndex.value).toBe(4)

    engine.updateSettings({ level: 2 })
    expect(engine.questionIndex.value).toBe(0)
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

  it('終了確定時にmenu停止理由を解除し、次のstartRunも停止なしで始める', () => {
    const { engine } = createEngine()
    engine.startRun()
    engine.openMenu()
    engine.finishRun()
    expect(engine.pauseReasons.has('menu')).toBe(false)

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

  it('総経過時間はmenu・portrait・hiddenで止まり、最後の停止理由が外れると進む', () => {
    const { engine } = createEngine()
    engine.updateSettings({ mode: 'timeAttack' })
    engine.startRun()
    vi.advanceTimersByTime(2000)
    expect(engine.runActiveMs.value).toBe(0)

    engine.pressKey(engine.nextKey.value)
    engine.setPauseReason('menu', true, 103_000)
    expect(engine.runActiveMs.value).toBe(1000)
    engine.setPauseReason('portrait', true, 104_000)
    engine.setPauseReason('hidden', true, 105_000)
    engine.setPauseReason('menu', false, 110_000)
    engine.setPauseReason('portrait', false, 111_000)
    expect(engine.runActiveMs.value).toBe(1000)
    engine.setPauseReason('hidden', false, 112_000)
    engine.setPauseReason('menu', true, 114_000)
    expect(engine.runActiveMs.value).toBe(3000)
  })

  it('タイムアタックは最初のキーまで時計を動かさず、全問完了時に確定して以後の入力を無視する', () => {
    const { engine, storage } = createEngine()
    engine.updateSettings({ mode: 'timeAttack', targetCount: 10 })
    engine.startRun()
    vi.advanceTimersByTime(5000)
    expect(engine.runActiveMs.value).toBe(0)
    expect(engine.elapsedMs.value).toBe(0)

    for (let index = 0; index < 10; index += 1) {
      vi.advanceTimersByTime(100)
      engine.pressKey(engine.nextKey.value)
      if (index < 9) vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    }

    expect(engine.runSummary.value).toMatchObject({
      endedBy: 'completed',
      completedQuestions: 10,
      targetCount: 10,
      activeMs: 6300,
    })
    expect(loadHistory(storage)[0]).toMatchObject({ endedBy: 'completed', activeMs: 6300 })
    const attempts = engine.runSummary.value.attempts
    engine.pressKey('a')
    expect(engine.runSummary.value.attempts).toBe(attempts)
    expect(loadHistory(storage)).toHaveLength(1)
    expect(engine.resultReady.value).toBe(false)
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    expect(engine.resultReady.value).toBe(true)
  })

  it('制限時間で入力途中を完了に数えず成績へ含め、時間切れ後の入力を無視する', () => {
    const { engine, storage } = createEngine()
    engine.updateSettings({ mode: 'timeLimit', timeLimitSec: 30, level: 2 })
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    vi.advanceTimersByTime(1000)
    const wrong = engine.nextKey.value === 'a' ? 's' : 'a'
    engine.pressKey(wrong)
    vi.advanceTimersByTime(29_000)
    engine.pressKey(engine.nextKey.value)

    expect(engine.runSummary.value).toMatchObject({
      endedBy: 'timeUp',
      activeMs: 30_000,
      inputMs: 30_000,
      completedQuestions: 0,
      correctCount: 1,
      mistakes: 1,
      attempts: 2,
    })
    engine.pressKey(engine.nextKey.value)
    expect(engine.runSummary.value.attempts).toBe(2)
    expect(loadHistory(storage)[0]).toMatchObject({ endedBy: 'timeUp', completedQuestions: 0 })
  })

  it('メニュー中は制限時間にならず、再開後に残り時間を使い切ると終了する', () => {
    const { engine } = createEngine()
    engine.updateSettings({ mode: 'timeLimit', timeLimitSec: 30, level: 2 })
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    vi.advanceTimersByTime(29_000)
    engine.openMenu()
    vi.advanceTimersByTime(10_000)
    expect(engine.run.value.summary).toBeNull()
    expect(engine.runActiveMs.value).toBe(29_000)
    engine.closeMenu()
    vi.advanceTimersByTime(1000)
    engine.pressKey(engine.nextKey.value)
    expect(engine.runSummary.value.endedBy).toBe('timeUp')
  })

  it('手動終了はendedとなり、二重終了・入力なし・設定へ戻る場合は履歴を重複または追加しない', () => {
    const { engine, storage } = createEngine()
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    expect(engine.finishRun({ endedBy: 'ended' }).endedBy).toBe('ended')
    engine.finishRun({ endedBy: 'ended' })
    expect(loadHistory(storage)).toHaveLength(1)

    engine.startRun()
    engine.finishRun({ endedBy: 'ended' })
    expect(loadHistory(storage)).toHaveLength(1)

    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    engine.abandonRun()
    expect(loadHistory(storage)).toHaveLength(1)
  })

  it('履歴と同じIDのrun記録を終了時に一度だけ送り、設定へ戻る場合は送らない', () => {
    const syncService = { recordCompletion: vi.fn(), recordRun: vi.fn().mockResolvedValue(true) }
    const { engine, storage } = createEngine(createEnvironment(), createMemoryStorage(), syncService)
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    engine.finishRun({ endedBy: 'ended' })
    engine.finishRun({ endedBy: 'ended' })

    expect(syncService.recordRun).toHaveBeenCalledTimes(1)
    const sent = syncService.recordRun.mock.calls[0][0]
    const history = loadHistory(storage)[0]
    expect(sent.id).toBe(history.id)
    expect(sent).toMatchObject({
      ts: history.ts,
      mode: 'free',
      hand: 'left',
      level: 1,
      includeSymbols: false,
      layout: 'jis',
      homePosition: false,
      endedBy: 'ended',
      attempts: 1,
      rankVersion: null,
      appVersion: history.appVersion,
    })
    expect(sent).not.toHaveProperty('v')

    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    engine.abandonRun()
    expect(syncService.recordRun).toHaveBeenCalledTimes(1)
  })

  it('3モードの全終了形でエンジンが作るrunをGASが受理する', () => {
    vi.setSystemTime(Date.UTC(2026, 10, 5, 3, 0, 0))
    const records = []
    const createCapturingEngine = () => createEngine(
      createEnvironment(),
      createMemoryStorage(),
      {
        recordCompletion: vi.fn(),
        recordRun: vi.fn((record) => {
          records.push(record)
          return Promise.resolve(true)
        }),
      },
    ).engine

    const free = createCapturingEngine()
    free.updateSettings({ mode: 'free', level: 2 })
    free.startRun()
    vi.advanceTimersByTime(400)
    free.pressKey(free.nextKey.value)
    free.pressKey(free.nextKey.value === 'a' ? 's' : 'a')
    free.resetQuestion()
    vi.advanceTimersByTime(600)
    free.pressKey(free.nextKey.value)
    free.finishRun({ endedBy: 'ended' })

    const timeAttackEnded = createCapturingEngine()
    timeAttackEnded.updateSettings({ mode: 'timeAttack', targetCount: 10 })
    timeAttackEnded.startRun()
    timeAttackEnded.pressKey(timeAttackEnded.nextKey.value)
    timeAttackEnded.finishRun({ endedBy: 'ended' })

    const timeAttackCompleted = createCapturingEngine()
    timeAttackCompleted.updateSettings({ mode: 'timeAttack', targetCount: 10 })
    timeAttackCompleted.startRun()
    for (let index = 0; index < 10; index += 1) {
      timeAttackCompleted.pressKey(timeAttackCompleted.nextKey.value)
      if (index < 9) vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    }

    const timeLimitEnded = createCapturingEngine()
    timeLimitEnded.updateSettings({ mode: 'timeLimit', timeLimitSec: 30 })
    timeLimitEnded.startRun()
    timeLimitEnded.pressKey(timeLimitEnded.nextKey.value)
    vi.advanceTimersByTime(500)
    timeLimitEnded.finishRun({ endedBy: 'ended' })

    const timeLimitUp = createCapturingEngine()
    timeLimitUp.updateSettings({ mode: 'timeLimit', timeLimitSec: 30 })
    timeLimitUp.startRun()
    timeLimitUp.pressKey(timeLimitUp.nextKey.value)
    vi.advanceTimersByTime(30_000)
    timeLimitUp.pressKey(timeLimitUp.nextKey.value)

    expect(records.map(({ mode, endedBy }) => [mode, endedBy])).toEqual([
      ['free', 'ended'],
      ['timeAttack', 'ended'],
      ['timeAttack', 'completed'],
      ['timeLimit', 'ended'],
      ['timeLimit', 'timeUp'],
    ])
    records.forEach((record) => {
      expect(record.correctCount + record.mistakes).toBe(record.attempts)
      expect(gasAcceptsRun(record), `${record.mode}/${record.endedBy}`).toBe(true)
    })
  })

  it('run記録の同期例外・Promise rejectでも結果確定を止めない', async () => {
    const throwing = {
      recordCompletion: vi.fn(),
      recordRun: vi.fn(() => { throw new Error('boom') }),
    }
    const first = createEngine(createEnvironment(), createMemoryStorage(), throwing).engine
    first.startRun()
    first.pressKey(first.nextKey.value)
    expect(first.finishRun({ endedBy: 'ended' })).toMatchObject({ attempts: 1, endedBy: 'ended' })

    const rejecting = {
      recordCompletion: vi.fn(),
      recordRun: vi.fn(() => Promise.reject(new Error('offline'))),
    }
    const second = createEngine(createEnvironment(), createMemoryStorage(), rejecting).engine
    second.startRun()
    second.pressKey(second.nextKey.value)
    expect(second.finishRun({ endedBy: 'ended' })).toMatchObject({ attempts: 1, endedBy: 'ended' })
    await Promise.resolve()
  })

  it('attach中は表示時計のtickで制限時間が終了し、総経過時間は制限時間に収まる', () => {
    const { engine, storage } = createEngine()
    engine.attach()
    engine.updateSettings({ mode: 'timeLimit', timeLimitSec: 30, level: 2 })
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    vi.advanceTimersByTime(29_800)
    expect(engine.run.value.summary).toBeNull()
    vi.advanceTimersByTime(CLOCK_TICK_MS * 2)
    expect(engine.runSummary.value).toMatchObject({ endedBy: 'timeUp', activeMs: 30_000 })
    expect(engine.resultReady.value).toBe(true)
    expect(loadHistory(storage)).toHaveLength(1)
    engine.detach()
  })

  it('停止の直前に制限時間を過ぎていたら、portrait同期でも停止ではなく時間切れで終える', () => {
    const environment = createEnvironment()
    const { engine } = createEngine(environment)
    engine.attach()
    engine.updateSettings({ mode: 'timeLimit', timeLimitSec: 30, level: 2 })
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    // 時計のtickが走る前に30.5秒たち、向きが縦に変わった状態(pageshowなどの同期経路)
    vi.setSystemTime(130_500)
    environment.portrait.matches = true
    environment.win.listeners.get('pageshow').forEach((listener) => listener())
    expect(engine.runSummary.value).toMatchObject({ endedBy: 'timeUp', activeMs: 30_000 })
    engine.detach()
  })

  it('停止の理由が残ったままstartRunしても、停止中は時計を動かさない', () => {
    const environment = createEnvironment()
    const { engine } = createEngine(environment)
    environment.doc.hidden = true
    engine.setPauseReason('hidden', true)
    engine.startRun()
    vi.advanceTimersByTime(5000)
    // 停止が解除される前(停止中)に終えても、総経過時間は進まない
    expect(engine.finishRun({ endedBy: 'ended' }).activeMs).toBe(0)
  })

  it('停止の理由が残ったままstartRunしても、解除した時点から時計が動き出す', () => {
    const environment = createEnvironment()
    const { engine } = createEngine(environment)
    environment.doc.hidden = true
    engine.setPauseReason('hidden', true)
    engine.startRun()
    vi.advanceTimersByTime(5000)
    environment.doc.hidden = false
    engine.setPauseReason('hidden', false)
    vi.advanceTimersByTime(2000)
    expect(engine.finishRun({ endedBy: 'ended' }).activeMs).toBe(2000)
  })

  it('startRunは残っているmenu停止理由を外して始める', () => {
    const { engine } = createEngine()
    engine.setPauseReason('menu', true)
    engine.startRun()
    expect(engine.pauseReasons.has('menu')).toBe(false)
  })

  it('終了したrunでは、自動で次へ進むタイマーが残らない', () => {
    const { engine } = createEngine()
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    expect(engine.session.value.isComplete).toBe(true)
    engine.finishRun({ endedBy: 'ended' })
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2)
    expect(engine.questionIndex.value).toBe(0)
    expect(engine.session.value.isComplete).toBe(true)
  })

  it('前のrunで最後に完了した問題から続けて始めず、完了していなければ同じ問題で始める', () => {
    const { engine } = createEngine()
    engine.startRun()
    const first = engine.session.value.question
    engine.pressKey(engine.nextKey.value)
    engine.finishRun({ endedBy: 'ended' })
    engine.startRun()
    expect(engine.questionIndex.value).toBe(1)
    expect(engine.session.value.question).not.toBe(first)
    expect(engine.session.value.isComplete).toBe(false)

    const second = engine.session.value.question
    engine.finishRun({ endedBy: 'ended' })
    engine.startRun()
    expect(engine.questionIndex.value).toBe(1)
    expect(engine.session.value.question).toBe(second)
  })

  it('タイムアタック・制限時間では、やり直しと全リセットをエンジンも拒否する', () => {
    const { engine } = createEngine()
    engine.updateSettings({ mode: 'timeAttack' })
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    const attempts = engine.runSummary.value.attempts
    expect(engine.resetQuestion()).toBe(false)
    expect(engine.resetAllStats()).toBe(false)
    expect(engine.runSummary.value.attempts).toBe(attempts)

    engine.finishRun({ endedBy: 'ended' })
    engine.updateSettings({ mode: 'free' })
    engine.startRun()
    expect(engine.resetQuestion()).toBe(true)
    expect(engine.resetAllStats()).toBe(true)
  })

  it('finishRunで分析を一度だけ確定し、keys・rankVersion・messageIdを履歴とrun送信へ入れる', () => {
    const storage = createMemoryStorage()
    const syncService = { recordCompletion: vi.fn(), recordRun: vi.fn() }
    const random = vi.fn(() => 0)
    const { engine } = createEngine(createEnvironment(), storage, syncService, { random })
    engine.updateSettings({ mode: 'timeAttack', level: 2, targetCount: 10 })
    engine.startRun()
    const [first, second] = engine.session.value.question
    const wrong = first === 'a' ? 's' : 'a'
    engine.pressKey(wrong)
    engine.pressKey(wrong)
    engine.pressKey(first)
    if (second) engine.pressKey(second)
    vi.advanceTimersByTime(1000)

    const summary = engine.finishRun({ endedBy: 'completed' })
    const firstAnalysis = summary.analysis
    engine.finishRun({ endedBy: 'completed' })

    expect(engine.run.value.summary.analysis).toBe(firstAnalysis)
    expect(random).toHaveBeenCalledTimes(1)
    expect(firstAnalysis).toMatchObject({ rankVersion: 1, rank: expect.any(String) })
    const history = loadHistory(storage)[0]
    expect(history.keys[first]).toEqual([1, 2])
    if (second) expect(history.keys[second][0]).toBe(1)
    expect(history).toMatchObject({ rankVersion: 1, messageId: firstAnalysis.message.id })
    expect(syncService.recordRun).toHaveBeenCalledWith(expect.objectContaining({
      keys: history.keys,
      rankVersion: 1,
      messageId: firstAnalysis.message.id,
    }))
  })

  it('途中終了とフリーにはランク・自己ベスト・rankVersionを付けない', () => {
    const storage = createMemoryStorage()
    const competitive = createEngine(createEnvironment(), storage).engine
    competitive.updateSettings({ mode: 'timeLimit', timeLimitSec: 30 })
    competitive.startRun()
    competitive.pressKey(competitive.nextKey.value)
    const ended = competitive.finishRun({ endedBy: 'ended' })
    expect(ended.analysis).toMatchObject({ rank: null, rankVersion: null, personalBest: null })
    expect(loadHistory(storage)[0].rankVersion).toBeNull()

    const freeStorage = createMemoryStorage()
    const free = createEngine(createEnvironment(), freeStorage).engine
    free.startRun()
    free.pressKey(free.nextKey.value)
    const freeSummary = free.finishRun({ endedBy: 'ended' })
    expect(freeSummary.analysis).toMatchObject({ rank: null, rankVersion: null, personalBest: null })
    expect(loadHistory(freeStorage)[0].rankVersion).toBeNull()
  })

  it('フリー2回目は同条件の直前runと比べて成長と応援メッセージを出す', () => {
    const random = vi.fn(() => 0)
    const { engine } = createEngine(createEnvironment(), createMemoryStorage(), undefined, { random })

    engine.startRun()
    const firstKey = engine.nextKey.value
    engine.pressKey(firstKey === 'a' ? 's' : 'a')
    vi.advanceTimersByTime(2000)
    engine.pressKey(firstKey)
    engine.finishRun({ endedBy: 'ended' })

    engine.startRun()
    vi.advanceTimersByTime(1000)
    engine.pressKey(engine.nextKey.value)
    const second = engine.finishRun({ endedBy: 'ended' })

    expect(second.analysis).toMatchObject({ rank: null, personalBest: null })
    expect(second.analysis.growth.improvements.map(({ type }) => type)).toEqual(['kpm', 'accuracy', 'mistakes'])
    expect(second.analysis.message.id).toMatch(/^accuracy-/)
    expect(second.analysis.message.text).toContain('正確さ')
  })

  it('最後に表示したmessageIdを履歴から初期化し、入力ゼロの結果間でも更新する', () => {
    const storage = createMemoryStorage()
    const firstEngine = createEngine(
      createEnvironment(), storage, undefined, { random: () => 0 },
    ).engine

    firstEngine.startRun()
    vi.advanceTimersByTime(1000)
    firstEngine.pressKey(firstEngine.nextKey.value)
    firstEngine.finishRun({ endedBy: 'ended' })
    firstEngine.startRun()
    vi.advanceTimersByTime(1000)
    firstEngine.pressKey(firstEngine.nextKey.value)
    const saved = firstEngine.finishRun({ endedBy: 'ended' })
    expect(saved.analysis.message.id).toBe('general-free-1')

    const reloaded = createEngine(
      createEnvironment(), storage, undefined, { random: () => 0 },
    ).engine
    reloaded.startRun()
    const firstZeroInput = reloaded.finishRun({ endedBy: 'ended' })
    reloaded.startRun()
    const secondZeroInput = reloaded.finishRun({ endedBy: 'ended' })

    expect(firstZeroInput.attempts).toBe(0)
    expect(firstZeroInput.analysis.message.id).toBe('general-free-2')
    expect(secondZeroInput.attempts).toBe(0)
    expect(secondZeroInput.analysis.message.id).toBe('general-free-1')
    expect(loadHistory(storage)).toHaveLength(2)
  })

  it('履歴に残らない入力ゼロの結果が続いても同じmessageIdを繰り返さない', () => {
    const { engine, storage } = createEngine(
      createEnvironment(), createMemoryStorage(), undefined, { random: () => 0 },
    )

    engine.startRun()
    const first = engine.finishRun({ endedBy: 'ended' })
    engine.startRun()
    const second = engine.finishRun({ endedBy: 'ended' })

    expect(first.attempts).toBe(0)
    expect(second.attempts).toBe(0)
    expect(first.analysis.message.id).toBe('first-1')
    expect(second.analysis.message.id).toBe('first-2')
    expect(loadHistory(storage)).toEqual([])
  })

  it('競技モードを完了した回はKPMを算出できなくてもrankVersionを残す', () => {
    const { engine, storage } = createEngine()
    engine.updateSettings({ mode: 'timeAttack' })
    engine.startRun()
    engine.pressKey(engine.nextKey.value)
    const result = engine.finishRun({ endedBy: 'completed' })
    expect(result.kpm).toBeNull()
    expect(result.analysis).toMatchObject({ rank: null, rankVersion: 1, personalBest: null })
    expect(loadHistory(storage)[0].rankVersion).toBe(1)
  })

  it('制限時間切れの途中問題も、実際に打ったキーだけkeysへ含める', () => {
    const { engine, storage } = createEngine()
    engine.updateSettings({ mode: 'timeLimit', timeLimitSec: 30, level: 2 })
    engine.startRun()
    const first = engine.nextKey.value
    engine.pressKey(first)
    const second = engine.nextKey.value
    engine.pressKey(second === 'a' ? 's' : 'a')
    vi.advanceTimersByTime(30_000)
    engine.pressKey(second)

    const keys = loadHistory(storage)[0].keys
    expect(keys[first][0]).toBe(1)
    expect(keys[second]).toEqual([1, 1])
  })
})
