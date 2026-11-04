import { describe, expect, it } from 'vitest'
import { summarizeRunStats } from './run.js'

describe('1回の練習結果', () => {
  it('開始時の累計との差から正答率とKPMを計算する', () => {
    expect(summarizeRunStats(
      {
        completedQuestions: 9,
        correctCount: 130,
        mistakes: 8,
        attempts: 138,
        elapsedMs: 90_000,
      },
      {
        completedQuestions: 7,
        correctCount: 100,
        mistakes: 5,
        attempts: 105,
        elapsedMs: 60_000,
      },
      2,
    )).toEqual({
      completedQuestions: 2,
      correctCount: 30,
      mistakes: 3,
      attempts: 33,
      inputMs: 30_000,
      accuracy: 91,
      kpm: 60,
      menuOpenCount: 2,
    })
  })

  it('入力がない場合は正解率100%、1秒未満はKPMを出さない', () => {
    expect(summarizeRunStats(
      { completedQuestions: 4, correctCount: 8, mistakes: 2, attempts: 10, elapsedMs: 5000 },
      { completedQuestions: 4, correctCount: 8, mistakes: 2, attempts: 10, elapsedMs: 5000 },
    )).toMatchObject({ accuracy: 100, kpm: null, inputMs: 0 })

    expect(summarizeRunStats(
      { correctCount: 1, attempts: 1, elapsedMs: 999 },
      { correctCount: 0, attempts: 0, elapsedMs: 0 },
    )).toMatchObject({ accuracy: 100, kpm: null })
  })

  it('時計や累計がリセットされても負の値にしない', () => {
    expect(summarizeRunStats(
      { completedQuestions: 0, correctCount: 0, mistakes: 0, attempts: 0, elapsedMs: 0 },
      { completedQuestions: 3, correctCount: 20, mistakes: 4, attempts: 24, elapsedMs: 8000 },
      -1,
    )).toEqual({
      completedQuestions: 0,
      correctCount: 0,
      mistakes: 0,
      attempts: 0,
      inputMs: 0,
      accuracy: 100,
      kpm: null,
      menuOpenCount: 0,
    })
  })
})
