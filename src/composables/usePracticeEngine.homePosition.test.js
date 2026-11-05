import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_ADVANCE_MS } from '../appConfig.js'
import { loadHistory } from '../services/history.js'
import { STORAGE_KEY } from '../services/storage.js'
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

function createEngine(settings = {}) {
  const storage = createMemoryStorage()
  const records = []
  const syncService = {
    recordCompletion: vi.fn(),
    recordRun: vi.fn((record) => {
      records.push(record)
      return Promise.resolve(true)
    }),
  }
  const engine = usePracticeEngine({
    ...createEnvironment(),
    storage,
    syncService,
  })
  engine.updateSettings({ homePosition: true, ...settings })
  return { engine, storage, syncService, records }
}

// Lv.1は1文字の問題なので、次のキーを1回押せば1問クリアになる
function clearQuestion(engine) {
  while (!engine.session.value.isComplete) engine.pressKey(engine.nextKey.value)
}

describe('usePracticeEngine ホームポジション確認', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 10, 5, 3, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('OFF(既定)は従来と完全に同じ', () => {
    it('既定のhomePositionはOFFで、runの集計は回数0・時間nullに固定される', () => {
      const { engine } = createEngine({ homePosition: false })
      engine.startRun()
      clearQuestion(engine)
      expect(engine.run.value.homePosition).toBe(false)
      expect(engine.runSummary.value).toMatchObject({
        homePosition: false, hpSuccessCount: 0, hpSkipCount: 0, hpAvgReturnMs: null, hpMinReturnMs: null,
      })
    })

    it('問題をクリアしても確認状態に入らず、600ms後に自動で次の問題へ進む', () => {
      const { engine } = createEngine({ homePosition: false })
      engine.startRun()
      const firstIndex = engine.questionIndex.value
      clearQuestion(engine)

      expect(engine.homePositionCheck.value).toBeNull()
      vi.advanceTimersByTime(AUTO_ADVANCE_MS - 1)
      expect(engine.questionIndex.value).toBe(firstIndex)
      vi.advanceTimersByTime(1)
      expect(engine.questionIndex.value).toBe(firstIndex + 1)
      expect(engine.session.value.isComplete).toBe(false)
    })

    it('OFFではタイムアタックの最終問題も従来どおり結果へ進む', () => {
      const { engine } = createEngine({ homePosition: false, mode: 'timeAttack', targetCount: 10 })
      engine.startRun()
      for (let index = 0; index < 10; index += 1) {
        clearQuestion(engine)
        if (index < 9) vi.advanceTimersByTime(AUTO_ADVANCE_MS)
      }
      expect(engine.runSummary.value).toMatchObject({ endedBy: 'completed', hpSuccessCount: 0, hpSkipCount: 0 })
      vi.advanceTimersByTime(AUTO_ADVANCE_MS)
      expect(engine.resultReady.value).toBe(true)
    })

    it('OFFで確認用の操作が呼ばれても何も起きない', () => {
      const { engine } = createEngine({ homePosition: false })
      engine.startRun()
      clearQuestion(engine)
      expect(engine.confirmHomePosition()).toBe(false)
      expect(engine.completeHomePosition()).toBe(false)
      expect(engine.skipHomePosition()).toBe(false)
      expect(engine.runSummary.value.hpSkipCount).toBe(0)
    })
  })

  describe('確認の流れ', () => {
    it('run開始直後の最初の問題の前には確認せず、クリアすると確認状態に入る(左手 A S D F)', () => {
      const { engine } = createEngine()
      engine.startRun()
      expect(engine.homePositionCheck.value).toBeNull()
      expect(engine.run.value.homePosition).toBe(true)

      clearQuestion(engine)
      expect(engine.homePositionCheck.value).toMatchObject({
        hand: 'left', keys: ['a', 's', 'd', 'f'], established: false, returnMs: null,
      })
    })

    it('右手の確認キーは J K L ;', () => {
      const { engine } = createEngine({ hand: 'right' })
      engine.startRun()
      clearQuestion(engine)
      expect(engine.homePositionCheck.value.keys).toEqual(['j', 'k', 'l', ';'])
      expect(engine.homePositionCheck.value.hand).toBe('right')
    })

    it('確認中は自動で次へ進まず、通常のキー入力・やり直し・全リセットを受け付けない', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      const index = engine.questionIndex.value
      const attempts = engine.session.value.attempts
      const completed = engine.runSummary.value.completedQuestions

      vi.advanceTimersByTime(60_000)
      expect(engine.questionIndex.value).toBe(index)
      expect(engine.session.value.isComplete).toBe(true)

      engine.pressKey('a')
      engine.pressKey(engine.session.value.question)
      expect(engine.session.value.attempts).toBe(attempts)
      expect(engine.runSummary.value.completedQuestions).toBe(completed)

      expect(engine.resetQuestion()).toBe(false)
      expect(engine.resetAllStats()).toBe(false)
      expect(engine.homePositionCheck.value).not.toBeNull()
      expect(engine.session.value.isComplete).toBe(true)
      expect(engine.runSummary.value.completedQuestions).toBe(completed)
    })

    it('確認が成立して接触が離れると成功として次の問題へ進む(600msを待たない)', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      const index = engine.questionIndex.value

      // 成立前の「離した」は何も起こさない
      expect(engine.completeHomePosition()).toBe(false)
      expect(engine.questionIndex.value).toBe(index)

      vi.advanceTimersByTime(700)
      expect(engine.confirmHomePosition()).toBe(true)
      expect(engine.homePositionCheck.value).toMatchObject({ established: true, returnMs: 700 })
      // 成立しただけでは進まない
      expect(engine.questionIndex.value).toBe(index)
      expect(engine.confirmHomePosition()).toBe(false)

      expect(engine.completeHomePosition()).toBe(true)
      expect(engine.questionIndex.value).toBe(index + 1)
      expect(engine.homePositionCheck.value).toBeNull()
      expect(engine.session.value.isComplete).toBe(false)
      expect(engine.runSummary.value).toMatchObject({
        hpSuccessCount: 1, hpSkipCount: 0, hpAvgReturnMs: 700, hpMinReturnMs: 700,
      })
      // 次の問題の入力を受け付ける
      clearQuestion(engine)
      expect(engine.runSummary.value.completedQuestions).toBe(2)
    })

    it('成立後に成立した状態から二重に成功を数えない', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.confirmHomePosition()
      expect(engine.completeHomePosition()).toBe(true)
      expect(engine.completeHomePosition()).toBe(false)
      expect(engine.skipHomePosition()).toBe(false)
      expect(engine.runSummary.value).toMatchObject({ hpSuccessCount: 1, hpSkipCount: 0 })
    })

    it('スキップは成功に数えず、スキップ回数だけを記録して次の問題へ進む', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      const index = engine.questionIndex.value

      expect(engine.skipHomePosition()).toBe(true)
      expect(engine.questionIndex.value).toBe(index + 1)
      expect(engine.homePositionCheck.value).toBeNull()
      expect(engine.runSummary.value).toMatchObject({
        hpSuccessCount: 0, hpSkipCount: 1, hpAvgReturnMs: null, hpMinReturnMs: null,
      })
    })

    it('4本が成立したあとでもスキップは成功に数えない', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.confirmHomePosition()
      expect(engine.skipHomePosition()).toBe(true)
      expect(engine.runSummary.value).toMatchObject({ hpSuccessCount: 0, hpSkipCount: 1 })
    })

    it('成功・スキップを数え、平均復帰時間(四捨五入)と最短復帰時間を集計する', () => {
      const { engine } = createEngine()
      engine.startRun()
      for (const wait of [1000, 2000, 500]) {
        clearQuestion(engine)
        vi.advanceTimersByTime(wait)
        engine.confirmHomePosition()
        engine.completeHomePosition()
        vi.advanceTimersByTime(100)
      }
      clearQuestion(engine)
      engine.skipHomePosition()

      expect(engine.runSummary.value).toMatchObject({
        homePosition: true,
        hpSuccessCount: 3,
        hpSkipCount: 1,
        hpAvgReturnMs: 1167,
        hpMinReturnMs: 500,
      })
    })

    it('最終問題で終わる前に「設定へ戻る」と、確認状態は捨てられ集計も作らない', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.abandonRun()
      expect(engine.homePositionCheck.value).toBeNull()
      expect(engine.run.value).toBeNull()
    })

    it('確認状態はlocalStorageへ保存しない', () => {
      const { engine, storage } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.confirmHomePosition()
      vi.advanceTimersByTime(6000)
      engine.openMenu()
      const saved = JSON.parse(storage.getItem(STORAGE_KEY))
      expect(JSON.stringify(saved)).not.toMatch(/established|returnMs|clearedActiveMs|homePositionCheck/)
      expect(saved.settings.homePosition).toBe(true)
    })

    it('runの設定値はrun開始時に固定され、結果と記録に反映される', () => {
      const { engine, records } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.confirmHomePosition()
      engine.completeHomePosition()
      engine.finishRun({ endedBy: 'ended' })
      expect(engine.runSummary.value.homePosition).toBe(true)
      expect(records[0].homePosition).toBe(true)
    })
  })

  describe('メニューなどの停止', () => {
    it('復帰時間は停止中(メニュー)を含まない実効クロックで測る', () => {
      const { engine } = createEngine()
      engine.startRun()
      vi.advanceTimersByTime(1000)
      clearQuestion(engine)
      vi.advanceTimersByTime(300)
      engine.openMenu()
      vi.advanceTimersByTime(5000)
      engine.closeMenu()
      vi.advanceTimersByTime(200)
      engine.confirmHomePosition()

      expect(engine.homePositionCheck.value.returnMs).toBe(500)
      engine.completeHomePosition()
      expect(engine.runSummary.value).toMatchObject({ hpAvgReturnMs: 500, hpMinReturnMs: 500 })
    })

    it('クリアより前に停止していた時間があっても、復帰時間はクリア時点の実効クロックから測る', () => {
      const { engine } = createEngine()
      engine.startRun()
      engine.openMenu()
      vi.advanceTimersByTime(5000)
      engine.closeMenu()
      vi.advanceTimersByTime(1000)
      clearQuestion(engine)
      vi.advanceTimersByTime(300)
      engine.confirmHomePosition()
      expect(engine.homePositionCheck.value.returnMs).toBe(300)
    })

    it('portrait/hiddenの停止中も復帰時間に含めない', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      vi.advanceTimersByTime(100)
      engine.setPauseReason('hidden', true)
      vi.advanceTimersByTime(9000)
      engine.setPauseReason('hidden', false)
      engine.setPauseReason('portrait', true)
      vi.advanceTimersByTime(9000)
      engine.setPauseReason('portrait', false)
      vi.advanceTimersByTime(250)
      engine.confirmHomePosition()
      expect(engine.homePositionCheck.value.returnMs).toBe(350)
    })

    it('メニューを閉じても自動では進まず、確認へ戻る', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      const index = engine.questionIndex.value
      engine.openMenu()
      engine.closeMenu()
      vi.advanceTimersByTime(60_000)
      expect(engine.questionIndex.value).toBe(index)
      expect(engine.homePositionCheck.value).not.toBeNull()
    })

    it.each(['menu', 'portrait', 'hidden'])('成立済みでも%sで停止すると未成立へ戻り、停止中の成立・成功・スキップを受け付けない', (reason) => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.confirmHomePosition()
      expect(engine.homePositionCheck.value.established).toBe(true)

      engine.setPauseReason(reason, true)
      expect(engine.homePositionCheck.value).toMatchObject({ established: false, returnMs: null })
      expect(engine.confirmHomePosition()).toBe(false)
      expect(engine.completeHomePosition()).toBe(false)
      expect(engine.skipHomePosition()).toBe(false)

      engine.setPauseReason(reason, false)
      // 再開後は、改めて4本を置き直すまで成功にならない
      expect(engine.completeHomePosition()).toBe(false)
      expect(engine.confirmHomePosition()).toBe(true)
      expect(engine.completeHomePosition()).toBe(true)
      expect(engine.runSummary.value.hpSuccessCount).toBe(1)
    })

    it('resetHomePositionは成立済みを未成立へ戻し(blurなど)、置き直すまで成功にならない', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.confirmHomePosition()
      engine.resetHomePosition()
      expect(engine.homePositionCheck.value).toMatchObject({ established: false, returnMs: null })
      expect(engine.completeHomePosition()).toBe(false)
      expect(engine.confirmHomePosition()).toBe(true)
      expect(engine.completeHomePosition()).toBe(true)
      // 確認中でなければ何も起きない
      expect(() => engine.resetHomePosition()).not.toThrow()
    })

    it('確認中にメニューから練習を終了しても、その確認は成功にもスキップにも数えない', () => {
      const { engine, records } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.confirmHomePosition()
      engine.completeHomePosition()
      clearQuestion(engine)
      engine.openMenu()
      engine.finishRun({ endedBy: 'ended' })

      expect(engine.homePositionCheck.value).toBeNull()
      expect(engine.runSummary.value).toMatchObject({ hpSuccessCount: 1, hpSkipCount: 0 })
      expect(records[0]).toMatchObject({ homePosition: true, hpSuccessCount: 1, hpSkipCount: 0 })
    })
  })

  describe('タイムアタック', () => {
    it('最終問題の後は確認せず、そこまでの各問題の後は確認して、結果へ進む', () => {
      const { engine } = createEngine({ mode: 'timeAttack', targetCount: 10 })
      engine.startRun()
      for (let index = 0; index < 10; index += 1) {
        clearQuestion(engine)
        if (index < 9) {
          expect(engine.homePositionCheck.value, `${index + 1}問目の後`).not.toBeNull()
          vi.advanceTimersByTime(400)
          engine.confirmHomePosition()
          engine.completeHomePosition()
        }
      }
      expect(engine.homePositionCheck.value).toBeNull()
      expect(engine.runSummary.value).toMatchObject({
        endedBy: 'completed', completedQuestions: 10, hpSuccessCount: 9, hpSkipCount: 0,
        hpAvgReturnMs: 400, hpMinReturnMs: 400,
      })
      expect(engine.resultReady.value).toBe(false)
      vi.advanceTimersByTime(AUTO_ADVANCE_MS)
      expect(engine.resultReady.value).toBe(true)
    })

    it('復帰時間は総経過時間(クリアタイム)に含まれるが、KPMの入力時間には含まれない', () => {
      const { engine } = createEngine({ mode: 'timeAttack', targetCount: 10 })
      engine.startRun()
      for (let index = 0; index < 10; index += 1) {
        vi.advanceTimersByTime(200)
        clearQuestion(engine)
        if (index < 9) {
          vi.advanceTimersByTime(1000)
          engine.confirmHomePosition()
          engine.completeHomePosition()
        }
      }
      // 総経過時間: 最初のキー(最初の200msは未開始)から最後のクリアまで = 9回の(確認1000 + 次の問題200)
      expect(engine.runSummary.value.activeMs).toBe(9 * 1200)
      // 入力時間: 各問題の出題から完了まで。1000msの確認は含まない。
      // 最初の問題は最初のキーで時計が始まるため0、以降の9問は出題の200ms後に押す。
      expect(engine.runSummary.value.inputMs).toBe(9 * 200)
    })

    it('フリーでも復帰時間は入力時間(KPM・時間表示)に含まれない', () => {
      const { engine } = createEngine({ mode: 'free' })
      engine.startRun()
      vi.advanceTimersByTime(300)
      clearQuestion(engine)
      vi.advanceTimersByTime(4000)
      engine.confirmHomePosition()
      engine.completeHomePosition()
      vi.advanceTimersByTime(200)
      clearQuestion(engine)
      const summary = engine.finishRun({ endedBy: 'ended' })
      expect(summary.inputMs).toBe(500)
      expect(summary.activeMs).toBe(4500)
    })
  })

  describe('制限時間', () => {
    it('毎問確認する(最後がないため)', () => {
      const { engine } = createEngine({ mode: 'timeLimit', timeLimitSec: 60 })
      engine.startRun()
      for (let index = 0; index < 5; index += 1) {
        clearQuestion(engine)
        expect(engine.homePositionCheck.value).not.toBeNull()
        engine.skipHomePosition()
      }
      expect(engine.runSummary.value).toMatchObject({ hpSkipCount: 5, completedQuestions: 5 })
    })

    it('確認中に制限時間が尽きたら、その確認は成功にもスキップにも数えずtimeUpで終わる(tick)', () => {
      const { engine, records } = createEngine({ mode: 'timeLimit', timeLimitSec: 30 })
      engine.startRun()
      engine.attach()
      clearQuestion(engine)
      engine.confirmHomePosition()
      engine.completeHomePosition()
      vi.advanceTimersByTime(200)
      clearQuestion(engine)
      expect(engine.homePositionCheck.value).not.toBeNull()

      vi.advanceTimersByTime(30_000)
      expect(engine.run.value.summary).toMatchObject({
        endedBy: 'timeUp', activeMs: 30_000, completedQuestions: 2, hpSuccessCount: 1, hpSkipCount: 0,
      })
      expect(engine.homePositionCheck.value).toBeNull()
      expect(engine.resultReady.value).toBe(true)
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({ endedBy: 'timeUp', hpSuccessCount: 1, hpSkipCount: 0 })
      engine.detach()
    })

    it('成立後・離す前に時間が尽きたら成功に数えない', () => {
      const { engine } = createEngine({ mode: 'timeLimit', timeLimitSec: 30 })
      engine.startRun()
      clearQuestion(engine)
      vi.advanceTimersByTime(1000)
      engine.confirmHomePosition()
      vi.advanceTimersByTime(29_000)
      expect(engine.completeHomePosition()).toBe(false)
      expect(engine.run.value.summary).toMatchObject({
        endedBy: 'timeUp', hpSuccessCount: 0, hpSkipCount: 0, hpAvgReturnMs: null, hpMinReturnMs: null,
      })
    })

    it('時間が尽きたあとのスキップ・成立は無視され、時間切れで終える', () => {
      const { engine } = createEngine({ mode: 'timeLimit', timeLimitSec: 30 })
      engine.startRun()
      clearQuestion(engine)
      vi.advanceTimersByTime(30_000)
      expect(engine.skipHomePosition()).toBe(false)
      expect(engine.run.value.summary).toMatchObject({ endedBy: 'timeUp', hpSkipCount: 0 })

      const second = createEngine({ mode: 'timeLimit', timeLimitSec: 30 })
      second.engine.startRun()
      clearQuestion(second.engine)
      vi.advanceTimersByTime(30_000)
      expect(second.engine.confirmHomePosition()).toBe(false)
      expect(second.engine.run.value.summary).toMatchObject({ endedBy: 'timeUp', hpSuccessCount: 0 })
    })

    it('終了後は確認の操作を受け付けない', () => {
      const { engine } = createEngine({ mode: 'timeLimit', timeLimitSec: 30 })
      engine.startRun()
      clearQuestion(engine)
      engine.finishRun({ endedBy: 'ended' })
      expect(engine.confirmHomePosition()).toBe(false)
      expect(engine.skipHomePosition()).toBe(false)
    })
  })

  describe('もう一度・記録', () => {
    it('「同じ設定でもう一度」で集計をリセットする', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.confirmHomePosition()
      engine.completeHomePosition()
      clearQuestion(engine)
      engine.skipHomePosition()
      engine.finishRun({ endedBy: 'ended' })
      expect(engine.runSummary.value).toMatchObject({ hpSuccessCount: 1, hpSkipCount: 1 })

      engine.startRun()
      expect(engine.homePositionCheck.value).toBeNull()
      expect(engine.runSummary.value).toMatchObject({
        homePosition: true, hpSuccessCount: 0, hpSkipCount: 0, hpAvgReturnMs: null, hpMinReturnMs: null,
      })
    })

    it('フリーの「やり直す」長押し(今回の成績リセット)でホームポジションの集計もゼロへ戻す', () => {
      const { engine } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      engine.skipHomePosition()
      expect(engine.runSummary.value.hpSkipCount).toBe(1)
      expect(engine.resetAllStats()).toBe(true)
      expect(engine.runSummary.value).toMatchObject({ hpSkipCount: 0, hpSuccessCount: 0 })
    })

    it('確認ONのrunの履歴とrun送信に、設定値と4つの集計を載せる(ONとOFFは別条件として記録される)', () => {
      const { engine, storage, records } = createEngine()
      engine.startRun()
      clearQuestion(engine)
      vi.advanceTimersByTime(800)
      engine.confirmHomePosition()
      engine.completeHomePosition()
      clearQuestion(engine)
      engine.skipHomePosition()
      engine.finishRun({ endedBy: 'ended' })

      const history = loadHistory(storage)[0]
      expect(history).toMatchObject({
        homePosition: true, hpSuccessCount: 1, hpSkipCount: 1, hpAvgReturnMs: 800, hpMinReturnMs: 800,
      })
      expect(records[0]).toMatchObject({
        id: history.id, homePosition: true, hpSuccessCount: 1, hpSkipCount: 1,
        hpAvgReturnMs: 800, hpMinReturnMs: 800,
      })
    })

    it('自己ベストなどの条件は確認ON/OFFで別になる', () => {
      const { engine, storage } = createEngine({ mode: 'timeAttack', targetCount: 10, homePosition: false })
      const finishTimeAttack = () => {
        engine.startRun()
        for (let index = 0; index < 10; index += 1) {
          vi.advanceTimersByTime(200)
          clearQuestion(engine)
          if (index < 9) {
            if (engine.homePositionCheck.value) engine.skipHomePosition()
            else vi.advanceTimersByTime(AUTO_ADVANCE_MS)
          }
        }
        return engine.runSummary.value.analysis
      }
      expect(finishTimeAttack().personalBest.isFirst).toBe(true)
      engine.updateSettings({ homePosition: true })
      // 確認ONの初回は、OFFの記録があっても「初めての記録」
      expect(finishTimeAttack().personalBest.isFirst).toBe(true)
      expect(loadHistory(storage).map((item) => item.homePosition)).toEqual([true, false])
    })

    it.each([
      ['フリー(確認ON・成功あり)', { mode: 'free' }, 'both'],
      ['タイムアタック(完了)', { mode: 'timeAttack', targetCount: 10 }, 'completed'],
      ['制限時間(時間切れ)', { mode: 'timeLimit', timeLimitSec: 30 }, 'timeUp'],
      ['成功0回(すべてスキップ)', { mode: 'free' }, 'skipOnly'],
      ['確認なし', { mode: 'free', homePosition: false }, 'off'],
    ])('エンジンが出す%sのrunをGASが受理する', (_label, settings, scenario) => {
      const { engine, records } = createEngine(settings)
      engine.startRun()
      if (scenario === 'completed') {
        for (let index = 0; index < 10; index += 1) {
          clearQuestion(engine)
          vi.advanceTimersByTime(250)
          if (index < 9) {
            engine.confirmHomePosition()
            engine.completeHomePosition()
          }
        }
      } else if (scenario === 'timeUp') {
        clearQuestion(engine)
        vi.advanceTimersByTime(500)
        engine.confirmHomePosition()
        engine.completeHomePosition()
        clearQuestion(engine)
        vi.advanceTimersByTime(30_000)
        engine.skipHomePosition()
      } else if (scenario === 'skipOnly') {
        clearQuestion(engine)
        engine.skipHomePosition()
        clearQuestion(engine)
        engine.skipHomePosition()
        engine.finishRun({ endedBy: 'ended' })
      } else if (scenario === 'off') {
        clearQuestion(engine)
        vi.advanceTimersByTime(AUTO_ADVANCE_MS)
        clearQuestion(engine)
        engine.finishRun({ endedBy: 'ended' })
      } else {
        clearQuestion(engine)
        vi.advanceTimersByTime(1500)
        engine.confirmHomePosition()
        engine.completeHomePosition()
        clearQuestion(engine)
        engine.skipHomePosition()
        engine.finishRun({ endedBy: 'ended' })
      }

      expect(records).toHaveLength(1)
      const [record] = records
      expect(record.homePosition).toBe(settings.homePosition !== false)
      expect(gasAcceptsRun(record), JSON.stringify(record)).toBe(true)
      if (scenario === 'skipOnly') {
        expect(record).toMatchObject({
          hpSuccessCount: 0, hpSkipCount: 2, hpAvgReturnMs: null, hpMinReturnMs: null,
        })
      }
      if (scenario === 'off') {
        expect(record).toMatchObject({
          homePosition: false, hpSuccessCount: 0, hpSkipCount: 0, hpAvgReturnMs: null, hpMinReturnMs: null,
        })
      }
    })
  })
})
