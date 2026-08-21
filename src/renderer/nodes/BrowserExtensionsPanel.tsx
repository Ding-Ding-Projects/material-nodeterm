import { useEffect, useRef, useState } from 'react'
import type { BrowserExtensionInfo } from '@shared/types'
import { E_UNSUPPORTED } from '@shared/rpc'

interface BrowserExtensionsPanelProps {
  /** The profile's Electron session partition (undefined = default session) — see
   *  `browserPartitionFor`. Extensions loaded here apply to every browser node sharing this
   *  partition, since they share one Electron session. */
  partition: string | undefined
  onClose: () => void
}

/**
 * Anchored popover for loading/removing unpacked Chrome extensions into this browser profile's
 * session (Desktop/Electron only — see `BrowserExtensionsApi`'s doc comment in shared/types.ts
 * for exactly what Electron does and does not support here; that limit is stated in this UI too,
 * not just in a code comment nobody reading the app ever sees).
 */
export function BrowserExtensionsPanel({ partition, onClose }: BrowserExtensionsPanelProps) {
  const [extensions, setExtensions] = useState<BrowserExtensionInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // null (unknown) -> true once an E_UNSUPPORTED reply establishes this session has no Chromium
  // extension host to load into (Server Edition / a relay tab) — see `BrowserExtensionsApi`'s
  // doc comment: there is no partial support to offer there, only an honest refusal.
  const [unsupported, setUnsupported] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const isUnsupported = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && (err as { code?: unknown }).code === E_UNSUPPORTED

  const refresh = async (): Promise<void> => {
    try {
      const list = await window.nodeTerminal.browser.extensions.list(partition)
      setExtensions(list)
    } catch (err) {
      if (isUnsupported(err)) {
        setUnsupported(true)
        setExtensions([])
        return
      }
      throw err
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partition])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  const handleAdd = async (): Promise<void> => {
    setError('')
    let dir: string | null
    try {
      dir = await window.nodeTerminal.browser.extensions.pickDir()
    } catch (err) {
      if (isUnsupported(err)) {
        setUnsupported(true)
        return
      }
      throw err
    }
    if (!dir) return
    setBusy(true)
    try {
      const result = await window.nodeTerminal.browser.extensions.add(partition, dir)
      if (!result.ok) setError(result.error)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (dirPath: string): Promise<void> => {
    setBusy(true)
    try {
      await window.nodeTerminal.browser.extensions.remove(partition, dirPath)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="browser-ext-panel nodrag nowheel"
      ref={rootRef}
      role="dialog"
      aria-label="Browser extensions"
    >
      <div className="browser-ext-panel__header">
        <span>Extensions (unpacked, Electron subset)</span>
        <button className="browser-node__btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="browser-ext-panel__note">
        Loads an unpacked extension directory into this profile. No Chrome Web Store install, and
        Electron implements only a subset of chrome.* APIs — an extension may partly not work.
      </p>
      {unsupported && (
        <p className="browser-ext-panel__error">
          Extensions are desktop-only — this session (Server Edition or a shared browser tab) has
          no Chromium extension host to load one into.
        </p>
      )}
      {!unsupported && error && <div className="browser-ext-panel__error">{error}</div>}
      <ul className="browser-ext-panel__list">
        {!unsupported && extensions === null && <li className="browser-ext-panel__empty">Loading…</li>}
        {!unsupported && extensions !== null && extensions.length === 0 && (
          <li className="browser-ext-panel__empty">No extensions loaded into this profile.</li>
        )}
        {!unsupported &&
          extensions?.map((ext) => (
            <li key={ext.path} className="browser-ext-panel__item">
              <div className="browser-ext-panel__item-text">
                <span className="browser-ext-panel__item-name">
                  {ext.name} <span className="browser-ext-panel__item-version">{ext.version}</span>
                </span>
                <span className="browser-ext-panel__item-path">{ext.path}</span>
              </div>
              <button
                className="browser-node__btn"
                disabled={busy}
                onClick={() => void handleRemove(ext.path)}
                aria-label={`Remove ${ext.name}`}
                title="Remove"
              >
                ✕
              </button>
            </li>
          ))}
      </ul>
      {!unsupported && (
        <button className="browser-ext-panel__add" disabled={busy} onClick={() => void handleAdd()}>
          + Load unpacked extension…
        </button>
      )}
    </div>
  )
}
