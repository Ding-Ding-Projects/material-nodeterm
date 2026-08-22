// The password prompt for a protected project file — and, once too many guesses have earned a
// wait, the unlock ladder that ends it.
//
// It is a promise-based singleton like `promptDialog`, because the caller (Canvas's project-open
// flow) already owns the retry loop: it asks for a password, tries it, and asks again with
// whatever the core answered. That keeps ONE place deciding what a failed attempt means.
//
// Every rule this leans on lives in core (`src/core/archive-unlock-guard.ts`,
// `src/core/unlock-ladder.ts`) — this file draws them and never enforces them. In particular,
// clearing a rung here does not open the file: the dialog simply returns to its password field,
// still needing the same password. The footer says so out loud, and must keep saying so.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { useDialogStack } from './dialog-stack'
import { UnlockLadderPanel, type LadderTransport } from './toylocks/UnlockLadder'
import type { LadderAnswer } from '@shared/unlock-ladder-types'

export interface ArchiveUnlockRequest {
  /** The file being opened. Shown so the user knows WHICH protected file is asking. */
  path: string
  /** A previous attempt's failure, shown beside the field it came from. */
  error?: string
  /** Milliseconds still to wait before another password may be tried. */
  lockedMs?: number
  /** The ladder is on offer for that wait. */
  ladderAvailable?: boolean
}

interface DialogState {
  current: (ArchiveUnlockRequest & { resolve: (value: string | null) => void }) | null
}

const useStore = create<DialogState>(() => ({ current: null }))

/**
 * Ask for a protected project file's password. Resolves with the typed password, or `null` when
 * the user gives up. Only one is open at a time — a second request cancels the first rather than
 * stacking two prompts for two files nobody asked about.
 */
export function requestArchivePassword(request: ArchiveUnlockRequest): Promise<string | null> {
  return new Promise((resolve) => {
    const prev = useStore.getState().current
    if (prev) {
      useStore.setState({ current: null })
      prev.resolve(null)
    }
    useStore.setState({ current: { ...request, resolve } })
  })
}

/** The transport half of the ladder for one file. The rules are core's; this only carries. */
function archiveLadderTransport(path: string): LadderTransport {
  return {
    issue: async () => {
      const state = await window.nodeTerminal.workspace.archiveLadderIssue(path)
      return { challenge: state.challenge, budgetLeft: state.budgetLeft }
    },
    verify: async (answer: LadderAnswer) => {
      const verdict = await window.nodeTerminal.workspace.archiveLadderVerify({ path, answer })
      return {
        cleared: verdict.cleared,
        budgetLeft: verdict.budgetLeft,
        message: verdict.message,
        challenge: verdict.challenge
      }
    }
  }
}

function formatWait(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

/** Mount once (app root). Renders the active request, if any. */
export function ArchiveUnlockDialogHost(): React.JSX.Element | null {
  const current = useStore((s) => s.current)
  if (!current) return null
  return (
    <ArchiveUnlockDialog
      key={`${current.path}:${current.lockedMs ?? 0}:${current.error ?? ''}`}
      request={current}
      onSubmit={(value) => {
        const c = useStore.getState().current
        if (!c) return
        useStore.setState({ current: null })
        c.resolve(value)
      }}
      onCancel={() => {
        const c = useStore.getState().current
        if (!c) return
        useStore.setState({ current: null })
        c.resolve(null)
      }}
    />
  )
}

function ArchiveUnlockDialog({
  request,
  onSubmit,
  onCancel
}: {
  request: ArchiveUnlockRequest
  onSubmit: (value: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [remaining, setRemaining] = useState(request.lockedMs ?? 0)
  const [ladderOpen, setLadderOpen] = useState(false)
  useDialogStack()

  // The countdown is live so a served wait ends by itself — a user staring at a frozen number has
  // no way to know whether the app noticed the clock at all.
  useEffect(() => {
    if (remaining <= 0) return
    const started = Date.now()
    const from = remaining
    const t = setInterval(() => {
      setRemaining(Math.max(0, from - (Date.now() - started)))
    }, 250)
    return () => clearInterval(t)
    // Restarted whenever a new wait arrives; `remaining` is the state it drives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.lockedMs])

  const locked = remaining > 0

  return createPortal(
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm" onClick={(e) => e.stopPropagation()}>
        <p className="confirm__msg">
          This project file is password-protected.
          <br />
          <span className="confirm__path">{request.path}</span>
        </p>

        {locked ? (
          <>
            <p className="confirm__error" role="alert">
              Too many wrong passwords. You can try again in {formatWait(remaining)}.
            </p>
            {ladderOpen ? (
              <UnlockLadderPanel
                transport={archiveLadderTransport(request.path)}
                // A cleared rung ends the WAIT and nothing else: the dialog returns to its
                // password field, still needing the same password. Never call onSubmit here.
                onCleared={() => {
                  setRemaining(0)
                  setLadderOpen(false)
                }}
                onDone={() => setLadderOpen(false)}
              />
            ) : request.ladderAvailable ? (
              <button className="confirm__btn" onClick={() => setLadderOpen(true)}>
                Play your way out of the wait
              </button>
            ) : null}
          </>
        ) : (
          <>
            <input
              className="confirm__input"
              type="password"
              autoComplete="off"
              autoFocus
              value={value}
              placeholder="Password"
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onSubmit(value)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  onCancel()
                }
              }}
            />
            {request.error ? (
              <p className="confirm__error" role="alert">
                {request.error}
              </p>
            ) : null}
          </>
        )}

        <div className="confirm__actions">
          <button className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          {!locked && (
            <button className="confirm__btn primary" onClick={() => onSubmit(value)}>
              Open
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
