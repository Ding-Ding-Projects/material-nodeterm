/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard, registerListRoom } from './engine.js'
import { render } from './render.js'
import { createStore } from './store.js'

function toastStore() {
  const state = { sound: false, toasts: [] }
  return {
    state,
    setState(patch) {
      Object.assign(state, typeof patch === 'function' ? patch(state) : patch)
    },
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Pages playground context-menu DOM transport', () => {
  it('round-trips apostrophes without creating attacker-controlled attributes', () => {
    const row = {
      id: "row-o'brien",
      title: "O'Brien' data-pwned='yes",
      body: "The browser must keep this 'whole' payload inside JSON.",
      url: "https://example.test/o'brien",
    }
    registerListRoom('notes', {
      getRows: () => [row],
      emptyText: 'Nothing here.',
    })
    const store = createStore()
    Object.assign(store.state, { view: 'room', sec: 'notes', notes: [row] })
    const root = document.createElement('div')

    // Use the real string renderer and the browser's HTML parser. Reading dataset.menuExtra is
    // exactly what main.js does before opening a row's delegated context menu.
    root.innerHTML = render(store)

    const button = root.querySelector('.row-item')
    expect(button).not.toBeNull()
    expect(root.querySelectorAll('.row-item')).toHaveLength(1)
    expect(button.hasAttribute('data-pwned')).toBe(false)
    expect(JSON.parse(button.dataset.menuExtra)).toEqual({
      ...row,
      titleKind: 'authored',
      bodyKind: 'authored',
      titleParts: [{ kind: 'authored', text: row.title }],
      bodyParts: [{ kind: 'authored', text: row.body }],
      canUndo: false,
    })
  })
})

describe('Pages playground clipboard verdicts', () => {
  it('does not announce success until the asynchronous write resolves', async () => {
    vi.useFakeTimers()
    const store = toastStore()
    let resolveWrite
    const writeText = vi.fn(
      () => new Promise((resolve) => {
        resolveWrite = resolve
      }),
    )
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    const pending = copyToClipboard(store, "O'Brien")

    expect(writeText).toHaveBeenCalledWith("O'Brien")
    expect(store.state.toasts).toEqual([])

    resolveWrite()
    await pending

    expect(store.state.toasts.map((entry) => entry.title)).toEqual(['Copied!'])
  })

  it('reports an asynchronous rejection without a false success toast', async () => {
    vi.useFakeTimers()
    const store = toastStore()
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await copyToClipboard(store, 'blocked copy')

    expect(store.state.toasts.map((entry) => entry.title)).toEqual(['Could not copy'])
  })
})
