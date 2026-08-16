import type { NarratorLanguage } from '@shared/types'
import type { NarrateRequest, NarratorTrack } from '@renderer/lib/narrator'
import { agentDonePhrase, agentNeedsYouPhrase } from '@renderer/lib/narratorPhrases'
import {
  schoolModeAllowsOptionalFeatures,
  type SchoolModeGateState
} from '@renderer/lib/schoolModePolicy'

/** The hand-editable settings read at the two Canvas speech boundaries. */
export interface CanvasNarratorSettings {
  narratorEnabled: boolean
  narratorLanguage: unknown
  narratorRate: number
  narratorPitch: number
  narratorVoiceEn: string | null
  narratorVoiceYue: string | null
}

export interface CanvasNarratorDecision {
  shouldSpeak: boolean
  language: NarratorLanguage
  cantoneseAllowed: boolean
  voiceYue: string | null
}

export type NarrationSink = (request: NarrateRequest) => void
export type SchoolModeSource = () => SchoolModeGateState
export type SchoolModeSubscriber = (
  listener: (state: SchoolModeGateState, previous: SchoolModeGateState) => void
) => () => void

function configuredNarratorLanguage(value: unknown): NarratorLanguage {
  return value === 'yue' || value === 'both' ? value : 'en'
}

/**
 * Decide the effective speech policy at the moment an event is about to be narrated. School Mode
 * preserves the opt-in English narrator, but its Cantonese/bilingual capability is unavailable
 * until a successful shared-record read proves the mode is off. Keeping this decision at the
 * execution boundary prevents a persisted preference from leaking through during hydration or a
 * failed load; settings themselves remain untouched and resume once the mode is confirmed off.
 */
export function decideCanvasNarration(
  settings: CanvasNarratorSettings,
  schoolMode: SchoolModeGateState
): CanvasNarratorDecision {
  const cantoneseAllowed = schoolModeAllowsOptionalFeatures(schoolMode)
  return {
    shouldSpeak: settings.narratorEnabled === true,
    language: cantoneseAllowed ? configuredNarratorLanguage(settings.narratorLanguage) : 'en',
    cantoneseAllowed,
    voiceYue: cantoneseAllowed ? settings.narratorVoiceYue : null
  }
}

/**
 * A bilingual request can be waiting in the narrator debounce/queue when another app turns School
 * Mode on. Cancel that old-policy work as soon as the live state moves from confirmed-off to
 * suppressed; future events immediately re-enter through the English-only decision above.
 */
export function bindCanvasNarrationToSchoolMode(
  subscribe: SchoolModeSubscriber,
  suppressCantonese: () => void
): () => void {
  return subscribe((state, previous) => {
    if (
      schoolModeAllowsOptionalFeatures(previous) &&
      !schoolModeAllowsOptionalFeatures(state)
    ) {
      suppressCantonese()
    }
  })
}

function liveTrackPolicy(schoolMode: SchoolModeSource): (track: 'en' | 'yue') => boolean {
  return (track) => track === 'en' || schoolModeAllowsOptionalFeatures(schoolMode())
}

/** Execute a Settings voice preview against the live shared policy. The source is deliberately
 *  read when the captured click runs, rather than when its control rendered. */
export function executeNarratorPreview(
  track: NarratorTrack,
  schoolMode: SchoolModeSource,
  preview: () => void
): boolean {
  if (track === 'yue') {
    try {
      if (!schoolModeAllowsOptionalFeatures(schoolMode())) return false
    } catch {
      return false
    }
  }
  preview()
  return true
}

/** Execute the free-text app-error path used by the `nodeterm:toast` listener. */
export function executeAppErrorNarration(
  settings: CanvasNarratorSettings,
  schoolMode: SchoolModeSource,
  message: unknown,
  speak: NarrationSink
): boolean {
  const decision = decideCanvasNarration(settings, schoolMode())
  if (!decision.shouldSpeak || typeof message !== 'string' || message.trim() === '') return false
  speak({
    category: 'app-error',
    language: decision.language,
    en: message,
    rate: settings.narratorRate,
    pitch: settings.narratorPitch,
    voiceEn: settings.narratorVoiceEn,
    voiceYue: decision.voiceYue,
    canSpeakTrack: liveTrackPolicy(schoolMode),
    important: true
  })
  return true
}

export interface AgentStatusNarrationInput {
  sound: 'done' | 'needsYou'
  nodeId: string
  agentLabel: string
  context: string
}

/** Execute the agent-finished/needs-attention path used by the agent-status listener. */
export function executeAgentStatusNarration(
  settings: CanvasNarratorSettings,
  schoolMode: SchoolModeSource,
  input: AgentStatusNarrationInput,
  speak: NarrationSink
): boolean {
  const decision = decideCanvasNarration(settings, schoolMode())
  if (!decision.shouldSpeak) return false
  const phrase = input.sound === 'done'
    ? agentDonePhrase(input.agentLabel, input.context)
    : agentNeedsYouPhrase(input.agentLabel, input.context)
  speak({
    category: `agent-${input.sound}:${input.nodeId}`,
    language: decision.language,
    en: phrase.en,
    ...(decision.cantoneseAllowed ? { yue: phrase.yue } : {}),
    rate: settings.narratorRate,
    pitch: settings.narratorPitch,
    voiceEn: settings.narratorVoiceEn,
    voiceYue: decision.voiceYue,
    canSpeakTrack: liveTrackPolicy(schoolMode),
    englishFallbackWhenYueSuppressed: decision.language === 'yue'
  })
  return true
}
