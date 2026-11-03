import { describe, expect, it } from 'vitest'
import { createPracticeSession, submitKey } from './practiceSession.js'
import { formatDuration, getTotalStats } from './stats.js'

const emptyResults = { completedQuestions: 0, correctCount: 0, mistakes: 0, attempts: 0, practiceMs: 0 }

describe('getTotalStats', () => {
  it('何もしていなければ正答率100%・すべて0', () => {
    const stats = getTotalStats(emptyResults, createPracticeSession('ab', 1000), 1000)
    expect(stats).toMatchObject({ elapsedMs: 0, attempts: 0, mistakes: 0, completedQuestions: 0, accuracy: 100 })
  })

  it('累計に進行中の問題の分を足す', () => {
    const results = { completedQuestions: 2, correctCount: 6, mistakes: 2, attempts: 8, practiceMs: 20_000 }
    let session = createPracticeSession('abc', 0)
    session = submitKey(session, 'a', 1000)
    session = submitKey(session, 'x', 2000)
    const stats = getTotalStats(results, session, 5000)
    expect(stats.attempts).toBe(10)
    expect(stats.correctCount).toBe(7)
    expect(stats.mistakes).toBe(3)
    expect(stats.accuracy).toBe(70)
    expect(stats.elapsedMs).toBe(25_000)
    expect(stats.completedQuestions).toBe(2)
  })

  it('クリア済みのセッションは累計に加算済みなので二重に足さない', () => {
    let session = createPracticeSession('a', 0)
    session = submitKey(session, 'a', 1500)
    const results = { completedQuestions: 1, correctCount: 1, mistakes: 0, attempts: 1, practiceMs: 1500 }
    const stats = getTotalStats(results, session, 9999)
    expect(stats.attempts).toBe(1)
    expect(stats.elapsedMs).toBe(1500)
    expect(stats.accuracy).toBe(100)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [59_000, '0:59'],
    [61_000, '1:01'],
    [5_999_000, '99:59'],
    [6_000_000, '1h40m'],
    [7_320_000, '2h02m'],
    [-5, '0:00'],
  ])('%i ms を %s にする', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})
