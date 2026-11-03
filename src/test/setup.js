// Node 25+ exposes an experimental global `localStorage` that is unusable without
// --localstorage-file and shadows jsdom's. Provide an in-memory one so tests behave the same on any Node.
if (typeof globalThis.localStorage?.clear !== 'function') {
  const values = new Map()
  const memoryStorage = {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: (key) => { values.delete(key) },
    clear: () => { values.clear() },
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage, configurable: true })
}
