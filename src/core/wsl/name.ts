// Name validation for a new WSL distribution.
//
// This is a REFUSE, never SANITIZE, boundary. A name is either accepted verbatim or rejected with
// a reason; nothing here trims, strips, truncates, or otherwise silently rewrites a name a user
// typed. Silent rewriting would let a user believe they created "my-project!" and later discover
// nodeterm actually created "my-project", which is exactly the kind of surprise a naming boundary
// exists to prevent.
//
// Every name that survives this check still crosses the trust boundary into `wsl.exe` as one
// element of an argv array (never a shell string), so this validation is defense in depth rather
// than the only thing standing between user input and command injection.

const MAX_NAME_LENGTH = 64
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// Windows reserved device names. A distribution's on-disk package folder is derived from its
// name, and creating one shaped like a reserved device name is a well-known way to produce a
// directory Explorer and some tools cannot open normally.
const RESERVED_DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

export type WslNameRefusalReason =
  | 'empty'
  | 'too-long'
  | 'invalid-characters'
  | 'reserved-name'
  | 'name-taken'

export type WslNameValidation =
  | { ok: true }
  | { ok: false; reason: WslNameRefusalReason; message: string }

/**
 * Validates a proposed distribution name. `existingNames` should include every distribution
 * currently on the machine, nodeterm's own and the user's pre-existing ones alike: a name
 * collision is refused regardless of who owns the name it collides with, because `wsl --install`
 * itself cannot create a second distribution under a name that is already in use.
 */
export function validateWslDistributionName(
  name: string,
  existingNames: readonly string[]
): WslNameValidation {
  if (name.length === 0) {
    return { ok: false, reason: 'empty', message: 'Give the new distribution a name.' }
  }
  if (name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      reason: 'too-long',
      message: `Distribution names must be ${MAX_NAME_LENGTH} characters or fewer.`
    }
  }
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      reason: 'invalid-characters',
      message:
        'Distribution names may use only letters, numbers, dots, hyphens, and underscores, and must start with a letter or number.'
    }
  }
  if (RESERVED_DEVICE_NAMES.has(name.toLocaleUpperCase('en-US'))) {
    return {
      ok: false,
      reason: 'reserved-name',
      message: `"${name}" is a reserved Windows device name and cannot be used.`
    }
  }
  const folded = name.toLocaleLowerCase('en-US')
  if (existingNames.some((existing) => existing.toLocaleLowerCase('en-US') === folded)) {
    return {
      ok: false,
      reason: 'name-taken',
      message: `A WSL distribution named "${name}" already exists on this machine. Choose a different name.`
    }
  }
  return { ok: true }
}
