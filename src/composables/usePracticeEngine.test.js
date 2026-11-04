import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function createEngine(environment = createEnvironment()) {
  return {
    environment,
    engine: usePracticeEngine({
      ...environment,
      storage: createMemoryStorage(),
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
})
