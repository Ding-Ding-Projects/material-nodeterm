// Password-protecting a one-file project save (`.nodeterm-project`).
//
// The archive itself (project-archive.ts / project-archive-container.ts) is a ZIP container whose
// entry NAMES alone say a great deal — which repository travelled, which working files exist, what
// the project is called. So this does not encrypt entries inside the container; it wraps the
// FINISHED container bytes whole, and the encrypted file is a small JSON envelope with the
// ciphertext inside it. Nothing about the project leaks: not the canvas, not the file list, not
// the name.
//
// Key derivation and authenticated encryption are deliberately the SAME primitives the password
// manager uses (./password-manager/crypto.ts): 128 MiB of scrypt per guess and AES-256-GCM. A save
// file is the single most portable thing this app produces — it goes on USB sticks and into mail —
// so it gets the strong contract, never the toy-lock one.
//
// What this does NOT claim: a password on a file the attacker HOLDS can be attacked offline, as
// fast as their hardware allows. The KDF is what makes that expensive; it is not what makes it
// impossible. The lockout ladder in the UI is a speed bump for the person at the keyboard and is
// no part of this file's guarantee.
//
// Electron-free (node:crypto only) — see ./no-electron.test.ts.

import {
  DEFAULT_KDF_PARAMS,
  decryptPayload,
  deriveVaultKey,
  encryptPayload,
  newSalt
} from './password-manager/crypto'
import type { EncryptedPayload, VaultKdfParams } from '../shared/password-manager'

/** Envelope marker — the first thing `looksLikeEncryptedArchive` matches on, so a protected file
 *  is recognised as ours (and as protected) before anything tries to unzip it. */
export const ENCRYPTED_ARCHIVE_KIND = 'nodeterm-project-encrypted'

export interface EncryptedArchiveFileV1 {
  kind: typeof ENCRYPTED_ARCHIVE_KIND
  version: 1
  savedAt: string
  kdf: VaultKdfParams
  /** base64, per-file. Non-secret on its own; it is what makes one password derive THIS file's key
   *  and no other file's. */
  salt: string
  /** The whole container, base64 inside an AEAD envelope. */
  payload: EncryptedPayload
}

export class EncryptedArchiveError extends Error {
  readonly code = 'encrypted-archive-error' as const
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Is this an encrypted save file? Cheap and non-throwing: the import path has to tell "this is
 * protected, ask for the password" from "this is a plain archive" and from "this is not one of our
 * files at all" — three different sentences, and a validator that throws for the last two cannot
 * distinguish the first.
 *
 * Sniffs the head of the buffer rather than parsing it all: an archive can be hundreds of MB, and
 * a plain ZIP container starts with `PK`, so JSON.parse on it would be pure waste.
 */
export function looksLikeEncryptedArchive(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 256).toString('utf-8')
  return head.trimStart().startsWith('{') && head.includes(ENCRYPTED_ARCHIVE_KIND)
}

function parseEnvelope(bytes: Buffer): EncryptedArchiveFileV1 {
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf-8'))
  } catch {
    throw new EncryptedArchiveError('This protected project file is damaged (it is not valid JSON).')
  }
  if (!isRecord(parsed) || parsed.kind !== ENCRYPTED_ARCHIVE_KIND || parsed.version !== 1) {
    throw new EncryptedArchiveError('This is not a protected nodeterm project file.')
  }
  const { kdf, salt, payload } = parsed
  if (
    !isRecord(kdf) ||
    typeof kdf.N !== 'number' ||
    typeof kdf.r !== 'number' ||
    typeof kdf.p !== 'number' ||
    typeof kdf.keylen !== 'number'
  ) {
    throw new EncryptedArchiveError('This protected project file has no usable key settings.')
  }
  if (typeof salt !== 'string') throw new EncryptedArchiveError('This protected project file has no salt.')
  if (
    !isRecord(payload) ||
    payload.v !== 1 ||
    typeof payload.iv !== 'string' ||
    typeof payload.ciphertext !== 'string' ||
    typeof payload.tag !== 'string'
  ) {
    throw new EncryptedArchiveError('This protected project file has no readable contents.')
  }
  return parsed as unknown as EncryptedArchiveFileV1
}

/**
 * Wrap finished archive bytes under `password`. The ciphertext is the container's base64 — the
 * envelope's own JSON layer is what makes the file self-describing enough to recognise and
 * refuse politely, rather than a naked blob that reads as corruption.
 */
export function encryptArchive(
  archive: Buffer,
  password: string,
  now: number = Date.now()
): Buffer {
  if (!password) throw new EncryptedArchiveError('A protected project file needs a password.')
  const salt = newSalt().toString('base64')
  const key = deriveVaultKey(password, salt, DEFAULT_KDF_PARAMS)
  const file: EncryptedArchiveFileV1 = {
    kind: ENCRYPTED_ARCHIVE_KIND,
    version: 1,
    savedAt: new Date(now).toISOString(),
    kdf: DEFAULT_KDF_PARAMS,
    salt,
    payload: encryptPayload(key, archive.toString('base64'))
  }
  return Buffer.from(`${JSON.stringify(file)}\n`, 'utf-8')
}

export type DecryptArchiveResult =
  // `Buffer<ArrayBuffer>` rather than a bare `Buffer`: the modern node typings distinguish a
  // possibly-shared backing store, and the archive reader takes the non-shared kind.
  | { ok: true; archive: Buffer<ArrayBuffer> }
  | { ok: false; error: 'wrong-password' }

/**
 * Unwrap a protected save file. A wrong password and a tampered file are DELIBERATELY
 * indistinguishable — that is AES-GCM's own guarantee, and password-manager/crypto.ts documents
 * why it must not be second-guessed. Both answer `wrong-password`, which is the honest thing to
 * put in front of the user: "either the password is wrong or this file has been altered" is a
 * sentence the UI can say, and picking one of the two would be a guess.
 *
 * A malformed envelope THROWS instead — that is not a password problem and must never be shown as
 * one, or the user retypes a correct password forever against a damaged file.
 */
export function decryptArchive(bytes: Buffer, password: string): DecryptArchiveResult {
  const file = parseEnvelope(bytes)
  const key = deriveVaultKey(password, file.salt, file.kdf)
  let base64: unknown
  try {
    base64 = decryptPayload<unknown>(key, file.payload)
  } catch {
    return { ok: false, error: 'wrong-password' }
  }
  if (typeof base64 !== 'string') {
    // Authenticated, so these bytes ARE ours — a shape we do not understand means a newer writer,
    // not an attacker. Say so rather than blaming the password.
    throw new EncryptedArchiveError('This protected project file needs a newer version of nodeterm.')
  }
  return { ok: true, archive: Buffer.from(base64, 'base64') as Buffer<ArrayBuffer> }
}
