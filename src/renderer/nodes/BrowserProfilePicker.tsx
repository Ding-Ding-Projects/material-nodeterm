import { useRef, useState } from 'react'
import type { BrowserProfile } from '@shared/types'
import { findBrowserProfile } from '@shared/browser-profiles'
import { IconButton } from '../ui/md3/IconButton'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { Menu } from '../ui/md3/Menu'
import { ListRow } from '../ui/md3/ListRow'
import { TextField } from '../ui/md3/TextField'
import { MaterialSymbol } from '../components/MaterialSymbol'
import { openDestructiveGate } from '../state/destructiveGate'

/** Same palette used by `groupSelectedNodes`/`createTerminalNode` for new-object color defaults —
 *  a browser profile is just another named, colored object on the project. */
const PROFILE_COLORS = ['#0a84ff', '#ff9f0a', '#30d158', '#ff375f', '#bf5af2', '#64d2ff', '#ffd60a']

function nextProfileId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c?.randomUUID) return `profile-${c.randomUUID().slice(0, 8)}`
  return `profile-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

interface BrowserProfilePickerProps {
  /** All profiles defined on this node's project (see `Project.browserProfiles`). */
  profiles: BrowserProfile[] | undefined
  /** This node's current selection — undefined = the default (unpartitioned) session. */
  selectedId: string | undefined
  onSelect: (id: string | undefined) => void
  onCreate: (profile: BrowserProfile) => void
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
}

/**
 * Header control for a browser node's profile: shows the current profile's name (or "Default"),
 * and opens an anchored popover to switch, create, rename, or remove a profile. Removing a
 * profile deletes real stored credentials for every node still using it (its cookies/localStorage
 * partition persists on disk independently of the node), so it goes through the two-key
 * destructive-confirmation gate like every other irreversible action in this app.
 */
export function BrowserProfilePicker({
  profiles,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onRemove
}: BrowserProfilePickerProps): React.JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const current = findBrowserProfile(profiles, selectedId)
  const label = selectedId ? (current?.name ?? 'Unknown profile') : 'Default'

  const startCreate = (): void => {
    setCreating(true)
    setNewName('')
  }

  const commitCreate = (): void => {
    const name = newName.trim()
    if (!name) {
      setCreating(false)
      return
    }
    const profile: BrowserProfile = {
      id: nextProfileId(),
      name,
      color: PROFILE_COLORS[(profiles?.length ?? 0) % PROFILE_COLORS.length]
    }
    onCreate(profile)
    onSelect(profile.id)
    setCreating(false)
    setNewName('')
  }

  const startRename = (p: BrowserProfile): void => {
    setRenamingId(p.id)
    setRenameValue(p.name)
  }

  const commitRename = (): void => {
    const name = renameValue.trim()
    if (renamingId && name) onRename(renamingId, name)
    setRenamingId(null)
  }

  const requestRemove = (p: BrowserProfile, e: React.MouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    openDestructiveGate({
      title: `Delete browser profile "${p.name}"`,
      description:
        'Its cookies, sign-ins and site storage are deleted from this machine. Any browser tab still using this profile falls back to the default (unpartitioned) session. This cannot be undone.',
      affected: [p.name],
      confirmLabel: 'Delete profile',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: anchorRef.current,
      onConfirm: () => onRemove(p.id)
    })
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="browser-profile-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Browser profile — isolated cookies/storage per profile"
        onClick={() => setOpen((v) => !v)}
      >
        <MaterialSymbol name="account_circle" size={16} />
        <span className="browser-profile-trigger__label">{label}</span>
      </button>
      <AnchoredPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={260}>
        <Menu role="menu" aria-label="Browser profile">
          <ListRow
            role="menuitemradio"
            aria-checked={!selectedId}
            icon={<MaterialSymbol name="account_circle" size={18} />}
            label="Default"
            sub="Unpartitioned — the app's shared session"
            trailing={!selectedId ? <MaterialSymbol name="check" size={16} /> : undefined}
            onClick={() => {
              onSelect(undefined)
              setOpen(false)
            }}
          />
          {(profiles ?? []).map((p) =>
            renamingId === p.id ? (
              <div key={p.id} className="browser-profile-picker__rename" role="none">
                <TextField
                  label="Profile name"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={commitRename}
                />
              </div>
            ) : (
              // Deliberately NOT a `ListRow` here: ListRow renders itself as a <button>, and the
              // rename/delete IconButtons below are real interactive controls too — nesting a
              // <button> inside another <button> is invalid HTML (jsdom's validateDOMNesting
              // caught this in review) and unreliable for assistive tech regardless. A `role`d
              // <div> that is itself keyboard-operable (tabIndex + Enter/Space) reuses the exact
              // same `mdx-row` visual recipe while keeping the row's own select action and its two
              // trailing buttons as SIBLING controls rather than nested ones.
              <div
                key={p.id}
                role="menuitemradio"
                aria-checked={selectedId === p.id}
                tabIndex={0}
                className="mdx-row"
                onClick={() => {
                  onSelect(p.id)
                  setOpen(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(p.id)
                    setOpen(false)
                  }
                }}
              >
                <span className="mdx-row__icon">
                  <MaterialSymbol name="account_circle" size={18} />
                </span>
                <span className="mdx-row__body">
                  <span className="mdx-row__label">{p.name}</span>
                </span>
                <span className="mdx-row__trailing browser-profile-picker__row-actions">
                  {selectedId === p.id && <MaterialSymbol name="check" size={16} />}
                  <IconButton
                    aria-label={`Rename “${p.name}”`}
                    icon="edit_note"
                    size="dense"
                    onClick={(e) => {
                      e.stopPropagation()
                      startRename(p)
                    }}
                  />
                  <IconButton
                    aria-label={`Delete “${p.name}”`}
                    icon="delete"
                    size="dense"
                    onClick={(e) => requestRemove(p, e)}
                  />
                </span>
              </div>
            )
          )}
          {creating ? (
            <div className="browser-profile-picker__rename" role="none">
              <TextField
                label="New profile name"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCreate()
                  if (e.key === 'Escape') setCreating(false)
                }}
                onBlur={commitCreate}
              />
            </div>
          ) : (
            <ListRow icon={<MaterialSymbol name="add" size={18} />} label="New profile…" onClick={startCreate} />
          )}
        </Menu>
      </AnchoredPopover>
    </>
  )
}
