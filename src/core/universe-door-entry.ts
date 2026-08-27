/**
 * Numeric-code and passphrase entry for Multiverse doors.
 *
 * This module deliberately does not import toy-lock code. A door credential authorizes one
 * recorded portal transition, while a toy lock is a local presentation speed bump. The portable
 * shape contains only the door's safe policy and never contains a code, passphrase, or credential
 * fingerprint.
 */

export const UNIVERSE_DOOR_ENTRY_SCHEMA_VERSION = 3 as const

export type UniverseDoorEntryMethod = 'numeric-code' | 'passphrase'

export interface PortableUniverseDoorEntryV3 {
  schemaVersion: typeof UNIVERSE_DOOR_ENTRY_SCHEMA_VERSION
  doorId: string
  methods: readonly UniverseDoorEntryMethod[]
  defaultMethod: UniverseDoorEntryMethod
  /** Number of ASCII digits required when numeric-code is enabled. */
  numericCodeDigits?: number
  /** Minimum Unicode code-point count when passphrase is enabled. */
  passphraseMinLength?: number
}

/** Only a vault reference belongs in local application data. The credential value never does. */
export interface LocalUniverseDoorCredentialBindingV3 {
  schemaVersion: typeof UNIVERSE_DOOR_ENTRY_SCHEMA_VERSION
  doorId: string
  method: UniverseDoorEntryMethod
  credentialKey: string
  storage: 'credential-vault'
}

export type UniverseDoorEntrySubmission =
  | { method: 'numeric-code'; value: string }
  | { method: 'passphrase'; value: string }

export type UniverseDoorEntryValidation =
  | { valid: true; submission: UniverseDoorEntrySubmission }
  | {
      valid: false
      code:
        | 'method-unavailable'
        | 'numeric-code-required'
        | 'numeric-code-shape'
        | 'passphrase-required'
        | 'passphrase-too-short'
        | 'passphrase-too-long'
      message: string
    }

const DOOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ENTRY_METHODS: readonly UniverseDoorEntryMethod[] = ['numeric-code', 'passphrase']
const MIN_NUMERIC_CODE_DIGITS = 4
const MAX_NUMERIC_CODE_DIGITS = 12
const MIN_PASSPHRASE_LENGTH = 8
const MAX_PASSPHRASE_LENGTH = 256

function isEntryMethod(value: unknown): value is UniverseDoorEntryMethod {
  return value === 'numeric-code' || value === 'passphrase'
}

function assertNoUnknownFields(record: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new Error(`Unknown portable door-entry field: ${key}`)
  }
}

function validateDoorId(value: unknown): string {
  if (typeof value !== 'string' || !DOOR_ID.test(value)) {
    throw new Error('Portable door-entry doorId must be a bounded safe identifier.')
  }
  return value
}

function validateDigits(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_NUMERIC_CODE_DIGITS ||
    value > MAX_NUMERIC_CODE_DIGITS
  ) {
    throw new Error(`Portable numeric-code length must be an integer from ${MIN_NUMERIC_CODE_DIGITS} to ${MAX_NUMERIC_CODE_DIGITS}.`)
  }
  return value
}

function validatePassphraseMinLength(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_PASSPHRASE_LENGTH ||
    value > MAX_PASSPHRASE_LENGTH
  ) {
    throw new Error(`Portable passphrase minimum length must be an integer from ${MIN_PASSPHRASE_LENGTH} to ${MAX_PASSPHRASE_LENGTH}.`)
  }
  return value
}

/**
 * Validate and copy one portable schema 3 policy. Secret-shaped fields are not accepted, rather
 * than being silently dropped, so an accidental credential export fails before archive writing.
 */
export function validatePortableUniverseDoorEntry(input: unknown): PortableUniverseDoorEntryV3 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Portable door-entry policy must be an object.')
  }
  const record = input as Record<string, unknown>
  assertNoUnknownFields(record, [
    'schemaVersion',
    'doorId',
    'methods',
    'defaultMethod',
    'numericCodeDigits',
    'passphraseMinLength'
  ])
  if (record.schemaVersion !== UNIVERSE_DOOR_ENTRY_SCHEMA_VERSION) {
    throw new Error(`Portable door-entry schema must be ${UNIVERSE_DOOR_ENTRY_SCHEMA_VERSION}.`)
  }
  const doorId = validateDoorId(record.doorId)
  if (!Array.isArray(record.methods) || record.methods.length < 1 || record.methods.length > ENTRY_METHODS.length) {
    throw new Error('Portable door-entry methods must select at least one supported method.')
  }
  const methods = record.methods.map((method) => {
    if (!isEntryMethod(method)) throw new Error('Portable door-entry method is unsupported.')
    return method
  })
  if (new Set(methods).size !== methods.length) throw new Error('Portable door-entry methods must be unique.')
  if (!isEntryMethod(record.defaultMethod) || !methods.includes(record.defaultMethod)) {
    throw new Error('Portable door-entry defaultMethod must be one of methods.')
  }
  if (!methods.includes('numeric-code') && record.numericCodeDigits !== undefined) {
    throw new Error('Portable door-entry numericCodeDigits requires the numeric-code method.')
  }
  if (!methods.includes('passphrase') && record.passphraseMinLength !== undefined) {
    throw new Error('Portable door-entry passphraseMinLength requires the passphrase method.')
  }

  const numericCodeDigits = methods.includes('numeric-code')
    ? validateDigits(record.numericCodeDigits)
    : undefined
  const passphraseMinLength = methods.includes('passphrase')
    ? validatePassphraseMinLength(record.passphraseMinLength)
    : undefined

  return {
    schemaVersion: UNIVERSE_DOOR_ENTRY_SCHEMA_VERSION,
    doorId,
    methods: [...methods],
    defaultMethod: record.defaultMethod,
    ...(numericCodeDigits === undefined ? {} : { numericCodeDigits }),
    ...(passphraseMinLength === undefined ? {} : { passphraseMinLength })
  }
}

/** Validate a collection and reject duplicate or case-colliding door policies. */
export function validatePortableUniverseDoorEntries(
  input: readonly unknown[]
): PortableUniverseDoorEntryV3[] {
  const entries = input.map(validatePortableUniverseDoorEntry)
  const seen = new Set<string>()
  for (const entry of entries) {
    const folded = entry.doorId.toLocaleLowerCase('en-US')
    if (seen.has(folded)) throw new Error(`Duplicate or case-colliding door-entry policy: ${entry.doorId}`)
    seen.add(folded)
  }
  return [...entries].sort((left, right) => left.doorId.localeCompare(right.doorId))
}

/** Create the safe schema 3 policy from guided configuration choices. */
export function createPortableUniverseDoorEntry(input: {
  doorId: string
  methods: readonly UniverseDoorEntryMethod[]
  defaultMethod?: UniverseDoorEntryMethod
  numericCodeDigits?: number
  passphraseMinLength?: number
}): PortableUniverseDoorEntryV3 {
  return validatePortableUniverseDoorEntry({
    schemaVersion: UNIVERSE_DOOR_ENTRY_SCHEMA_VERSION,
    doorId: input.doorId,
    methods: input.methods,
    defaultMethod: input.defaultMethod ?? input.methods[0],
    numericCodeDigits: input.numericCodeDigits,
    passphraseMinLength: input.passphraseMinLength
  })
}

/**
 * Produce the stable key a credential-vault adapter may use. The value is only a lookup key, never
 * the credential itself, and callers must keep the vault implementation outside the projection.
 */
export function universeDoorCredentialKey(doorId: string): string {
  const safeDoorId = validateDoorId(doorId)
  return `nodeterm.universe-door.${safeDoorId}`
}

export function createLocalUniverseDoorCredentialBinding(
  policy: PortableUniverseDoorEntryV3,
  method: UniverseDoorEntryMethod
): LocalUniverseDoorCredentialBindingV3 {
  const checked = validatePortableUniverseDoorEntry(policy)
  if (!checked.methods.includes(method)) throw new Error('The selected credential method is unavailable for this door.')
  return {
    schemaVersion: UNIVERSE_DOOR_ENTRY_SCHEMA_VERSION,
    doorId: checked.doorId,
    method,
    credentialKey: universeDoorCredentialKey(checked.doorId),
    storage: 'credential-vault'
  }
}

/** Validate a submission without normalizing or persisting the secret value. */
export function validateUniverseDoorEntrySubmission(
  policy: PortableUniverseDoorEntryV3,
  submission: UniverseDoorEntrySubmission
): UniverseDoorEntryValidation {
  const checked = validatePortableUniverseDoorEntry(policy)
  if (!checked.methods.includes(submission.method)) {
    return {
      valid: false,
      code: 'method-unavailable',
      message: 'Choose one of the credential methods enabled for this door.'
    }
  }

  if (submission.method === 'numeric-code') {
    if (submission.value.length === 0) {
      return { valid: false, code: 'numeric-code-required', message: 'Enter the numeric door code.' }
    }
    if (!/^[0-9]+$/.test(submission.value) || submission.value.length !== checked.numericCodeDigits) {
      return {
        valid: false,
        code: 'numeric-code-shape',
        message: `Enter exactly ${checked.numericCodeDigits} digits.`
      }
    }
  } else {
    const codePoints = Array.from(submission.value).length
    if (submission.value.trim().length === 0) {
      return { valid: false, code: 'passphrase-required', message: 'Enter the door passphrase.' }
    }
    if (codePoints < checked.passphraseMinLength!) {
      return {
        valid: false,
        code: 'passphrase-too-short',
        message: `Use at least ${checked.passphraseMinLength} characters.`
      }
    }
    if (codePoints > MAX_PASSPHRASE_LENGTH) {
      return {
        valid: false,
        code: 'passphrase-too-long',
        message: `Use no more than ${MAX_PASSPHRASE_LENGTH} characters.`
      }
    }
  }
  return { valid: true, submission }
}

/** Portable exports name what remains local instead of hinting that entry credentials travelled. */
export function universeDoorEntryOmissions(): readonly string[] {
  return [
    'numeric code values',
    'passphrase values',
    'credential-vault material',
    'credential fingerprints',
    'provider sessions',
    'machine paths and runtime handles'
  ]
}
