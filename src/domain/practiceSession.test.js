import { describe, expect, it } from 'vitest'
import {
  createPracticeSession,
  getElapsedMs,
  getAccuracy,
  pausePracticeSession,
  resumePracticeSession,
  restorePracticeSession,
  submitKey,
} from './practiceSession.js'

describe('practiceSession', () => {
  it('誤入力は位置を進めずミス数だけ増やす', () => {
    const initial = createPracticeSession('as', 1000)
    const result = submitKey(initial, 's', 1200)
    expect(result.position).toBe(0)
    expect(result.mistakes).toBe(1)
    expect(result.attempts).toBe(1)
    expect(result.isComplete).toBe(false)
  })

  it('最終文字を正しく押した場合にだけクリアになる', () => {
    const initial = createPracticeSession('as', 1000)
    const first = submitKey(initial, 'a', 1100)
    expect(first.position).toBe(1)
    expect(first.isComplete).toBe(false)

    const incorrectFinal = submitKey(first, 'd', 1200)
    expect(incorrectFinal.position).toBe(1)
    expect(incorrectFinal.isComplete).toBe(false)

    const complete = submitKey(incorrectFinal, 'S', 1300)
    expect(complete.position).toBe(2)
    expect(complete.isComplete).toBe(true)
    expect(getAccuracy(complete)).toBe(67)
  })

  it('保存した途中位置と統計を復元する', () => {
    const saved = submitKey(createPracticeSession('asd', 1000), 'a', 1500)
    const restored = restorePracticeSession(saved, 'asd', 3000)
    expect(restored.position).toBe(1)
    expect(restored.correctCount).toBe(1)
    expect(restored.elapsedMs).toBe(500)
    expect(restored.startedAt).toBe(2500)
  })

  it('問題が変わった保存データは引き継がない', () => {
    const saved = submitKey(createPracticeSession('a', 1000), 'a', 1500)
    const restored = restorePracticeSession(saved, 's', 3000)
    expect(restored.question).toBe('s')
    expect(restored.position).toBe(0)
    expect(restored.isComplete).toBe(false)
  })

  it('一時停止中の時間を加算せず、再開後だけ計時する', () => {
    const active = createPracticeSession('asd', 1000)
    const paused = pausePracticeSession(active, 2500)
    expect(paused.isPaused).toBe(true)
    expect(paused.elapsedMs).toBe(1500)
    expect(getElapsedMs(paused, 10000)).toBe(1500)

    const resumed = resumePracticeSession(paused, 10000)
    expect(resumed.isPaused).toBe(false)
    expect(getElapsedMs(resumed, 11000)).toBe(2500)

    const pausedAgain = pausePracticeSession(resumed, 12000)
    expect(pausedAgain.elapsedMs).toBe(3500)
    expect(getElapsedMs(pausedAgain, 20000)).toBe(3500)
  })
})
