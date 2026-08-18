/**
 * Give jsdom suites a working `localStorage` / `sessionStorage` on Node 26+.
 *
 * Node 26 added its OWN global `localStorage`, and it is a getter that yields `undefined` unless
 * the process was started with `--localstorage-file`. That getter occupies the property slot before
 * jsdom's environment populates globals, jsdom's populate step skips a key that already exists, and
 * the result is that `window === globalThis` yet BOTH report `localStorage: undefined`. Every suite
 * that opens with `localStorage.clear()` then dies on "Cannot read properties of undefined
 * (reading 'clear')" — 18 tests across CommandPalette and personalVocabulary, none of them the
 * fault of the code under test.
 *
 * It looks like a broken jsdom pragma and it is not: the pragma is correct, the runtime moved. The
 * project's `engines` allows `>=26.0.0`, so this is a supported runtime failing, not an unsupported
 * one being used.
 *
 * Deliberately NOT solved by passing `--localstorage-file`: that makes the store a real file shared
 * across the whole run, so parallel workers would see each other's keys and `clear()` in one suite
 * would wipe another's. Per-realm memory is what a browser actually gives each page.
 *
 * Installed only when the slot is genuinely empty, so a future Node or jsdom that provides a real
 * implementation keeps it and this becomes inert rather than shadowing something better.
 */
class MemoryStorage implements Storage {
  #map = new Map<string, string>()

  get length(): number {
    return this.#map.size
  }

  key(index: number): string | null {
    // Storage#key is index-ordered over insertion order, and returns null past the end rather
    // than undefined — a caller iterating to `length` must not receive undefined at the boundary.
    return [...this.#map.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    // Absent is null, never undefined: code commonly does `JSON.parse(getItem(k) ?? 'null')`.
    return this.#map.has(String(key)) ? (this.#map.get(String(key)) as string) : null
  }

  setItem(key: string, value: string): void {
    // The spec stringifies both, which is why `setItem('k', 0)` reads back as `'0'`. Preserving
    // that keeps a test honest about what the browser would really return.
    this.#map.set(String(key), String(value))
  }

  removeItem(key: string): void {
    this.#map.delete(String(key))
  }

  clear(): void {
    this.#map.clear()
  }

  [name: string]: unknown
}

function install(name: 'localStorage' | 'sessionStorage'): void {
  const existing = (globalThis as Record<string, unknown>)[name]
  // `undefined` is the Node-26 getter's answer; a real Storage is an object with `getItem`.
  if (existing && typeof (existing as Storage).getItem === 'function') return
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
    enumerable: false,
  })
}

// `window` exists only under the jsdom environment; the node-environment suites neither have nor
// want a DOM storage global, so this stays a no-op there.
if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
  install('localStorage')
  install('sessionStorage')
}
