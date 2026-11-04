import { describe, expect, it } from 'vitest'
import { HISTORY_KEY, HISTORY_LIMIT, appendHistory, loadHistory } from './history.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

function record(index = 0) {
  return {
    v: 1,
    id: `run-${index}`,
    ts: new Date(1_700_000_000_000 + index).toISOString(),
    mode: 'free',
    hand: 'left',
    level: 1,
    includeSymbols: false,
    layout: 'jis',
    targetCount: null,
    timeLimitSec: null,
    homePosition: false,
    endedBy: 'ended',
    activeMs: index,
    inputMs: index,
    completedQuestions: 0,
    correctCount: 1,
    mistakes: 0,
    attempts: 1,
    accuracy: 100,
    kpm: null,
    menuOpenCount: 0,
    keys: { a: [1, 0] },
    rankVersion: null,
    messageId: 'first-1',
    appVersion: 'dev',
  }
}

describe('練習履歴', () => {
  it('新しい順に保存し、200件を上限にする', () => {
    const storage = memoryStorage()
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      expect(appendHistory(record(index), storage)).toBe(true)
    }
    const history = loadHistory(storage)
    expect(history).toHaveLength(HISTORY_LIMIT)
    expect(history[0].id).toBe('run-204')
    expect(history.at(-1).id).toBe('run-5')
    expect(history[0]).toMatchObject({ v: 1, homePosition: false, appVersion: 'dev' })
  })

  it('壊れた全体値を捨て、個別の壊れた記録は無視する', () => {
    const storage = memoryStorage()
    storage.setItem(HISTORY_KEY, '{broken')
    expect(loadHistory(storage)).toEqual([])
    expect(storage.getItem(HISTORY_KEY)).toBeNull()

    storage.setItem(HISTORY_KEY, JSON.stringify([record(1), { v: 1, id: '' }, null]))
    expect(loadHistory(storage).map(({ id }) => id)).toEqual(['run-1'])
  })

  it('localStorageが使えなくても例外にしない', () => {
    const broken = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(loadHistory(broken)).toEqual([])
    expect(appendHistory(record(), broken)).toBe(false)
  })

  it('keys・rankVersion・messageIdをサニタイズする', () => {
    const storage = memoryStorage()
    expect(appendHistory({
      ...record(),
      keys: { A: [5, 2], '?': [8, 4], s: [-1, 0], d: [3] },
      rankVersion: 1,
      messageId: 'rank-up-1',
    }, storage)).toBe(true)
    expect(loadHistory(storage)[0]).toMatchObject({
      keys: { a: [5, 2] },
      rankVersion: 1,
      messageId: 'rank-up-1',
    })

    expect(appendHistory({ ...record(2), rankVersion: 1000 }, storage)).toBe(false)
    expect(appendHistory({ ...record(3), messageId: 'x'.repeat(65) }, storage)).toBe(true)
    expect(loadHistory(storage)[0].messageId).toBeNull()
  })

  it('新項目がない旧記録もversion 1のまま読める', () => {
    const storage = memoryStorage()
    const legacy = record()
    delete legacy.keys
    delete legacy.rankVersion
    delete legacy.messageId
    storage.setItem(HISTORY_KEY, JSON.stringify([legacy]))
    expect(loadHistory(storage)[0]).toMatchObject({ id: 'run-0', rankVersion: null, messageId: null })
    expect(loadHistory(storage)[0]).not.toHaveProperty('keys')
  })
})
