// site/app/shared/school-state.js
//
// School mode: forces plain English at the calmest funny level and hides
// the jokey settings, without ever overwriting the user's real saved
// choices — they sit untouched underneath and come straight back the
// moment School mode is turned off. Optionally guarded by a PIN so it
// cannot be switched off again in a hurry.
//
// This is a user-experience toggle, not a security boundary: it is a toy
// gate exactly like the toy locks (see locks-state.js) and is documented
// as such everywhere it appears.

import { sha256Hex } from './crypto.js'

export const SHIPPED_NAME = 'School mode'

export async function setPin(pin) {
  const clean = String(pin || '').trim()
  if (!clean) return ''
  return sha256Hex(clean)
}

export async function verifyPin(pin, storedHash) {
  if (!storedHash) return true // no PIN was set — anyone can turn it off
  const hash = await sha256Hex(String(pin || ''))
  return hash === storedHash
}
