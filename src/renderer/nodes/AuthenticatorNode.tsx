import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import type { AuthenticatorCode, AuthenticatorEntry } from '@shared/authenticator'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'

/**
 * The built-in authenticator, on the canvas.
 *
 * The generators were already there (docs/authenticator.md) and could only be READ from
 * Settings -> Just for fun -> Authenticator, which is four levels from anywhere and closed the
 * moment you went back to work. A code you need every few minutes belongs on the surface you are
 * already looking at, beside the terminal you are about to paste it into.
 *
 * WHAT THIS NODE PERSISTS: a title and a colour. Nothing else, and deliberately not a list of
 * which entries to show.
 *
 * A node's `data` is written into `.nodeterm/project.json`, which is git-shared and travels to
 * every machine that clones the repository. An entry id names a credential in THIS machine's
 * operating-system credential vault, so a list of them in there would be one person's credential
 * store leaking into everybody else's checkout - and it would be meaningless there anyway, since
 * the vault is not what git carries. This is the same rule the service nodes follow, for the same
 * reason: the node is a VIEW, and the credentials stay where they were.
 *
 * So the node shows whatever this machine's authenticator holds, exactly as the settings section
 * does. A teammate who opens the shared canvas sees their own entries, or the empty state, and
 * never a trace of yours.
 *
 * The secret itself never comes near this component. `authenticator.codes` returns the CURRENT
 * code and nothing else, computed in core against the vault; there is no path here that could
 * reveal a seed even by accident, and revealing one stays behind the settings section's own gate.
 */
export default function AuthenticatorNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const [entries, setEntries] = useState<AuthenticatorEntry[]>([])
  const [codes, setCodes] = useState<Record<string, AuthenticatorCode>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const load = useCallback(async (): Promise<void> => {
    try {
      setEntries(await window.nodeTerminal.authenticator.list())
      setLoadError(null)
    } catch {
      // A read failure is reported as a read failure. An empty list here would say "you have no
      // generators", which is a different and much worse thing to tell somebody who has several.
      setLoadError('Could not read this computer’s authenticator store.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // One round trip per second for every entry, the same batched call the settings section uses -
  // never one request per row. The clock ticks separately so the countdown stays smooth even if a
  // code request is slow.
  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      const ids = entriesRef.current.map((e) => e.id)
      if (ids.length === 0) return
      try {
        const next = await window.nodeTerminal.authenticator.codes(ids)
        if (!cancelled) setCodes(next)
      } catch {
        // Leave the last codes on screen rather than blanking them: a transient failure is not
        // evidence that the entries are gone, and a blank row invites a pointless retry.
      }
    }
    void tick()
    const codeTimer = setInterval(() => void tick(), 1000)
    const clockTimer = setInterval(() => setNow(Date.now()), 250)
    return () => {
      cancelled = true
      clearInterval(codeTimer)
      clearInterval(clockTimer)
    }
  }, [entries])

  const copy = useCallback(async (entryId: string, code: string): Promise<void> => {
    const ok = await window.nodeTerminal.clipboard.writeText(code)
    // Only claim a copy the clipboard actually acknowledged - `writeText` resolves false when the
    // host refused, and a green tick over a failed copy is how somebody pastes the wrong thing.
    if (ok) {
      setCopied(entryId)
      setTimeout(() => setCopied((c) => (c === entryId ? null : c)), 1200)
    }
  }, [])

  const headerFill = nodeHeaderFillStyle(data.color)
  const rows = useMemo(
    () =>
      entries.map((entry) => {
        const period = entry.period > 0 ? entry.period : 30
        const secondsLeft = period - (Math.floor(now / 1000) % period)
        return { entry, period, secondsLeft }
      }),
    [entries, now]
  )

  return (
    <div className={`term-node authenticator-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={260} minHeight={160} isVisible={selected} color={data.color} />
      <div
        className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`}
        style={headerFill.style}
      >
        <EditableNodeTitle
          value={(data.title as string) ?? ''}
          onChange={(next) => updateNodeData(id, { title: next })}
          emptyLabel="Authenticator"
          title="Click to rename"
          ariaLabel="Authenticator node name"
          rejectEmpty={false}
        />
        <span className="term-node__spacer" />
        <button className="term-node__close" title="Refresh the list" onClick={() => void load()}>
          ⟳
        </button>
        <button
          className="term-node__close"
          title="Close"
          onClick={() => void deleteElements({ nodes: [{ id }] })}
        >
          ×
        </button>
      </div>

      <div className="authenticator-node__body nodrag nowheel">
        {loadError ? (
          <p className="authenticator-node__empty" role="alert">
            {loadError}
          </p>
        ) : rows.length === 0 ? (
          <p className="authenticator-node__empty">
            No generators yet. Add one in Settings, under Authenticator, and it appears here.
          </p>
        ) : (
          <ul className="authenticator-node__list">
            {rows.map(({ entry, period, secondsLeft }) => {
              const code = codes[entry.id]?.code
              return (
                <li key={entry.id} className="authenticator-node__row">
                  <div className="authenticator-node__who">
                    <span className="authenticator-node__issuer">{entry.issuer || 'Unnamed'}</span>
                    <span className="authenticator-node__account">{entry.account}</span>
                  </div>
                  <button
                    className="authenticator-node__code"
                    // The code IS the button: it is the one thing anybody wants from this row, and
                    // a separate copy icon beside it is a smaller target for the same action.
                    title={code ? 'Copy this code' : 'Waiting for a code'}
                    disabled={!code}
                    onClick={() => code && void copy(entry.id, code)}
                  >
                    {copied === entry.id ? 'Copied' : (code ?? '••••••')}
                  </button>
                  {/* Seconds as TEXT beside the bar: a bar alone is colour and length only, which
                      is unreadable to somebody who cannot see it and ambiguous to everybody at a
                      glance. */}
                  <span
                    className="authenticator-node__countdown"
                    title={`New code in ${secondsLeft}s`}
                    aria-label={`New code in ${secondsLeft} seconds`}
                  >
                    <span
                      className="authenticator-node__countdown-bar"
                      style={{ width: `${Math.round((secondsLeft / period) * 100)}%` }}
                    />
                    <span className="authenticator-node__countdown-text">{secondsLeft}s</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
