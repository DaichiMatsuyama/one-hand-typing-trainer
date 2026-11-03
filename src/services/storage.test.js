import { describe, expect, it } from 'vitest'
import { STORAGE_KEY, clearAppState, loadAppState, saveAppState } from './storage.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('storage', () => {
  it('設定・結果・途中経過を保存して復元する', () => {
    const storage = memoryStorage()
    const state = {
      settings: { hand: 'right', level: 3, includeSymbols: true, layoutVariant: 'us' },
      results: { completedQuestions: 2, correctCount: 10, mistakes: 3, attempts: 13, practiceMs: 9000 },
      questionIndex: 4,
      session: { question: 'jkl', position: 1, mistakes: 1 },
    }
    expect(saveAppState(state, storage)).toBe(true)
    expect(loadAppState(storage)).toEqual(state)
    expect(clearAppState(storage)).toBe(true)
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('localStorageへのアクセスが失敗しても例外にしない', () => {
    const broken = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(loadAppState(broken)).toBeNull()
    expect(saveAppState({}, broken)).toBe(false)
    expect(clearAppState(broken)).toBe(false)
  })

  it('破損データを読み込まず既定状態へフォールバックできる', () => {
    const brokenJson = { getItem: () => '{not-json' }
    expect(loadAppState(brokenJson)).toBeNull()
  })
})
