import { isSafeWslDistroName } from '@shared/wsl-binding'

/**
 * Pure validation behind the "New WSL instance…" guided form, kept separate from the dialog
 * component so it is testable without React and so the disabled Create button and its hint text
 * can never drift from what would actually be accepted (docs/CLAUDE.md's "Guided forms" rule: a
 * disabled control always names exactly which condition is unmet).
 */
export interface WslCreateFormState {
  catalogueId: string | null
  name: string
  /** Every distro name currently registered on this machine — WSL itself requires uniqueness. */
  existingNames: ReadonlySet<string>
  catalogueLoading: boolean
  /** Presence of a typed catalogue failure blocks creation; its diagnostic is rendered by the
   * dialog as an external fact rather than being interpreted by this pure validator. */
  catalogueError: unknown
  busy: boolean
}

export interface WslCreateFormValidation {
  valid: boolean
  /** Plain-words reason the Create button is disabled, or null once every condition is met. */
  disabledReason: string | null
  /** Set once the user has actually typed a name, so a fresh dialog never accuses the user of a
   *  mistake they have not made yet (same rule `WorktreeDialog` follows for its branch field). */
  nameError: string | null
}

const MAX_NAME_LENGTH = 64
// WSL's own naming rules are permissive; this refuses the shapes that would either mean nothing
// to `wslconfig`/`wsl.exe` or could be misread as a flag/argument if ever interpolated.
const SAFE_NAME_CHARS = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]*[A-Za-z0-9])?$/

export function validateWslName(name: string, existingNames: ReadonlySet<string>): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Name is required.'
  if (trimmed !== name) return 'Name cannot start or end with whitespace.'
  if (trimmed.length > MAX_NAME_LENGTH) return `Name must be ${MAX_NAME_LENGTH} characters or fewer.`
  if (!isSafeWslDistroName(trimmed)) return 'Name contains characters that are not allowed.'
  if (!SAFE_NAME_CHARS.test(trimmed)) {
    return 'Use letters, numbers, spaces, dots, hyphens, or underscores, starting and ending with a letter or number.'
  }
  if (existingNames.has(trimmed)) return 'A WSL instance with this name already exists.'
  return null
}

export function validateWslCreateForm(state: WslCreateFormState): WslCreateFormValidation {
  const nameError = state.name.length > 0 ? validateWslName(state.name, state.existingNames) : null

  if (state.busy) return { valid: false, disabledReason: 'Creating…', nameError }
  if (state.catalogueLoading) {
    return { valid: false, disabledReason: 'Loading available distributions…', nameError }
  }
  if (state.catalogueError) {
    return { valid: false, disabledReason: 'Could not load available distributions.', nameError }
  }
  if (!state.catalogueId) return { valid: false, disabledReason: 'Choose a distribution.', nameError }
  const trimmedError = validateWslName(state.name, state.existingNames)
  if (trimmedError) return { valid: false, disabledReason: trimmedError, nameError: state.name ? trimmedError : nameError }
  return { valid: true, disabledReason: null, nameError: null }
}
