// Relay advertisement — the cure for the LAN-only-pairing trap without re-pairing.
//
// `connection.relay` on the phone is otherwise written at exactly ONE moment (the pairing
// exchange), so a phone paired while "Reach this Mac from anywhere" was OFF stayed LAN-only
// forever: flipping the toggle later changed nothing, and off-LAN every open died with a raw
// connection error (field report). While the standing phone host is UP, we now advertise the
// relay identity in ~/.nodeterm/relay.json. The phone reads it over the SAME TOFU-verified SSH
// bootstrap it already uses for agent.json, then mints its own device token against the API
// (the free-tier TOFU mint). The file carries ONLY public material — the same block every
// pairing QR embeds, plus this desktop's device id for that mint; relay ACCESS remains gated
// host-side by the pin-once SAS approval, exactly as for a pairing-minted identity.

import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { removeAtomic, renameAtomic, tempNameFor } from '../../core/fs-atomic'

const FILE = path.join(os.homedir(), '.nodeterm', 'relay.json')

export interface RelayAdvertisement {
  v: 1
  hostId: string
  hostPublicKeyB64: string
  relayEndpoint: string
  hostDeviceId: string
}

/** Best-effort atomic write — a failed advertisement only means late adoption is unavailable.
 *  The rename retries a transient Windows sharing-violation error — see src/core/fs-atomic.ts. */
export async function writeRelayAdvertisement(ad: RelayAdvertisement): Promise<void> {
  // Unique per call. This is invoked fire-and-forget with nothing queueing it, so two
  // advertisements in flight shared one temp path and could publish each other's bytes. Declared
  // outside the try so the existing catch can remove it — a unique name never self-heals the way
  // the fixed one did, where the next write simply overwrote the litter.
  const tmp = tempNameFor(FILE)
  try {
    await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 })
    await fs.writeFile(tmp, JSON.stringify(ad, null, 2) + '\n', { mode: 0o600 })
    await renameAtomic(tmp, FILE)
  } catch {
    // Advertisement is opportunistic; pairing-time provisioning still works.
    await fs.rm(tmp, { force: true }).catch(() => {})
  }
}

/**
 * Remove the advertisement (host stopped / toggle off) so phones stop offering adoption.
 *
 * Returns false if the file is still there. That distinction is the point: this used to be an
 * unlink in a bare catch commented "already absent — fine", which is true of ENOENT and false of
 * everything else. On Windows a scanner or sync client holding the file open makes unlink fail
 * with EPERM, and the old shape read that as success — leaving a live advertisement on disk after
 * the user turned phone access OFF, so phones keep minting tokens against a host that will never
 * answer. That is precisely what removing it is for.
 */
export async function removeRelayAdvertisement(): Promise<boolean> {
  return removeAtomic(FILE)
}
