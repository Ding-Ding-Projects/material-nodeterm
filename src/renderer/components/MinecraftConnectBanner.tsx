import { useEffect, useState } from 'react'
import type { MinecraftServerStatus } from '@shared/minecraft'
import { useSession } from '../session/session'

// A running Minecraft server's connect address, shown over the canvas the same way TmuxBanner and
// TmuxBanner is: its own component subscribing for itself, so Canvas.tsx (already a hot
// file every branch touches) doesn't grow another block of polling logic. Its own reason for
// existing rather than reusing one of those two: this needs to know WHICH canvas nodes are
// Minecraft servers, which only Canvas has — so `minecraftNodeIds` arrives as a prop (the current
// project's minecraft-kind node ids), and everything after that is self-contained.

/** One row's worth of what a player needs to type in, resolved from the real
 *  `server-port`/network facts `MinecraftServerStatus` carries — never guessed. */
interface ConnectRow {
  id: string
  local: string
  lan: string | null
}

/** Exported for `MinecraftConnectBanner.test.ts` — the "absent when not running" rule is the
 *  whole point of this component, so it needs a direct test rather than only a full-render one. */
export function toRow(status: MinecraftServerStatus): ConnectRow | null {
  if (status.phase !== 'running') return null
  return {
    id: status.id,
    local: `${status.localAddress}:${status.port}`,
    lan: status.lanAddress ? `${status.lanAddress}:${status.port}` : null
  }
}

function AddressChip({ label, address }: { label: string; address: string }): React.JSX.Element {
  const { api } = useSession()
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    const ok = await api.clipboard.writeText(address)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <button
      type="button"
      className="mc-connect-chip nodrag"
      onClick={() => void copy()}
      title={`Copy ${label.toLowerCase()} address`}
    >
      <span className="mc-connect-chip__label">{label}</span>
      <span className="mc-connect-chip__address">{address}</span>
      <span className="mc-connect-chip__copy" aria-hidden="true">
        {copied ? '✓' : '⧉'}
      </span>
      <span className="sr-only">{copied ? 'Copied' : `Copy ${address} to clipboard`}</span>
    </button>
  )
}

export function MinecraftConnectBanner({
  minecraftNodeIds
}: {
  minecraftNodeIds: string[]
}): React.JSX.Element | null {
  const { api } = useSession()
  const [rows, setRows] = useState<Record<string, ConnectRow>>({})

  // Keys we've asked for a fresh status on and haven't heard from yet don't matter here — every
  // id in `minecraftNodeIds` gets a fetch, and the event listener keeps every row current after
  // that. Removing an id (node deleted / project switched) drops its row immediately rather than
  // showing a stale address for a server nobody can reach through this canvas any more.
  useEffect(() => {
    const idSet = new Set(minecraftNodeIds)
    setRows((prev) => {
      let changed = false
      const next: Record<string, ConnectRow> = {}
      for (const [id, row] of Object.entries(prev)) {
        if (idSet.has(id)) next[id] = row
        else changed = true
      }
      return changed ? next : prev
    })

    let cancelled = false
    for (const id of minecraftNodeIds) {
      void api.minecraft.status(id).then((status) => {
        if (cancelled) return
        const row = toRow(status)
        setRows((prev) => {
          if (!row) {
            if (!(id in prev)) return prev
            const { [id]: _drop, ...rest } = prev
            return rest
          }
          return { ...prev, [id]: row }
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [api, minecraftNodeIds])

  useEffect(() => {
    const idSet = new Set(minecraftNodeIds)
    return api.minecraft.onEvent((event) => {
      if (event.kind !== 'status') return
      if (!idSet.has(event.status.id)) return
      const row = toRow(event.status)
      setRows((prev) => {
        if (!row) {
          if (!(event.status.id in prev)) return prev
          const { [event.status.id]: _drop, ...rest } = prev
          return rest
        }
        return { ...prev, [event.status.id]: row }
      })
    })
  }, [api, minecraftNodeIds])

  if (Object.keys(rows).length === 0) return null
  const visible = Object.values(rows)

  return (
    <div className="mc-connect-banner" role="status" aria-label="Minecraft server connect address">
      {visible.map((row) => (
        <div className="mc-connect-banner__row" key={row.id}>
          <span className="mc-connect-banner__title">Minecraft server running</span>
          <AddressChip label="This machine" address={row.local} />
          {row.lan && <AddressChip label="Same network" address={row.lan} />}
          {!row.lan && (
            <span className="mc-connect-banner__note">No network address found for other devices.</span>
          )}
        </div>
      ))}
    </div>
  )
}
