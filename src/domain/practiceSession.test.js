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
    const saved = { ...submitKey(createPracticeSession('asd', 1000), 'a', 1500), preserved: true }
    const restored = restorePracticeSession(saved, 'asd', 3000)
    expect(restored.position).toBe(1)
    expect(restored.correctCount).toBe(1)
    expect(restored.elapsedMs).toBe(500)
    expect(restored.startedAt).toBe(2500)
    expect(restored.preserved).toBe(true)
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

  it.each([
    ['文字列', 'broken'],
    ['小数', 1.5],
    ['Infinity', Infinity],
    ['負数', -1],
    ['null', null],
    ['配列', [1]],
  ])('positionが%sなら進捗を0へ正規化する', (_label, position) => {
    const restored = restorePracticeSession({
      question: 'asd',
      position,
      attempts: 1,
      correctCount: 99,
      mistakes: 'broken',
      isComplete: true,
    }, 'asd', 5000)
    expect(restored).toMatchObject({
      position: 0,
      correctCount: 0,
      mistakes: 0,
      attempts: 0,
      isComplete: false,
    })
  })

  it.each([
    [
      'positionが末尾で完了値が欠落',
      { question: 'asd', position: 3 },
      { position: 3, correctCount: 3, mistakes: 0, attempts: 3, isComplete: true },
    ],
    [
      '完了値trueでもpositionが0',
      { question: 'asd', position: 0, isComplete: true, mistakes: 2 },
      { position: 0, correctCount: 0, mistakes: 2, attempts: 2, isComplete: false },
    ],
    [
      '保存集計がpositionと矛盾',
      { question: 'asd', position: 1, attempts: 1, correctCount: 99, mistakes: 4 },
      { position: 1, correctCount: 1, mistakes: 4, attempts: 5, isComplete: false },
    ],
  ])('%sでもpositionを基準に整合させる', (_label, saved, expected) => {
    expect(restorePracticeSession(saved, 'asd', 5000)).toMatchObject(expected)
  })

  it.each([null, []])('セッションが%jなら新規セッションとして復元する', (saved) => {
    expect(restorePracticeSession(saved, 'asd', 5000)).toMatchObject({
      position: 0,
      correctCount: 0,
      mistakes: 0,
      attempts: 0,
      isComplete: false,
    })
  })
})
