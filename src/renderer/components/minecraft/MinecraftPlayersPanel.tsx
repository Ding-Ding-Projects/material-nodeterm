import { useEffect, useState } from 'react'
import type { MinecraftBannedPlayerEntry, MinecraftPlayerEntry, MinecraftPlayerLists } from '@shared/minecraft'
import { useSession } from '../../session/session'
import { openDestructiveGate } from '../../state/destructiveGate'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

/** Every mutation here is a real vanilla console command sent through the same `sendCommand` the
 *  console tab already uses — never a direct edit of whitelist.json/ops.json/banned-players.json,
 *  which would race a live server writing the same file and can't resolve a player name to a
 *  UUID offline the way the server's own command handling does. That is why every action below
 *  is disabled outright while the server isn't running, with the reason said in the control
 *  itself rather than left for the click to fail silently. */
function isRunning(phase: string): boolean {
  return phase === 'running'
}

function ListSection({
  title,
  emptyLabel,
  entries,
  renderExtra,
  onRemove,
  removeLabel,
  disabled
}: {
  title: string
  emptyLabel: string
  entries: MinecraftPlayerEntry[]
  renderExtra?: (e: MinecraftPlayerEntry) => React.ReactNode
  onRemove: (name: string) => void
  removeLabel: string
  disabled: boolean
}): React.JSX.Element {
  return (
    <section className="mc-players__section" aria-label={title}>
      <h4 className="mc-players__heading">{title}</h4>
      {entries.length === 0 ? (
        <p className="mc-console__empty">{emptyLabel}</p>
      ) : (
        <ul className="mc-players__list">
          {entries.map((e) => (
            <li key={e.uuid} className="mc-players__row">
              <span className="mc-players__name">{e.name}</span>
              {renderExtra?.(e)}
              <button
                type="button"
                className="mc-link mc-link--danger nodrag"
                disabled={disabled}
                onClick={() => onRemove(e.name)}
              >
                {removeLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function MinecraftPlayersPanel({ nodeId, phase }: { nodeId: string; phase: string }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const { api } = useSession()
  const [lists, setLists] = useState<MinecraftPlayerLists | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [kickDraft, setKickDraft] = useState('')
  const [banDraft, setBanDraft] = useState('')

  const load = (): void => {
    void api.minecraft.readPlayerLists(nodeId).then(setLists)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [nodeId])
  // The lists are files this component reads on demand rather than a live-streamed channel (there
  // is no per-write event for them); re-poll gently while the server is running, since that's the
  // only time these files can actually change.
  useEffect(() => {
    if (!isRunning(phase)) return undefined
    const t = window.setInterval(load, 8000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, phase])

  const running = isRunning(phase)

  const runCommand = async (command: string): Promise<void> => {
    const ok = await api.minecraft.sendCommand(nodeId, command)
    if (ok) window.setTimeout(load, 500) // give the server a moment to rewrite its json files
  }

  const handleWhitelistAdd = (): void => {
    const name = nameDraft.trim()
    if (!name) return
    void runCommand(`whitelist add ${name}`)
    setNameDraft('')
  }

  const handleOp = (grant: boolean): void => {
    const name = nameDraft.trim()
    if (!name) return
    void runCommand(`${grant ? 'op' : 'deop'} ${name}`)
    setNameDraft('')
  }

  const requestKick = (): void => {
    const name = nameDraft.trim()
    if (!name) return
    const reason = kickDraft.trim()
    void runCommand(reason ? `kick ${name} ${reason}` : `kick ${name}`)
    setKickDraft('')
  }

  const requestBan = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const name = nameDraft.trim()
    if (!name) return
    const rect = e.currentTarget.getBoundingClientRect()
    openDestructiveGate({
      title: `Ban ${name}`,
      description: `Permanently bans ${name} from this server and disconnects them if they're online. They can rejoin only after this ban is pardoned.`,
      confirmLabel: 'Ban player',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: e.currentTarget,
      onConfirm: () => {
        const reason = banDraft.trim()
        void runCommand(reason ? `ban ${name} ${reason}` : `ban ${name}`)
        setBanDraft('')
      }
    })
  }

  const requestDeop = (name: string): void => {
    void runCommand(`deop ${name}`)
  }

  const requestPardon = (name: string, e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    openDestructiveGate({
      title: `Pardon ${name}`,
      description: `Lifts ${name}'s ban, letting them rejoin this server again.`,
      confirmLabel: 'Pardon',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: e.currentTarget,
      onConfirm: () => void runCommand(`pardon ${name}`)
    })
  }

  if (!lists) return <p className="service-node__note">{vocab('Loading player lists…')}</p>

  return (
    <div className="mc-players nodrag">
      {!running && (
        <p className="mc-note--warn">
          Adding, removing, kicking, banning or opping a player needs the server running — these
          commands go through the live console, the same way a real Minecraft server operator
          would type them. The lists below still reflect what's on disk right now.
        </p>
      )}

      <div className="mc-players__actions">
        <label className="service-node__field" htmlFor={`${nodeId}-mc-player-name`}>
          <span className="service-node__field-label">Player name</span>
          <input
            id={`${nodeId}-mc-player-name`}
            type="text"
            className="service-node__input nodrag"
            value={nameDraft}
            disabled={!running}
            placeholder="Steve"
            onChange={(e) => setNameDraft(e.target.value)}
          />
        </label>
        <div className="mc-row">
          <button type="button" className="mc-button nodrag" disabled={!running || !nameDraft.trim()} onClick={handleWhitelistAdd}>
            Whitelist
          </button>
          <button type="button" className="mc-button nodrag" disabled={!running || !nameDraft.trim()} onClick={() => handleOp(true)}>
            Make op
          </button>
          <button type="button" className="mc-button nodrag" disabled={!running || !nameDraft.trim()} onClick={() => handleOp(false)}>
            Remove op
          </button>
        </div>
        <label className="service-node__field" htmlFor={`${nodeId}-mc-kick-reason`}>
          <span className="service-node__field-label">Kick reason (optional)</span>
          <div className="mc-row">
            <input
              id={`${nodeId}-mc-kick-reason`}
              type="text"
              className="service-node__input nodrag"
              value={kickDraft}
              disabled={!running}
              onChange={(e) => setKickDraft(e.target.value)}
            />
            <button type="button" className="mc-button nodrag" disabled={!running || !nameDraft.trim()} onClick={requestKick}>
              Kick
            </button>
          </div>
        </label>
        <label className="service-node__field" htmlFor={`${nodeId}-mc-ban-reason`}>
          <span className="service-node__field-label">Ban reason (optional)</span>
          <div className="mc-row">
            <input
              id={`${nodeId}-mc-ban-reason`}
              type="text"
              className="service-node__input nodrag"
              value={banDraft}
              disabled={!running}
              onChange={(e) => setBanDraft(e.target.value)}
            />
            <button
              type="button"
              className="mc-button mc-link--danger nodrag"
              disabled={!running || !nameDraft.trim()}
              onClick={requestBan}
            >
              Ban…
            </button>
          </div>
        </label>
      </div>

      <ListSection
        title="Whitelist"
        emptyLabel="No one is whitelisted."
        entries={lists.whitelist}
        onRemove={(name) => runCommand(`whitelist remove ${name}`)}
        removeLabel="Remove"
        disabled={!running}
      />
      <ListSection
        title="Operators"
        emptyLabel="No operators."
        entries={lists.ops}
        onRemove={requestDeop}
        removeLabel="Deop"
        disabled={!running}
      />
      <section className="mc-players__section" aria-label="Banned players">
        <h4 className="mc-players__heading">Banned</h4>
        {lists.banned.length === 0 ? (
          <p className="mc-console__empty">No one is banned.</p>
        ) : (
          <ul className="mc-players__list">
            {lists.banned.map((b: MinecraftBannedPlayerEntry) => (
              <li key={b.uuid} className="mc-players__row">
                <span className="mc-players__name">{b.name}</span>
                {b.reason && <span className="mc-path">{b.reason}</span>}
                <button
                  type="button"
                  className="mc-link nodrag"
                  disabled={!running}
                  onClick={(e) => requestPardon(b.name, e)}
                >
                  Pardon
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mc-row">
        <button type="button" className="mc-button nodrag" onClick={load}>
          Refresh lists
        </button>
      </div>
    </div>
  )
}
