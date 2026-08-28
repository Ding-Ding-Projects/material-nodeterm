import { useEffect } from 'react'
import { useSettings } from '@renderer/state/settings'
import { buildAppearanceStylesheet } from '@renderer/lib/appearance/apply'
import { useScheduledSettings } from '@renderer/state/scheduledSettings'

const STYLE_ELEMENT_ID = 'nodeterm-appearance-overrides'

/**
 * Mounted once near the app root. Regenerates one `<style>` tag from
 * `settings.elementAppearance` every time it changes, targeting every element on the page that
 * carries a matching `data-appearance-id` — which is how a themed element gets its override
 * without each consumer wiring inline styles by hand (docs/appearance.md).
 */
export function AppearanceStyleInjector(): null {
  const entries = useSettings((s) => s.settings.elementAppearance)
  const presets = useSettings((s) => s.settings.appearancePresets)
  const activeAppearance = useScheduledSettings((s) => s.active?.active?.effects?.appearance)
  const transientEntries = activeAppearance
    ? (() => {
        const preset = presets.find((candidate) => candidate.id === activeAppearance.presetId)
        return preset ? { [activeAppearance.targetId]: preset.style } : {}
      })()
    : {}

  useEffect(() => {
    let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ELEMENT_ID
      document.head.appendChild(el)
    }
    el.textContent = buildAppearanceStylesheet(entries, transientEntries)
  }, [entries, transientEntries])

  return null
}
