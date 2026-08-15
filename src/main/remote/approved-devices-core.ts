// Pure pin/lookup logic for the standing (phone) host's "pin once" device approval.
//
// The FIRST time a phone (identified by its NaCl box public key, base64) connects over the relay
// the host human approves it via the SAS dialog; on approval its pubkey is pinned here so future
// connects auto-approve with no prompt. These are PUBLIC keys, not credentials — safe to persist.
//
// Kept pure (no I/O) so it can be unit-tested; the disk read/write wrapper lives in
// `approved-devices.ts`.

/** The persisted shape of <userData>/remote-approved-devices.json. */
export interface ApprovedDevices {
  /** Base64 NaCl box public keys of phones the host has approved at least once. */
  readonly pubkeys: readonly string[]
}

/**
 * One read-modify-write decision against the approved-device store.
 *
 * The disk adapter serializes these decisions. Passing the decision instead of a precomputed
 * snapshot is what prevents an approval from publishing a stale list after a concurrent revoke.
 */
export type ApprovedDevicesMutation = (current: ApprovedDevices) => ApprovedDevices

/** Store seam used by trust/revocation code without exposing filesystem details. */
export type MutateApprovedDevices = (
  mutation: ApprovedDevicesMutation
) => Promise<ApprovedDevices>

export function emptyApprovedDevices(): ApprovedDevices {
  return { pubkeys: [] }
}

/** Coerce arbitrary parsed JSON into a well-formed ApprovedDevices (drops non-string / empty entries). */
export function parseApprovedDevices(raw: unknown): ApprovedDevices {
  if (!raw || typeof raw !== 'object') return emptyApprovedDevices()
  const pubkeys = (raw as { pubkeys?: unknown }).pubkeys
  if (!Array.isArray(pubkeys)) return emptyApprovedDevices()
  // De-dupe while preserving order; keep only non-empty strings.
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of pubkeys) {
    if (typeof k === 'string' && k.length > 0 && !seen.has(k)) {
      seen.add(k)
      out.push(k)
    }
  }
  return { pubkeys: out }
}

/**
 * Parse the persisted file without treating corruption as an empty trust list.
 *
 * `parseApprovedDevices` remains the tolerant decoder for untrusted in-memory values. A file read
 * is different: silently dropping a malformed entry (or a missing `pubkeys` field) would turn
 * "could not establish trust" into "no devices are trusted" and the next mutation would overwrite
 * the only evidence of the problem. The I/O adapter uses this strict form on every disk read/write.
 */
export function parsePersistedApprovedDevices(raw: unknown): ApprovedDevices {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { pubkeys?: unknown }).pubkeys)) {
    throw new Error('Approved-device data is not a valid store.')
  }
  const pubkeys = (raw as { pubkeys: unknown[] }).pubkeys
  if (pubkeys.some((key) => typeof key !== 'string' || key.length === 0)) {
    throw new Error('Approved-device data contains an invalid public key.')
  }
  return parseApprovedDevices(raw)
}

/** True when `pubkeyB64` has been pinned before. Empty input is never pinned. */
export function isPinned(store: ApprovedDevices, pubkeyB64: string): boolean {
  return pubkeyB64.length > 0 && store.pubkeys.includes(pubkeyB64)
}

/** Return a store with `pubkeyB64` pinned. Idempotent; returns the same object when already present. */
export function pinDevice(store: ApprovedDevices, pubkeyB64: string): ApprovedDevices {
  if (pubkeyB64.length === 0 || store.pubkeys.includes(pubkeyB64)) return store
  return { pubkeys: [...store.pubkeys, pubkeyB64] }
}

/** Return a store with `pubkeyB64` unpinned (revoke). Idempotent. */
export function unpinDevice(store: ApprovedDevices, pubkeyB64: string): ApprovedDevices {
  if (!store.pubkeys.includes(pubkeyB64)) return store
  return { pubkeys: store.pubkeys.filter((k) => k !== pubkeyB64) }
}
