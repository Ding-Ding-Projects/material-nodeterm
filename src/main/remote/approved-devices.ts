// Disk read/write for the standing (phone) host's pinned-device list. The pure pin/lookup logic
// lives in `approved-devices-core.ts`; this only touches the filesystem.
//
// Stored at <userData>/remote-approved-devices.json. The contents are PUBLIC keys (device box
// public keys the host has approved once), never credentials.

import { promises as fs } from 'fs'
import path from 'path'
import { app } from 'electron'
import { writeFileAtomic } from '../../core/fs-atomic'
import {
  emptyApprovedDevices,
  parsePersistedApprovedDevices,
  type ApprovedDevicesMutation,
  type ApprovedDevices
} from './approved-devices-core'

function file(): string {
  return path.join(app.getPath('userData'), 'remote-approved-devices.json')
}

/**
 * Every read and write enters one queue. Atomic rename prevents torn bytes; this queue prevents a
 * complete but stale read-modify-write snapshot from winning after a later revoke.
 */
let storeTail: Promise<void> = Promise.resolve()

function serializeStore<T>(operation: () => Promise<T>): Promise<T> {
  const result = storeTail.then(operation)
  // A failed read/write is reported to its caller but must not poison every later operation.
  storeTail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function readApprovedDevices(): Promise<ApprovedDevices> {
  try {
    const json = JSON.parse(await fs.readFile(file(), 'utf-8')) as unknown
    return parsePersistedApprovedDevices(json)
  } catch (err) {
    // Absence is the one checked state that means "there are no approved devices". Permission,
    // I/O, JSON and shape failures say only that trust could not be established, so preserve them.
    if ((err as NodeJS.ErrnoException | null)?.code === 'ENOENT') return emptyApprovedDevices()
    throw err
  }
}

/** Load the pinned-device list after all mutations already queued ahead of this read. */
export function loadApprovedDevices(): Promise<ApprovedDevices> {
  return serializeStore(readApprovedDevices)
}

async function writeApprovedDevices(store: ApprovedDevices): Promise<void> {
  const valid = parsePersistedApprovedDevices(store)
  await writeFileAtomic(file(), JSON.stringify(valid), { mode: 0o600 })
}

/**
 * Atomically decide and publish one approved-device mutation against the latest committed state.
 * Callers must pass their intent (`pinDevice` / `unpinDevice`), never a snapshot loaded earlier.
 * The full-snapshot writer deliberately stays private so a future caller cannot bypass the queue's
 * read-modify-write decision. `writeFileAtomic` still supplies unique temps, retrying rename and
 * failed-write cleanup; revocation's `persisted:false` contract depends on the old file surviving.
 *
 * No orphan sweep here, unlike the PAT stores or agent.json: these temps contain public keys, not
 * credentials, so a crashed temp is litter rather than a secret leak.
 */
export function mutateApprovedDevices(
  mutation: ApprovedDevicesMutation
): Promise<ApprovedDevices> {
  return serializeStore(async () => {
    const loaded = await readApprovedDevices()
    // A mutation is pure by contract. Freezing a private copy turns an accidental in-place push()
    // into a rejected operation instead of a silent `next === current` lost write.
    const current: ApprovedDevices = Object.freeze({
      pubkeys: Object.freeze([...loaded.pubkeys])
    })
    const next = mutation(current)
    // The pure pin/unpin helpers return the original object for an idempotent operation. Avoiding a
    // rewrite matters for revoke: "not pinned" is a successful checked result, not a new empty file.
    if (next === current) return current
    await writeApprovedDevices(next)
    return parsePersistedApprovedDevices(next)
  })
}
