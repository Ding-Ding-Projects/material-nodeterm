// site/app/shared/school-state.js
//
// Pure state for School mode, kept separate from site/app/features/school-mode.js
// (which registers the UI) so that i18n.js can read "is school mode on right
// now" without importing a feature-registration module and creating a
// circular import between the two.
//
// This is a USER-EXPERIENCE lock, never a security boundary: turning it off
// needs a locally verified PIN, checked against a stored HASH — the PIN
// itself is never stored. Losing the PIN is recovered by clearing this
// site's browser storage; every surface that mentions this says so.

import { readJSON, writeJSON, readString, writeString, subscribe, remove } from './storage.js'
import { hashSecret, verifySecret, randomSaltHex } from './crypto.js'

const KEY_ENABLED = 'school.enabled'
const KEY_NAME = 'school.name'
const KEY_PIN_SALT = 'school.pinSalt'
const KEY_PIN_HASH = 'school.pinHash'

export const SHIPPED_NAME = 'School mode'

export function isEnabled() {
  return readJSON(KEY_ENABLED, false) === true
}

export function setEnabled(next) {
  writeJSON(KEY_ENABLED, Boolean(next))
}

/** The name shown for this feature everywhere on the site. Defaults to the
 * shipped name until the visitor renames it — after a rename, the shipped
 * name must never surface again anywhere, including search. */
export function getDisplayName() {
  return readString(KEY_NAME, SHIPPED_NAME) || SHIPPED_NAME
}

export function isRenamed() {
  return getDisplayName() !== SHIPPED_NAME
}

export function setDisplayName(name) {
  const trimmed = String(name || '').trim()
  writeString(KEY_NAME, trimmed || SHIPPED_NAME)
}

export function hasPin() {
  return Boolean(readString(KEY_PIN_HASH, ''))
}

export async function setPin(pin) {
  const salt = randomSaltHex()
  const hash = await hashSecret(pin, salt)
  writeString(KEY_PIN_SALT, salt)
  writeString(KEY_PIN_HASH, hash)
}

export async function verifyPin(pin) {
  const salt = readString(KEY_PIN_SALT, '')
  const hash = readString(KEY_PIN_HASH, '')
  if (!salt || !hash) return false
  return verifySecret(pin, salt, hash)
}

export function clearPin() {
  remove(KEY_PIN_SALT)
  remove(KEY_PIN_HASH)
}

export function subscribeSchoolState(cb) {
  const unsubs = [subscribe(KEY_ENABLED, cb), subscribe(KEY_NAME, cb), subscribe(KEY_PIN_HASH, cb)]
  return () => unsubs.forEach((u) => u())
}
