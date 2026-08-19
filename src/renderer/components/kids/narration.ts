import { narrate } from '@renderer/lib/narrator'
import { decideCanvasNarration } from '@renderer/canvas/narration-policy'
import { schoolModeAllowsOptionalFeatures } from '@renderer/lib/schoolModePolicy'
import { useSettings } from '@renderer/state/settings'
import { useSchoolMode } from '@renderer/state/schoolMode'

/**
 * "Read every screen aloud" — the grown-up screen's narrator switch is the real, existing
 * app-wide narrator (`settings.narratorEnabled`), not a Kids-only feature reimplemented here. This
 * is the thin call site every kids screen uses to speak its own label on entry.
 *
 * Reuses `decideCanvasNarration` (the same pure policy Canvas.tsx's own narration call sites use)
 * rather than re-deriving "is Cantonese allowed right now" locally — School mode's suppression of
 * the Cantonese track is a judgment this repo keeps in exactly one place on purpose, and a second
 * copy here would be the drift this codebase has been bitten by before.
 *
 * `category` is 'kids-screen' for every call: a kid moving quickly between Home/Gate/Parent should
 * debounce down to the LATEST screen's label, not queue up and read every stop along the way.
 */
export function narrateKidsScreen(en: string, yue?: string): void {
  const settings = useSettings.getState().settings
  if (!settings.narratorEnabled) return
  const decision = decideCanvasNarration(settings, useSchoolMode.getState())
  narrate({
    category: 'kids-screen',
    language: decision.language,
    en,
    yue,
    rate: settings.narratorRate,
    pitch: settings.narratorPitch,
    voiceEn: settings.narratorVoiceEn,
    voiceYue: decision.voiceYue,
    canSpeakTrack: (track) =>
      track === 'en' ? true : schoolModeAllowsOptionalFeatures(useSchoolMode.getState()),
    debounceMs: 250
  })
}
