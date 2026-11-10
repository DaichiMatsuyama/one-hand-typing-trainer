import { describe, expect, it } from 'vitest'
import {
  STORAGE_KEY,
  STORAGE_VERSION,
  clearAppState,
  loadAppState,
  saveAppState,
} from './storage.js'

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
      settings: {
        hand: 'right', level: 3, includeSymbols: true, layoutVariant: 'us',
        mode: 'timeAttack', targetCount: 30, timeLimitSec: 120, feedbackEffects: false,
        touchRipple: false, homePosition: true,
      },
      results: { completedQuestions: 2, correctCount: 10, mistakes: 3, attempts: 13, practiceMs: 9000 },
      questionIndex: 4,
      session: { question: 'jkl', position: 1, mistakes: 1 },
    }
    expect(saveAppState(state, storage)).toBe(true)
    expect(loadAppState(storage)).toEqual({ ...state, version: STORAGE_VERSION })
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).version).toBe(STORAGE_VERSION)
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

  it.each([
    ['小数', 1.5],
    ['負数', -1],
    ['文字列', '3'],
    ['null', null],
    ['空配列', []],
    ['値入り配列', [2]],
  ])('questionIndexが%sなら0へ正規化する', (_label, questionIndex) => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, questionIndex }))
    expect(loadAppState(storage).questionIndex).toBe(0)
  })

  it('questionIndexがInfinityなら0へ正規化する', () => {
    const storage = { getItem: () => `{"version":${STORAGE_VERSION},"questionIndex":1e400}` }
    expect(loadAppState(storage).questionIndex).toBe(0)
  })

  it.each([
    ['version欠落', { settings: { hand: 'right' } }],
    ['未知version', { version: STORAGE_VERSION + 1 }],
    ['配列state', []],
  ])('%sの保存データは破棄する', (_label, value) => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify(value))
    expect(loadAppState(storage)).toBeNull()
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('現行versionで旧フィールドが欠落していても安全な既定値を返す', () => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION }))
    expect(loadAppState(storage)).toEqual({
      version: STORAGE_VERSION,
      settings: {
        hand: 'left', level: 1, includeSymbols: false, layoutVariant: 'jis',
        mode: 'free', targetCount: 10, timeLimitSec: 60, feedbackEffects: true,
        touchRipple: true, homePosition: false,
      },
      results: { completedQuestions: 0, correctCount: 0, mistakes: 0, attempts: 0, practiceMs: 0 },
      questionIndex: 0,
      session: null,
    })
  })

  it.each([
    ['不明なモード', { mode: 'unknown' }],
    ['選択肢にない問題数', { mode: 'timeAttack', targetCount: 12 }],
    ['選択肢にない制限時間', { mode: 'timeLimit', timeLimitSec: 45 }],
  ])('%sを既定値へ正規化する', (_label, settings) => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, settings }))
    expect(loadAppState(storage).settings).toMatchObject({
      mode: settings.mode === 'unknown' ? 'free' : settings.mode,
      targetCount: 10,
      timeLimitSec: 60,
    })
  })

  it.each([
    ['欠落', undefined, true],
    ['true', true, true],
    ['false', false, false],
    ['不正な値', 'false', true],
  ])('feedbackEffectsが%sなら%sへ正規化する', (_label, feedbackEffects, expected) => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      settings: { feedbackEffects },
    }))
    expect(loadAppState(storage).settings.feedbackEffects).toBe(expected)
  })

  it.each([
    ['欠落', undefined, true],
    ['true', true, true],
    ['false', false, false],
    ['不正な値', 'false', true],
  ])('touchRippleが%sなら%sへ正規化する(既定はON)', (_label, touchRipple, expected) => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      settings: { touchRipple },
    }))
    expect(loadAppState(storage).settings.touchRipple).toBe(expected)
  })

  it.each([
    ['欠落', undefined, false],
    ['true', true, true],
    ['false', false, false],
    ['文字列のtrue', 'true', false],
    ['数値の1', 1, false],
    ['null', null, false],
  ])('homePositionが%sなら%sへ正規化する(既定はOFF)', (_label, homePosition, expected) => {
    const storage = memoryStorage()
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      settings: { homePosition },
    }))
    expect(loadAppState(storage).settings.homePosition).toBe(expected)
  })

  it('homePositionは練習モード・手・レベルの設定と独立して保存・復元される', () => {
    const storage = memoryStorage()
    for (const mode of ['free', 'timeAttack', 'timeLimit']) {
      const settings = { hand: 'right', level: 3, mode, homePosition: true }
      saveAppState({ settings, results: {}, questionIndex: 0, session: null }, storage)
      expect(loadAppState(storage).settings).toMatchObject({ mode, hand: 'right', level: 3, homePosition: true })
    }
  })
})
