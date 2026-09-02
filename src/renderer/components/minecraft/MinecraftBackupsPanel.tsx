import { useEffect, useState } from 'react'
import type { MinecraftBackupSummary } from '@shared/minecraft'
import { useSession } from '../../session/session'
import { openDestructiveGate } from '../../state/destructiveGate'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { Button } from '@renderer/ui/md3'

/** Create/restore both refuse while the server is running — copying or replacing world files a
 *  live process still has open cannot be trusted. Same reason `writeProperties` refuses while
 *  running; see server-manager.ts's `createBackup`/`restoreBackup`. */
function isServerLive(phase: string): boolean {
  return phase === 'starting' || phase === 'running' || phase === 'stopping'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatWhen(at: number): string {
  return new Date(at).toLocaleString()
}

export function MinecraftBackupsPanel({ nodeId, phase }: { nodeId: string; phase: string }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const { api } = useSession()
  const [backups, setBackups] = useState<MinecraftBackupSummary[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = (): void => {
    void api.minecraft.listBackups(nodeId).then(setBackups)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [nodeId])

  const live = isServerLive(phase)
  const disabledReason = live
    ? 'Stop the server first — a backup taken while it is writing to the world files can capture a half-saved region.'
    : undefined

  const handleCreate = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.minecraft.createBackup(nodeId)
      load()
    } finally {
      setBusy(false)
    }
  }

  const requestRestore = (backup: MinecraftBackupSummary, e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    openDestructiveGate({
      title: 'Restore this backup',
      description: `Replaces the current world with the copy from ${formatWhen(backup.createdAt)}. The world being replaced is saved first as an automatic backup, so this can be undone by restoring it back — but any progress made since ${formatWhen(backup.createdAt)} is otherwise lost.`,
      confirmLabel: 'Restore',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: e.currentTarget,
      onConfirm: () => {
        setBusy(true)
        void api.minecraft
          .restoreBackup(nodeId, backup.id)
          .finally(() => {
            setBusy(false)
            load()
          })
      }
    })
  }

  const requestDelete = (backup: MinecraftBackupSummary, e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    openDestructiveGate({
      title: 'Delete this backup',
      description: `Permanently deletes the backup from ${formatWhen(backup.createdAt)}. This cannot be undone.`,
      confirmLabel: 'Delete permanently',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: e.currentTarget,
      onConfirm: () => {
        void api.minecraft.deleteBackup(nodeId, backup.id).then(load)
      }
    })
  }

  if (!backups) return <p className="service-node__note">{vocab('Loading backups…')}</p>

  return (
    <div className="mc-players nodrag">
      <p className="service-node__note">
        A backup is a full copy of the world folder, taken when you ask for one — nothing here
        deletes or thins out old backups automatically, so remove ones you no longer want by hand.
      </p>
      <div className="mc-row">
        <Button variant="filled" size="small" vocabularyMode="factual"
          type="button"
          className="mc-button mc-button--primary nodrag"
          disabled={busy || live}
          title={disabledReason}
          onClick={() => void handleCreate()}
        >
          Back up the world now
        </Button>
      </div>
      {live && <p className="mc-note--warn">{disabledReason}</p>}

      {backups.length === 0 ? (
        <p className="mc-console__empty">No backups yet.</p>
      ) : (
        <ul className="mc-players__list">
          {backups.map((b) => (
            <li key={b.id} className="mc-players__row">
              <span className="mc-players__name">
                {formatWhen(b.createdAt)}
                {b.auto ? ' (automatic, made before a restore overwrote it)' : ''}
              </span>
              <span className="mc-path">{formatBytes(b.sizeBytes)}</span>
              <Button variant="outlined" size="small" vocabularyMode="factual"
                type="button"
                className="mc-link nodrag"
                disabled={busy || live}
                title={disabledReason}
                onClick={(e) => requestRestore(b, e)}
              >
                Restore
              </Button>
              <Button variant="outlined" size="small" vocabularyMode="factual"
                type="button"
                className="mc-link mc-link--danger nodrag"
                disabled={busy}
                onClick={(e) => requestDelete(b, e)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mc-row">
        <Button variant="outlined" size="small" vocabularyMode="factual" className="mc-button nodrag" onClick={load}>
          Refresh
        </Button>
      </div>
    </div>
  )
}
