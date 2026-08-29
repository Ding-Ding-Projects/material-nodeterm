import { useEffect } from 'react'
import { useSettings } from '../state/settings'
import { useSchoolMode } from '../state/schoolMode'
import { useNotifications } from '../state/notifications'
import { allowsNotification, normalizeAdhdModes } from '../lib/adhdModes'
import { playSfx } from '../lib/sfx'
import { narrate } from '../lib/narrator'

/**
 * The host owns delivery, but a renderer must still consume the delivered projection. This funnel
 * is mounted once at the application root so Planner, Alarm, and Timer cards cannot each create a
 * duplicate toast, sound, or narration. A closed Server Edition client receives the same event on
 * its next subscription; the host keeps pending history until then.
 */
export function DurableOccurrenceConsumer() {
  useEffect(() => {
    const seen = new Set<string>()
    const unsubscribe = window.nodeTerminal.durableOccurrences.onChanged((snapshot) => {
      for (const occurrence of snapshot.occurrences) {
        if (occurrence.status !== 'delivered' || seen.has(occurrence.id)) continue
        seen.add(occurrence.id)
        const settings = useSettings.getState().settings
        const school = useSchoolMode.getState().enabled
        const quiet = !allowsNotification(normalizeAdhdModes(settings.adhdModes), 'done')
        useNotifications.getState().push({ id: occurrence.id, kind: 'info', title: occurrence.title, body: occurrence.body, silent: school || quiet })
        void window.nodeTerminal.durableOccurrences.acknowledge(occurrence.id, occurrence.delivery.generation)
        if (!school && occurrence.soundEnabled && settings.soundEffects && !quiet) playSfx('done', settings.soundVolume)
        if (!school && occurrence.narratorEnabled && settings.narratorEnabled) narrate({ category: `occurrence:${occurrence.sourceId}`, language: settings.narratorLanguage, en: `${occurrence.title}. ${occurrence.body}`, yue: `${occurrence.title}。${occurrence.body}`, rate: settings.narratorRate, pitch: settings.narratorPitch, voiceEn: settings.narratorVoiceEn, voiceYue: settings.narratorVoiceYue, cooldownMs: 5_000, debounceMs: 250 })
      }
    })
    const timer = window.setInterval(() => { void window.nodeTerminal.durableOccurrences.timerTick() }, 1000)
    return () => { unsubscribe(); window.clearInterval(timer) }
  }, [])
  return null
}
