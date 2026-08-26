import { useCallback, useEffect, useState } from 'react'
import {
  detectHelpPlatform,
  remoteLoginCopyFor,
  showsCommandInstead
} from '../../../lib/remoteLoginHelp'
import type { RemoteLoginHelp } from '../../../../shared/types'
import type { PairedDevice } from '@shared/types'
import { SettingsSection } from '../SettingsSection'
import { SettingsText } from '../SettingsText'
import { SearchableRow } from '../SearchableRow'
import { requiresDestructiveGate } from '@shared/kids-mode-policy'
import { openDestructiveGate } from '../../../state/destructiveGate'
import { kidsDestructiveGateRequired, useKidsMode } from '../../../state/kidsMode'
import { ConfirmDialog } from '../../ConfirmDialog'
import { Button } from '@renderer/ui/Button'
import { Switch } from '@renderer/ui/Switch'
import { useSettings } from '@renderer/state/settings'
import { usePhonePairing } from '../usePhonePairing'

const ROWS = {
  remote: {
    title: 'Remote access from your phone',
    keywords: ['phone', 'remote', 'anywhere', 'relay', 'encrypted', 'access', 'cellular']
  },
  pair: {
    title: 'Pair a device',
    keywords: ['phone', 'pair', 'qr', 'code', 'mobile', 'ios', 'ssh', 'scan', 'nodeterm']
  },
  devices: {
    title: 'Paired devices',
    keywords: ['phone', 'device', 'devices', 'paired', 'revoke', 'remove']
  },
  relayPeers: {
    title: 'Approved relay peers',
    keywords: [
      'relay',
      'peer',
      'peers',
      'approved',
      'trusted',
      'revoke',
      'remove',
      'session',
      'phone',
      'desktop'
    ]
  }
}
const ENTRIES = Object.values(ROWS)

/** Format an epoch-ms pairing time as a short local date. */
function formatPairedAt(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

/** The pairing host is this machine, so the renderer's own UA answers "is this a Mac?". */
const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
// Copy is chosen from the platform; the ROUTE is whatever the handler reports it did.
const helpPlatform = detectHelpPlatform(navigator)
const remoteLoginCopy = remoteLoginCopyFor(helpPlatform)

export function PhoneSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  if (!window.nodeTerminal.pairing.supported) {
    return (
      <SettingsSection
        id="phone"
        title="Phone"
        description="Phone pairing is a desktop-host capability."
        isActive={isActive}
        searchEntries={ENTRIES}
      >
        <div className="space-y-2" role="status">
          <h4 className="text-[13px] font-medium text-text"><SettingsText>Not available in Server Edition</SettingsText></h4>
          <p className="text-sm text-muted">
            <SettingsText>This browser is already connected to the Server Edition host. Pair</SettingsText>{' '}
            <strong>nodeterm mobile</strong>{' '}<SettingsText>from the desktop app running on the machine whose terminals you want to reach.</SettingsText>
          </p>
        </div>
      </SettingsSection>
    )
  }
  return <SupportedPhoneSection isActive={isActive} />
}

function SupportedPhoneSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const [devices, setDevices] = useState<PairedDevice[]>([])
  const [pendingRevoke, setPendingRevoke] = useState<PairedDevice | null>(null)
  const [revokeError, setRevokeError] = useState('')
  // What the handler reported it DID. Null until asked — the button is still offered then,
  // because pressing it is what asks; rendering nothing until an answer arrives would
  // reproduce the dead end this replaced.
  const [remoteLoginHelp, setRemoteLoginHelp] = useState<RemoteLoginHelp | null>(null)
  const openRemoteLogin = async (): Promise<void> => {
    try {
      setRemoteLoginHelp(await window.nodeTerminal.pairing.openRemoteLoginSettings())
    } catch {
      // Server Edition answers 'unsupported' here. Falling back to the command keeps a
      // route on screen instead of a button that has already failed once.
      setRemoteLoginHelp({ opened: 'none', command: 'sudo systemctl enable --now ssh' })
    }
  }

  const phoneAccessEnabled = useSettings((s) => s.settings.phoneAccessEnabled)
  const updateSettings = useSettings((s) => s.update)

  const refreshDevices = useCallback(async (): Promise<void> => {
    try {
      setDevices(await window.nodeTerminal.pairing.listDevices())
    } catch {
      // leave the last-known list on a transient read error
    }
  }, [])

  // Mutually-approved relay peers — a phone or another desktop that can reach THIS machine's
  // terminals over the relay tunnel (see the "Relay RPC authorization" section in CLAUDE.md).
  // A separate store from the SSH pairing registry above: approval here is durable and, until
  // today, had no revoke UI at all.
  const [relayPeers, setRelayPeers] = useState<string[]>([])
  const [pendingRevokePeer, setPendingRevokePeer] = useState<string | null>(null)
  const [revokePeerError, setRevokePeerError] = useState('')

  const refreshRelayPeers = useCallback(async (): Promise<void> => {
    try {
      setRelayPeers(await window.nodeTerminal.relayPeers.list())
    } catch {
      // leave the last-known list on a transient read error
    }
  }, [])

  // The shared pairing machine (also behind the top-right quick-pair popover); a completed
  // pairing refreshes the device list below.
  const { phase, qr, sshOpen, sshHealed, relayResult, relayPlan, error, busy, start, stop, reset } = usePhonePairing(
    () => void refreshDevices()
  )

  const togglePhoneAccess = (next: boolean): void => {
    updateSettings({ phoneAccessEnabled: next })
    // Start/stop the standing relay host immediately.
    window.nodeTerminal.remoteHost.setPhoneAccess(next)
    // The relay block is baked into the QR when the listener STARTS — a code already on
    // screen doesn't know about this flip, and scanning it would still produce a LAN-only
    // pairing (the field failure: works at home, dies on cellular). Regenerate; start()
    // cancels the old listener silently.
    if (phase === 'waiting') void start()
  }

  // Load the paired-device list on mount.
  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  useEffect(() => {
    void refreshRelayPeers()
  }, [refreshRelayPeers])

  // Read at RENDER: the mode is a shared record another process can flip, so a Settings page left
  // open across that change must honour the new state rather than one captured at mount.
  const kidsModeOn = useKidsMode(kidsDestructiveGateRequired)
  const kidsGateRequired = requiresDestructiveGate('revoke-device', kidsModeOn).required
  const relayPeerKidsGateRequired = requiresDestructiveGate('revoke-relay-peer', kidsModeOn).required

  const requestRevoke = (device: PairedDevice, anchorEl: HTMLElement | null): void => {
    if (!kidsGateRequired) {
      setPendingRevoke(device)
      return
    }
    const rect = anchorEl?.getBoundingClientRect()
    openDestructiveGate({
      title: `Revoke “${device.name}”`,
      description:
        'This device’s key is deleted from this machine. It cannot reconnect, and getting it back means pairing it again from scratch.',
      affected: [device.name],
      confirmLabel: 'Revoke',
      anchor: rect ? { x: rect.left, y: rect.bottom } : undefined,
      restoreFocusEl: anchorEl,
      onConfirm: () => void revokeDevice(device)
    })
  }

  const revokeDevice = async (device: PairedDevice): Promise<void> => {
    setPendingRevoke(null)
    try {
      await window.nodeTerminal.pairing.revokeDevice(device.id)
      // A successful retry is the only thing that clears the persistent warning.
      setRevokeError('')
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      // Never imply success when authorized_keys could not be checked or rewritten. The row stays
      // in local state and refreshDevices preserves it on read failure, so the owner keeps a Retry.
      setRevokeError(
        `Couldn’t revoke “${device.name}”${detail}. Its SSH access may still be active. ` +
          'The device remains listed; fix the file-access problem and retry Revoke.'
      )
    } finally {
      void refreshDevices()
    }
  }

  /** Show a peer's key truncated for readability — there is no label on disk to show instead. */
  const shortPeerKey = (peerKeyB64: string): string =>
    peerKeyB64.length > 16 ? `${peerKeyB64.slice(0, 8)}…${peerKeyB64.slice(-8)}` : peerKeyB64

  const requestRevokePeer = (peerKeyB64: string, anchorEl: HTMLElement | null): void => {
    if (!relayPeerKidsGateRequired) {
      setPendingRevokePeer(peerKeyB64)
      return
    }
    const rect = anchorEl?.getBoundingClientRect()
    openDestructiveGate({
      title: `Revoke peer “${shortPeerKey(peerKeyB64)}”`,
      description:
        'This peer is un-pinned AND its live relay session (if any) is cut immediately. It cannot reconnect without a fresh mutual approval.',
      affected: [shortPeerKey(peerKeyB64)],
      confirmLabel: 'Revoke',
      anchor: rect ? { x: rect.left, y: rect.bottom } : undefined,
      restoreFocusEl: anchorEl,
      onConfirm: () => void revokeRelayPeer(peerKeyB64)
    })
  }

  const revokeRelayPeer = async (peerKeyB64: string): Promise<void> => {
    setPendingRevokePeer(null)
    try {
      const result = await window.nodeTerminal.relayPeers.revoke(peerKeyB64)
      // Both halves of the outcome are reported independently (revocation.ts's RevokeResult):
      // a peer that stays pinned on disk is a different, worse failure than one whose live
      // session could not be cut, and neither may be collapsed into a bare "Removed".
      if (!result.persisted) {
        setRevokePeerError(
          `Couldn’t un-pin “${shortPeerKey(peerKeyB64)}” on disk. It may still be able to ` +
            'reconnect with no approval prompt. The peer remains listed; retry Revoke.'
        )
      } else if (!result.killed) {
        setRevokePeerError(
          `“${shortPeerKey(peerKeyB64)}” is un-pinned, but its live session could not be ` +
            'confirmed cut. It may still hold an open connection to this machine.'
        )
      } else {
        setRevokePeerError('')
      }
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      setRevokePeerError(
        `Couldn’t revoke “${shortPeerKey(peerKeyB64)}”${detail}. It may still be able to ` +
          'reach this machine. The peer remains listed; retry Revoke.'
      )
    } finally {
      void refreshRelayPeers()
    }
  }

  return (
    <SettingsSection
      id="phone"
      title="Phone"
      description="Pair nodeterm mobile so it can reach this machine — no terminal commands needed."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.remote}>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h4 className="text-[13px] font-medium text-text"><SettingsText>Remote access from your phone</SettingsText></h4>
              <p className="mt-1 text-sm text-muted">
                Reach this machine from anywhere — not just your local network — end-to-end encrypted
                over the relay. Your paired phone connects through the relay; the connection is
                verified with a code the first time.
              </p>
            </div>
            <Switch
              checked={phoneAccessEnabled}
              onChange={togglePhoneAccess}
              ariaLabel="Remote access from your phone"
            />
          </div>
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.pair}>
        <div className="space-y-4">
              <h4 className="text-[13px] font-medium text-text"><SettingsText>Pair a device</SettingsText></h4>
          <p className="text-sm text-muted">
            {/* Said in the future tense on purpose. This paragraph renders in BOTH states, and when
                Remote Login is off there is no QR below it — the old copy read "scan this QR" and
                "inside this QR" over an empty space, telling the reader to scan something that was not
                there. Every fact it carried is kept; only the tense moved. */}
            <SettingsText>Open</SettingsText>{' '}<strong>nodeterm mobile</strong>{' '}<SettingsText>on your iPhone and scan the QR below. The phone generates and keeps its own key; the pairing request and the credentials sent back are encrypted to the host key carried in that QR.</SettingsText>
          </p>

          {phase === 'idle' || phase === 'timeout' || phase === 'failed' ? (
            <div className="space-y-3">
              {phase === 'timeout' ? (
                <p className="text-sm text-muted">
                  <SettingsText>Pairing timed out — that code no longer works. Start again and scan the fresh one within ten minutes.</SettingsText>
                </p>
              ) : null}
              <Button variant="primary" disabled={busy} onClick={() => void start()}>
                {busy ? 'Starting…' : phase === 'idle' ? 'Start pairing' : 'Try pairing again'}
              </Button>
            </div>
          ) : null}

          {phase === 'waiting' && qr ? (
            <div className="space-y-3">
              {!sshOpen ? (
                // No QR until Remote Login is on: a pairing completed against an unreachable
                // sshd installs a key the phone can never use — the scan must wait, not the fix.
                // The live probe (usePhonePairing) flips sshOpen and the QR appears by itself.
                <div className="space-y-2">
                  <p className="text-sm" style={{ color: '#ff9f0a' }}>
                      {remoteLoginCopy.what} <SettingsText>is off, so your phone wouldn&apos;t be able to connect after pairing. Turn it on — the QR appears here the moment it is, with no need to restart pairing.</SettingsText>
                  </p>
                  {/* Rendered from what the handler RETURNS, never from the platform we guessed. The
                      button was mac-only and the handler was `if (platform !== 'darwin') return` — so a
                      Windows reader was told to turn something on, given no control, and the one control
                      that existed elsewhere would have done nothing for them. Where a platform has no
                      settings surface worth opening, show the command instead of a button that misfires. */}
                  {remoteLoginHelp?.opened === 'none' && remoteLoginHelp.command ? (
                    <p className="text-sm text-muted">
                      <SettingsText>Run</SettingsText>{' '}<code className="select-all">{remoteLoginHelp.command}</code>, <SettingsText>then come back — this page is watching.</SettingsText>
                    </p>
                  ) : (
                    <Button onClick={() => void openRemoteLogin()}>{remoteLoginCopy.button}</Button>
                  )}
                </div>
              ) : (
                <>
                  <img
                    src={qr}
                    width={240}
                    height={240}
                    alt="Pairing QR code"
                    className="rounded-lg bg-white p-2"
                  />
                  <p className="text-sm text-muted"><SettingsText>Waiting for your phone… (10 min)</SettingsText></p>
                  {relayPlan === 'dev' ? (
                    <p className="text-sm" style={{ color: '#ff9f0a' }}>
                      <SettingsText>Dev build: the relay is off regardless of the toggle, so this code pairs LAN-only. Run a packaged build — or set</SettingsText>{' '}<code>NODETERM_RELAY_URL</code>{' '}<SettingsText>for remote access.</SettingsText>
                    </p>
                  ) : !phoneAccessEnabled ? (
                    <p className="text-sm" style={{ color: '#ff9f0a' }}>
                      <SettingsText>LAN-only code: the phone will reach this machine only on this network. Turn on</SettingsText>{' '}<strong><SettingsText>Remote access from your phone</SettingsText></strong>{' '}<SettingsText>above first to also connect from cellular — the QR refreshes by itself.</SettingsText>
                    </p>
                  ) : null}
                  {sshHealed ? (
                    <p className="text-sm" style={{ color: '#30d158' }}>
                      ✓ <SettingsText>Remote Login is on — scan away.</SettingsText>
                    </p>
                  ) : null}
                </>
              )}
              <Button onClick={stop}>Cancel</Button>
            </div>
          ) : null}

          {phase === 'paired' ? (
            <div className="space-y-3">
              <p className="text-sm font-medium" style={{ color: '#30d158' }}>
                ✓ <SettingsText>Paired. That device can now connect with its own key.</SettingsText>
              </p>
              {relayResult === 'ok' ? (
                <p className="text-sm" style={{ color: '#30d158' }}>
                  Remote access is set up — the phone can reach this machine from anywhere.
                </p>
              ) : relayResult === 'failed' ? (
                <p className="text-sm" style={{ color: '#ff9f0a' }}>
                  ⚠ Remote-access setup failed, so this pairing is LAN-only for now. Check this
                  machine&apos;s internet connection and pair again to retry — or the phone will
                  pick it up by itself next time it connects on this network.
                </p>
              ) : relayResult === 'off' ? (
                <p className="text-sm text-muted">
                  LAN-only pairing — remote access is switched off above.
                </p>
              ) : relayResult === 'dev' ? (
                <p className="text-sm text-muted">
                  LAN-only pairing — this is an unpackaged (dev) build, where the relay is
                  disabled regardless of the toggle. Set NODETERM_RELAY_URL to test remote
                  access, or use a packaged build.
                </p>
              ) : null}
              <Button onClick={reset}>Pair another device</Button>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm" style={{ color: '#ff9f0a' }}>
              <SettingsText segments={[{ kind: 'fact', value: error }]} />
            </p>
          ) : null}
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.devices}>
        <div className="space-y-3">
              <h4 className="text-[13px] font-medium text-text"><SettingsText>Paired devices</SettingsText></h4>
          {revokeError ? (
            <p role="alert" className="text-sm" style={{ color: '#ff9f0a' }}>
              {revokeError}
            </p>
          ) : null}
          {devices.length === 0 ? (
            <p className="text-sm text-muted"><SettingsText>No devices paired yet</SettingsText></p>
          ) : (
            <ul className="space-y-2">
              {devices.map((device) => (
                <li
                  key={device.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text">{device.name}</div>
                    {device.pairedAt ? (
                      <div className="text-[12px] text-muted">
                        Paired {formatPairedAt(device.pairedAt)}
                      </div>
                    ) : null}
                  </div>
                  <Button onClick={(e) => requestRevoke(device, e.currentTarget)}>Revoke</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SearchableRow>

      <SearchableRow {...ROWS.relayPeers}>
        <div className="space-y-3">
          <h4 className="text-[13px] font-medium text-text"><SettingsText>Approved relay peers</SettingsText></h4>
          <p className="text-sm text-muted">
            Every phone or other desktop that has mutually approved a relay connection to this
            machine, and can therefore reach its terminals whenever it connects. Public keys
            only — never a credential.
          </p>
          {revokePeerError ? (
            <p role="alert" className="text-sm" style={{ color: '#ff9f0a' }}>
              {revokePeerError}
            </p>
          ) : null}
          {relayPeers.length === 0 ? (
            <p className="text-sm text-muted"><SettingsText>No relay peers approved yet</SettingsText></p>
          ) : (
            <ul className="space-y-2">
              {relayPeers.map((peerKeyB64) => (
                <li
                  key={peerKeyB64}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text" title={peerKeyB64}>
                      {shortPeerKey(peerKeyB64)}
                    </div>
                  </div>
                  <Button onClick={(e) => requestRevokePeer(peerKeyB64, e.currentTarget)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SearchableRow>

      {pendingRevokePeer && !relayPeerKidsGateRequired ? (
        <ConfirmDialog
          message={`Revoke peer “${shortPeerKey(pendingRevokePeer)}”? It is un-pinned and its live relay session (if any) is cut immediately.`}
          confirmLabel="Revoke"
          onConfirm={() => void revokeRelayPeer(pendingRevokePeer)}
          onCancel={() => setPendingRevokePeer(null)}
        />
      ) : null}

      {/* Revoking is destructive in a way the wording has to carry: the device's key is gone, so
          this is not "sign it out" — that phone has to be paired again from scratch, in person,
          with the machine it pairs to. Under kids mode it takes the two-key gate; with the mode
          off the existing single confirm is unchanged. */}
      {pendingRevoke && !kidsGateRequired ? (
        <ConfirmDialog
          message={`Revoke “${pendingRevoke.name}”? Its key is removed from this machine and it will no longer be able to connect.`}
          confirmLabel="Revoke"
          onConfirm={() => void revokeDevice(pendingRevoke)}
          onCancel={() => setPendingRevoke(null)}
        />
      ) : null}
    </SettingsSection>
  )
}
