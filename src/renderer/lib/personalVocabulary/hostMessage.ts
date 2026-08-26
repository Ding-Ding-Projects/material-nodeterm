import {
  validateVocabularyCachePayload,
  type PersonalVocabularyEntries
} from './schema'
import { applyVocabulary } from './apply'
import { useSchoolMode } from '../../state/schoolMode'

/** A host message is deliberately split into app-authored copy and verbatim runtime facts. */
export type HostMessagePart =
  | { kind: 'text'; value: string }
  | { kind: 'fact'; value: string }

export type HostVocabularyMap = (text: string) => string

export interface HostVocabularySchoolState {
  enabled: boolean
  hydrated: boolean
}

/** Apply personal vocabulary only to app-authored copy. Dynamic paths, ids, model names, and
 * host-provided error text are facts and must remain byte-identical. */
export function formatHostMessage(parts: HostMessagePart[], map: HostVocabularyMap): string {
  return parts.map((part) => (part.kind === 'text' ? map(part.value) : part.value)).join('')
}

export function hostText(value: string): HostMessagePart {
  return { kind: 'text', value }
}

export function hostFact(value: string): HostMessagePart {
  return { kind: 'fact', value }
}

const CACHE_KEY = 'nodeterm.personalVocabulary.v1'
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
let hostSchoolState: HostVocabularySchoolState = { enabled: false, hydrated: false }

/** Non-React entrypoints such as the HUD receive the shared mode snapshot through their host
 * bridge. Renderer entrypoints prefer the live Zustand mirror, which updates immediately when the
 * shared record changes. Before either source proves hydration, mapping stays disabled. */
export function setHostVocabularySchoolState(state: HostVocabularySchoolState): void {
  hostSchoolState = { enabled: state.enabled, hydrated: state.hydrated }
}

function currentHostSchoolState(): HostVocabularySchoolState {
  const rendererState = useSchoolMode.getState()
  if (rendererState.hydrated || rendererState.enabled || (typeof window !== 'undefined' && 'nodeTerminal' in window)) {
    return { enabled: rendererState.enabled, hydrated: rendererState.hydrated }
  }
  return hostSchoolState
}

/** Read the validated local cache for non-React entrypoints. A missing, stale, malformed, or
 * unavailable browser store returns an empty dictionary, which preserves original wording. */
export function readLocalVocabularyEntries(now = Date.now()): PersonalVocabularyEntries {
  if (typeof localStorage === 'undefined') return Object.create(null) as PersonalVocabularyEntries
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return Object.create(null) as PersonalVocabularyEntries
    const parsed = validateVocabularyCachePayload(raw)
    if (!parsed.ok) return Object.create(null) as PersonalVocabularyEntries
    if (parsed.cache.savedAt <= 0 || now - parsed.cache.savedAt > CACHE_MAX_AGE_MS || parsed.cache.savedAt > now + 60_000) {
      return Object.create(null) as PersonalVocabularyEntries
    }
    return parsed.cache.entries
  } catch {
    return Object.create(null) as PersonalVocabularyEntries
  }
}

export function mapLocalVocabularyText(text: string): string {
  const school = currentHostSchoolState()
  if (!school.hydrated || school.enabled) return text
  return applyVocabulary(text, readLocalVocabularyEntries())
}
