// Reusable site-owned input dialogs and copy ownership segments.
//
// Browser-native prompts cannot expose the page's accessibility, copy ownership, or privacy
// boundaries. This module keeps dialog values ephemeral, bounds every input, and classifies every
// surrounding text fragment as application-authored copy or an exact fact.

import { sha256Hex } from '../shared/crypto.js'

const PART_KINDS = new Set(['authored', 'fact'])
const INPUT_KINDS = new Set(['text', 'password', 'pin', 'json'])

export function authoredPart(text) {
  return { kind: 'authored', text: String(text ?? '') }
}

export function factPart(text) {
  return { kind: 'fact', text: String(text ?? '') }
}

export function normalizeOwnedParts(value, defaultKind = 'authored') {
  if (!PART_KINDS.has(defaultKind)) throw new TypeError('Unknown copy ownership kind.')
  const source = Array.isArray(value) ? value : [{ kind: defaultKind, text: value ?? '' }]
  return source.map((part) => {
    if (!part || typeof part !== 'object' || !PART_KINDS.has(part.kind)) {
      throw new TypeError('Copy parts must be authored or fact segments.')
    }
    return { kind: part.kind, text: String(part.text ?? '') }
  })
}

export function ownedText(state, value, mapAuthored = (_state, text) => text, defaultKind = 'authored') {
  return normalizeOwnedParts(value, defaultKind)
    .map((part) => (part.kind === 'authored' ? mapAuthored(state, part.text) : part.text))
    .join('')
}

function defaultMaxLength(kind) {
  if (kind === 'json') return 65536
  if (kind === 'text') return 200
  return 256
}

export function openInputDialog(store, options) {
  const kind = INPUT_KINDS.has(options?.kind) ? options.kind : 'text'
  const maxLength = Math.max(1, Math.min(65536, Number(options?.maxLength) || defaultMaxLength(kind)))
  const initialValue = String(options?.initialValue ?? '').slice(0, maxLength)
  const dialog = {
    id: String(options?.id || 'site-input').slice(0, 80),
    kind,
    maxLength,
    allowEmpty: options?.allowEmpty === true,
    titleParts: normalizeOwnedParts(options?.titleParts ?? options?.title ?? ''),
    bodyParts: normalizeOwnedParts(options?.bodyParts ?? options?.body ?? ''),
    labelParts: normalizeOwnedParts(options?.labelParts ?? options?.label ?? ''),
    submitParts: normalizeOwnedParts(options?.submitParts ?? options?.submitLabel ?? 'Save'),
    cancelParts: normalizeOwnedParts(options?.cancelParts ?? options?.cancelLabel ?? 'Cancel'),
    placeholderParts: normalizeOwnedParts(options?.placeholderParts ?? options?.placeholder ?? ''),
    onSubmit: typeof options?.onSubmit === 'function' ? options.onSubmit : () => {},
    onCancel: typeof options?.onCancel === 'function' ? options.onCancel : () => {},
  }
  store.setState({ inputDialog: dialog, inputDialogValue: initialValue }, { persist: false })
  return dialog
}

export function openSecretCheckDialog(store, options) {
  return openInputDialog(store, {
    ...options,
    kind: options?.kind === 'pin' ? 'pin' : 'password',
    onSubmit: async (secret) => {
      const actual = await sha256Hex(secret)
      const expected = typeof options?.expectedHash === 'function' ? options.expectedHash() : options?.expectedHash
      if (actual === expected) await options?.onAccepted?.()
      else await options?.onRejected?.()
    },
  })
}

export function setInputDialogValue(store, value) {
  const dialog = store.state.inputDialog
  if (!dialog) return false
  store.setState({ inputDialogValue: String(value ?? '').slice(0, dialog.maxLength) }, { persist: false })
  return true
}

export function cancelInputDialog(store) {
  const dialog = store.state.inputDialog
  if (!dialog) return false
  store.setState({ inputDialog: null, inputDialogValue: '' }, { persist: false })
  dialog.onCancel()
  return true
}

export async function submitInputDialog(store) {
  const dialog = store.state.inputDialog
  if (!dialog) return false
  const value = String(store.state.inputDialogValue ?? '').slice(0, dialog.maxLength)
  if (!dialog.allowEmpty && !value) return false
  // Clear the live field before any asynchronous hash, parse, or feature callback can run. The
  // supplied value exists only in this call frame and is never copied into history or diagnostics.
  store.setState({ inputDialog: null, inputDialogValue: '' }, { persist: false })
  await dialog.onSubmit(value)
  return true
}

export function inputDialogReady(state) {
  const dialog = state.inputDialog
  if (!dialog) return false
  return dialog.allowEmpty || String(state.inputDialogValue ?? '').length > 0
}
