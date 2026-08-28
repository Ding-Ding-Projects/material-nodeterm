import { useEffect, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import { NODE_COLORS, ungroupNodes, type CanvasNode } from '../state/workspace'
import { useToyLocks } from '../state/toylocks'
import { UnlockPrompt } from '../components/toylocks/UnlockPrompt'
import { useProjects } from '../state/projects'
import { useWorktrees, WORKTREE_STATUS_POLL_MS } from '../state/worktrees'
import { useWsl } from '../state/wsl'
import { canManageWslDistro, sanitizeGroupWsl, WSL_NOT_OWNED_HINT } from '@shared/wsl-binding'
import { ColorMenu } from '../components/color/ColorMenu'
import { alphaTint } from '../components/color/tint'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { GitHubWorkItemAttachment } from './GitHubWorkItemAttachment'
import { NODE_MIN_SIZES } from '../lib/nodeSizing'
import { useProjectSetup } from '../state/projectSetup'

export type WorktreeAction = 'merge' | 'remove' | 'unbind' | 'rerun-setup'
export type WslAction = 'sleep' | 'wake' | 'delete' | 'unbind'

/**
 * Worktree-action handler bridge. React Flow instantiates custom nodes itself, so we can't
 * pass Canvas callbacks through props; Canvas registers its handler here (the same indirection
 * the file already relies on — GroupNode reaches React Flow state via `useReactFlow`). Set by
 * Canvas on mount; called by the header chip's action buttons.
 */
let worktreeActionHandler: ((groupId: string, action: WorktreeAction) => void) | null = null
export function setWorktreeActionHandler(
  fn: ((groupId: string, action: WorktreeAction) => void) | null
): void {
  worktreeActionHandler = fn
}

/** Canvas registers the group drill-through action because React Flow owns node instantiation. */
let drillHandler: ((groupId: string) => void) | null = null
export function setDrillHandler(fn: ((groupId: string) => void) | null): void {
  drillHandler = fn
}

/** Same bridge shape, for the WSL chip's sleep/wake/unregister/unbind buttons. */
let wslActionHandler: ((groupId: string, action: WslAction) => void) | null = null
export function setWslActionHandler(fn: ((groupId: string, action: WslAction) => void) | null): void {
  wslActionHandler = fn
}

/**
 * A group frame: a dashed, rounded, translucent box that contains child nodes. A floating
 * label pill (color dot + name) sits on the top border; ungroup/× appear top-right on hover.
 * Children are real React Flow nodes parented to this one, so dragging the frame moves them
 * together. The frame renders behind its children (it appears first in the array).
 */
export function GroupNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const { updateNodeData, setNodes } = useReactFlow()
  const flowNodes = useStore((state) => state.nodes) as CanvasNode[]
  /** Viewport anchor for the colour surface, or null when it is closed (see ColorMenu). */
  const [colorAnchor, setColorAnchor] = useState<{ x: number; y: number } | null>(null)
  // The frame element, observed for viewport visibility by the worktree-status tick below.
  const frameRef = useRef<HTMLDivElement | null>(null)

  const wt = data.worktree
  const projectRef = data.projectRef
  const referencedProject = useProjects((state) =>
    projectRef && typeof projectRef.projectId === 'string'
      ? state.projects.find((project) => project.id === projectRef.projectId)
      : undefined
  )
  const projectRefUnavailable =
    !!projectRef &&
    (!referencedProject || referencedProject.unavailable || referencedProject.closed)
  // The store is the ONLY caller of the worktree/status git IPC; it throttles
  // (WORKTREE_STATUS_THROTTLE_MS) and is epoch-guarded, so asking often is free.
  const status = useWorktrees((s) => (wt ? s.statusByPath[wt.path] : undefined))
  const stale = useWorktrees((s) => (wt ? s.staleGroupIds.includes(id) : false))
  const frameBranch = status?.branch ?? wt?.branch
  const frameItems = flowNodes
    .filter((node) => {
      let parent = node.parentId
      const seen = new Set<string>()
      while (parent && !seen.has(parent)) {
        if (parent === id) return true
        seen.add(parent)
        parent = flowNodes.find((candidate) => candidate.id === parent)?.parentId
      }
      return false
    })
    .flatMap((node) => node.data.githubWorkItems ?? [])
  // The project setup/archive script Canvas launched for THIS checkout, resolved through the
  // attachment its ack made (an event carries no lane — see the store's header). Selected as the
  // entry itself, so a render happens only when this group's run changes, not on every chunk of
  // every other project's script.
  const setupRun = useProjectSetup((s) => {
    const runKey = s.groupRunKey[id]
    return runKey === undefined ? undefined : s.byRunKey[runKey]
  })
  // A launch for this group is already on its way (requested, not yet acked — which includes the
  // whole time a consent dialog is up). The re-run chip must not fire a second one: the service
  // would answer `busy`, and the store's counter exists precisely because that ack must not be
  // mistaken for "nothing is happening".
  const setupPending = useProjectSetup((s) => (s.pendingByGroup[id] ?? 0) > 0)
  const setupBusy = setupPending || setupRun?.state === 'running'

  // `data.wsl` is content, never authority — see @shared/wsl-binding's header. Tolerant read
  // (`sanitizeGroupWsl`) so a hostile/hand-edited project file cannot render past shape
  // validation, and everything the chip shows or enables is re-derived from the WSL STORE's own
  // live, freshly-enumerated facts — never from this record directly. A distribution this app did
  // not create (the machine's own real docker-desktop / etc.) renders read-only: the chip shows
  // its name and Unbind, and sleep/wake/unregister are DISABLED with the exact reason rather than
  // silently absent — a control that looks like it works and does not is worse than no control.
  const wsl = sanitizeGroupWsl(data.wsl)
  const wslInstance = useWsl((s) => (wsl ? s.instances[wsl.distroName] : undefined))
  const wslEnumerated = useWsl((s) => s.enumeratedNames())
  const wslOwnedByApp = useWsl((s) => s.ownedByApp)
  const wslGone = !!wsl && !wslEnumerated.has(wsl.distroName)
  const wslCanManage = canManageWslDistro(wsl, wslEnumerated, wslOwnedByApp)

  // On an SSH project the poll is OFF, not merely useless: `git status <path>` would be answered by
  // the LOCAL filesystem for a project whose checkout lives on the host (remote git routing is
  // exact-cwd, and a worktree path is never the project's remoteCwd), so the chip would report a
  // local directory's branch — or, far worse, strike the group out and unlock the stale-Unbind path,
  // which rewrites the children's cwds. Worktrees are unsupported in SSH projects (v1): the honest
  // behaviour is no facts at all, not local facts about a remote checkout.
  const sshProject = useProjects((s) => !!s.projects.find((p) => p.id === s.activeProjectId)?.ssh)
  const wtPath = sshProject ? undefined : wt?.path
  // Asking once per render is NOT enough to make the chip live: nothing re-renders a group frame
  // while the user works inside its terminals, so the dirty count would freeze at whatever it was
  // when the node last happened to render (verified — it sat at "0 changed" until the canvas was
  // clicked). Hence a tick. It owns no cache and no `git status` of its own: it just pokes the
  // store, whose throttle still decides whether a real read happens (so N frames don't mean N
  // reads, and a mid-window render still coalesces).
  //
  // A STALE worktree is polled too (that is how a group un-stales when the directory comes back —
  // e.g. the user restored it, or a git read failed transiently), and the poke carries the group id
  // so the store can flip staleness live instead of only at project load.
  //
  // `git status` is the full Source-Control read (ELEVEN git subprocesses — see git-service's
  // `status`), and it is per BOUND GROUP: nothing coalesces two worktrees, because they are
  // different paths. So the tick is gated twice and runs slowly:
  //  - **page visibility** — a hidden tab / minimized window polls nothing, and a
  //    `visibilitychange` back to visible pokes immediately so the chip is correct the moment it
  //    is seen again;
  //  - **viewport** — React Flow keeps every node MOUNTED regardless of the camera (we do not set
  //    `onlyRenderVisibleElements`), so without this a frame parked off-screen kept spawning git
  //    for a chip nobody could see. An IntersectionObserver against the document viewport is the
  //    same shape the WebGL budget uses; entering the viewport pokes at once.
  // The cadence is WORKTREE_STATUS_POLL_MS, deliberately far slower than the store's throttle
  // floor: the throttle exists so several pokes in one window cost one read, NOT as a target rate.
  // A dirty-file counter on a frame is ambient information (Source Control's own auto-fetch is
  // 180 s); an explicit poke — visibility, viewport entry, mount — still refreshes within the 4 s
  // floor, so the chip stays responsive to the things the user actually does.
  //
  // (Gating here rather than hoisting a single store-owned timer keeps the poll tied to the node's
  // own mount/unmount lifecycle — no registry to leak.)
  useEffect(() => {
    if (!wtPath) return
    const el = frameRef.current
    // Assume visible when there is no element to observe (jsdom, or a pre-paint mount): the old
    // behaviour, i.e. never quieter than it needs to be at the cost of a poll.
    let onScreen = true
    const poke = (): void => {
      if (document.visibilityState === 'hidden' || !onScreen) return
      void useWorktrees.getState().refreshStatus(wtPath, id)
    }
    poke()
    const t = setInterval(poke, WORKTREE_STATUS_POLL_MS)
    document.addEventListener('visibilitychange', poke)
    const io =
      el && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const next = entries[entries.length - 1]?.isIntersecting ?? true
              const entered = next && !onScreen
              onScreen = next
              if (entered) poke()
            },
            { rootMargin: '200px' }
          )
        : null
    if (el && io) io.observe(el)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', poke)
      io?.disconnect()
    }
  }, [wtPath, id])

  // Dissolving the frame destroys the worktree binding (the frame IS the binding) while the
  // worktree itself stays on disk. Route that through Canvas's `unbind` first, so the store
  // re-reconciles (the worktree is offered as an orphan again, and a stale registration is
  // pruned) instead of the binding silently vanishing until the next project switch.
  // Toy lock on the FRAME (docs/toy-locks.md). It gates this frame's own structural actions and
  // nothing else: the nodes inside are separate objects carrying their own locks, and a frame lock
  // that pretended to cover them would be claiming a protection it does not provide -- the one
  // thing a toy lock must never do.
  const lockRecords = useToyLocks((s) => s.records)
  const lockUnlockedUntil = useToyLocks((s) => s.unlockedUntil)
  const lockRecord = lockRecords.find((r) => r.target.kind === 'group' && r.target.id === id)
  const frameLocked = !!lockRecord && !(lockUnlockedUntil[lockRecord.id] > Date.now())
  const [unlockAnchor, setUnlockAnchor] = useState<{ x: number; y: number } | null>(null)

  const promptUnlock = (e: { clientX: number; clientY: number }): void =>
    setUnlockAnchor({ x: e.clientX, y: e.clientY })

  const ungroup = (e?: { clientX: number; clientY: number }): void => {
    // Re-asked at CLICK time, not captured when the button rendered: the lock can engage while
    // the frame is on screen (a minutes timer expiring, a relock from elsewhere).
    if (frameLocked) {
      if (e) promptUnlock(e)
      return
    }
    if (wt) worktreeActionHandler?.(id, 'unbind')
    setNodes((ns) => ungroupNodes(ns as CanvasNode[], id))
  }

  // A bound frame must read as a checkout at a glance: solid border + a stronger tint of the
  // group's OWN color (no new palette). Stale drops the hue entirely and goes muted/warning.
  const bound = !!wt
  const frameClass = [
    'group-node',
    selected ? 'selected' : '',
    bound ? 'group-node--worktree' : '',
    bound && stale ? 'group-node--worktree-stale' : '',
    projectRefUnavailable ? 'group-node--worktree-stale' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={frameRef}
      className={frameClass}
      style={{
        borderColor: bound && stale || projectRefUnavailable ? undefined : data.color,
        // 28/255 and 15/255 are the `1c` / `0f` hex-alpha suffixes this used to append to the
        // colour string — same pixels, but a frame coloured from the picker's RGB/HSL/OKLCH tabs
        // now gets its fill instead of silently losing it. See alphaTint.
        background:
          bound && stale || projectRefUnavailable
            ? undefined
            : alphaTint(data.color, bound ? 28 / 255 : 15 / 255),
        // Rounded selection ring (box-shadow follows border-radius, unlike the resizer line).
        boxShadow: selected ? `0 0 0 1.5px ${data.color}` : undefined
      }}
    >
      <NodeResizer
        minWidth={NODE_MIN_SIZES.group.width}
        minHeight={NODE_MIN_SIZES.group.height}
        isVisible={selected}
        color={data.color}
        lineStyle={{ borderColor: 'transparent' }}
      />

      <div className="group-node__label">
        {frameLocked && (
          <button
            className="group-node__lock nodrag"
            title={vocab('This frame is locked — click to unlock')}
            onClick={(e) => promptUnlock(e)}
          >
            🔒
          </button>
        )}
        <button
          className="group-node__dot nodrag"
          style={{ background: data.color }}
          title={vocab(frameLocked ? 'Locked — click to unlock' : 'Color')}
          onClick={(e) => {
            if (frameLocked) {
              promptUnlock(e)
              return
            }
            const r = e.currentTarget.getBoundingClientRect()
            setColorAnchor((cur) => (cur ? null : { x: r.left, y: r.bottom + 4 }))
          }}
        />
        {colorAnchor && (
          <ColorMenu
            x={colorAnchor.x}
            y={colorAnchor.y}
            // Seeded from THIS frame's colour; applied live, so the frame (and the tint of every
            // child it sits behind) repaints while the picker is still open.
            value={data.color}
            onPick={(c) => updateNodeData(id, { color: c })}
            onClose={() => setColorAnchor(null)}
          />
        )}
        <input
          className="group-node__name nodrag"
          value={data.title}
          spellCheck={false}
          readOnly={frameLocked}
          title={frameLocked ? vocab('Locked — unlock the frame to rename it') : undefined}
          onMouseDown={(e) => {
            if (frameLocked) promptUnlock(e)
          }}
          onChange={(e) => updateNodeData(id, { title: e.target.value })}
        />
        {wt && (
          <div className="group-node__wt nodrag">
            {stale ? (
              // The directory is gone from disk (deleted outside the app). Merge and Remove would
              // act on a path that no longer exists, so only Unbind is offered.
              <span
                className="group-node__branch group-node__branch--stale"
                title={`${vocab('Worktree directory is gone')} ${wt.path}\n${vocab('Unbind to detach this group from it.')}`}
              >
                ⎇ {wt.branch} · {vocab('missing')}
              </span>
            ) : (
              <span className="group-node__branch" title={wt.path}>
                {/* The branch git reports NOW wins: the user may have switched branches inside
                    the worktree from a terminal, and the persisted name would then be a lie. */}
                ⎇ {status?.branch || wt.branch}
                {!!status && status.dirty > 0 && (
                  <em className="group-node__wt-dirty" title={`${status.dirty} ${vocab('changed file(s)')}`}>
                    {' '}
                    · {status.dirty} {vocab('changed')}
                  </em>
                )}
                {!!status && status.ahead > 0 && (
                  <em className="group-node__wt-ahead" title={`${status.ahead} ${vocab('commit(s) ahead')}`}>
                    {' '}
                    · {status.ahead}↑
                  </em>
                )}
                {!!status && status.behind > 0 && (
                  <em className="group-node__wt-behind" title={`${status.behind} ${vocab('commit(s) behind')}`}>
                    {' '}
                    · {status.behind}↓
                  </em>
                )}
              </span>
            )}
            {setupRun &&
              // What the project's script is doing to this checkout. Status only — the OUTPUT lives
              // in the settings panel's run box (this is a frame header, not a log viewer), and the
              // failed state is the one that has to be visible here: a node armed behind a failed
              // setup is still holding its launch, and nothing else on the canvas says why.
              //
              // A FAILED SETUP IS THEREFORE A BUTTON, not a label. It is the only re-run that can
              // clear this: the settings panel's Run executes at the project ROOT and claims the
              // PROJECT lane, so it can never re-attach a worktree group's run — clicking it would
              // leave this chip failed and its nodes armed forever. Re-running here re-attaches the
              // group's lane, and a `done` from the new run releases them.
              (setupRun.kind === 'setup' && setupRun.state === 'failed' ? (
                <button
                  className={`group-node__setup group-node__setup--${setupBusy ? 'running' : 'failed'} nodrag`}
                  disabled={setupBusy}
                  title={
                    setupBusy
                      ? 'Setup script is starting…'
                      : `Setup script failed${setupRun.exitCode === undefined ? '' : ` (exit ${setupRun.exitCode})`}.` +
                        '\nNodes opened into this worktree may still be holding their launch.' +
                        '\nClick to run it again — a successful run releases them.' +
                        '\n(Its output is in Project settings → Setup.)'
                  }
                  onClick={() => worktreeActionHandler?.(id, 'rerun-setup')}
                >
                  {setupBusy ? 'setup …' : 'setup ✕ ↻'}
                </button>
              ) : (
                <span
                  className={`group-node__setup group-node__setup--${setupRun.state}`}
                  title={
                    `${setupRun.kind === 'archive' ? 'Archive' : 'Setup'} script: ${setupRun.state}` +
                    (setupRun.exitCode === undefined ? '' : ` (exit ${setupRun.exitCode})`)
                  }
                >
                  {setupRun.kind === 'archive' ? 'archive' : 'setup'}
                  {setupRun.state === 'running' ? ' …' : setupRun.state === 'done' ? ' ✓' : ' ✕'}
                </span>
              ))}
            {!stale && (
              <button
                className="group-node__wt-btn"
                title={vocab('Merge to main')}
                onClick={() => worktreeActionHandler?.(id, 'merge')}
              >
                ⤴
              </button>
            )}
            <button
              className="group-node__wt-btn"
                title={vocab(
                stale
                  ? 'Unbind (the directory is gone — also prunes the stale git registration)'
                  : 'Unbind worktree (keeps the worktree on disk)'
              )}
              onClick={() => worktreeActionHandler?.(id, 'unbind')}
            >
              {vocab('Unbind')}
            </button>
            {!stale && (
              <button
                className="group-node__wt-btn"
                title={vocab('Remove worktree')}
                onClick={() => worktreeActionHandler?.(id, 'remove')}
              >
                ✕
              </button>
            )}
          </div>
        )}
        {projectRef && (
          <div className="group-node__wt nodrag">
            {projectRefUnavailable ? (
              <span
                className="group-node__branch group-node__branch--stale"
                title="Referenced project is unavailable or closed. Reopen it to drill into it."
              >
                ↗ unavailable project
              </span>
            ) : (
              <span className="group-node__branch" title={`Drill into project: ${referencedProject?.name ?? ''}`}>
                <span
                  className="group-node__dot"
                  style={{ display: 'inline-block', background: referencedProject?.color ?? '#0a84ff' }}
                />{' '}
                ↗ {referencedProject?.name}
              </span>
            )}
          </div>
        )}
        {wsl && (
          <div className="group-node__wt group-node__wsl nodrag">
            <span
              className="group-node__branch"
              title={wslGone ? `${wsl.distroName} — ${vocab('no longer registered on this machine')}` : wsl.distroName}
            >
              ⌂ {wsl.distroName}
              {!wslGone && wslInstance && (
                <em className="group-node__wt-dirty" title={wslInstance.state}>
                  {' '}
                  · {wslInstance.state}
                  {typeof wslInstance.memoryMb === 'number' ? ` · ${Math.round(wslInstance.memoryMb)} MB` : ''}
                </em>
              )}
              {wslGone && <em className="group-node__branch--stale"> · {vocab('missing')}</em>}
            </span>
            {!wslGone && (
              <button
                className="group-node__wt-btn"
                title={
                  wslCanManage
                    ? wslInstance?.state === 'running'
                      ? vocab('Sleep this WSL instance')
                      : vocab('Wake this WSL instance')
                    : vocab(WSL_NOT_OWNED_HINT)
                }
                disabled={!wslCanManage}
                onClick={() =>
                  wslActionHandler?.(id, wslInstance?.state === 'running' ? 'sleep' : 'wake')
                }
              >
                {wslInstance?.state === 'running' ? '⏾' : '▶'}
              </button>
            )}
            <button
              className="group-node__wt-btn"
              title={vocab('Unbind (does not touch the WSL instance)')}
              onClick={() => wslActionHandler?.(id, 'unbind')}
            >
              {vocab('Unbind')}
            </button>
            {!wslGone && (
              <button
                className="group-node__wt-btn"
                title={wslCanManage ? vocab('Unregister (deletes the instance permanently)') : vocab(WSL_NOT_OWNED_HINT)}
                disabled={!wslCanManage}
                onClick={() => wslActionHandler?.(id, 'delete')}
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      <GitHubWorkItemAttachment items={frameItems} frameId={id} frameBranch={frameBranch} />

      {unlockAnchor &&
        (() => {
          // Re-resolved live rather than closed over: the record can be removed or edited from
          // Settings while this popover is open.
          const live = useToyLocks
            .getState()
            .records.find((r) => r.target.kind === 'group' && r.target.id === id)
          if (!live) return null
          return (
            <UnlockPrompt
              record={live}
              anchor={unlockAnchor}
              onClose={() => setUnlockAnchor(null)}
              onUnlocked={() => setUnlockAnchor(null)}
            />
          )
        })()}

      <div className="group-node__actions nodrag">
        <button
          className="group-node__drill"
          title="Open as canvas"
          aria-label="Open group as canvas"
          onClick={() => drillHandler?.(id)}
        >
          ⤢
        </button>
        <button
          className="group-node__ungroup"
          title={vocab(frameLocked ? 'Locked — click to unlock' : 'Ungroup')}
          onClick={(e) => ungroup(e)}
        >
          {frameLocked ? '🔒' : vocab('ungroup')}
        </button>
        <button
          className="group-node__close"
          title={vocab(frameLocked ? 'Locked — click to unlock' : 'Remove group (keeps nodes)')}
          onClick={(e) => ungroup(e)}
        >
          ×
        </button>
      </div>
    </div>
  )
}
