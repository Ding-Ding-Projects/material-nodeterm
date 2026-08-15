// site/app/features/index.js
//
// Entry point for this site's feature layer, imported by site/index.html
// as `<script type="module" src="./app/features/index.js">` (owned by the
// sibling "shell" lane — see site/app/core/registry.js, which that lane is
// building alongside this one).
//
// EVERYTHING here is defensive: the registry module may not exist yet, and
// even once it does, an individual `registerTab`/`registerSetting`/
// `registerCommand` export may be missing or shaped differently than
// expected. A missing piece produces a console.warn and the rest of the
// page keeps working — this file must never throw in a way that blanks
// the page.

import { injectStyleOnce } from '../shared/dom.js'
import { registerLanguageFeature } from './language-settings.js'
import { registerSchoolMode } from './school-mode.js'
import { registerVocabulary } from './vocabulary.js'
import { registerDimSum } from './dimsum.js'
import { registerNarrator } from './narrator.js'
import { registerLocks } from './locks.js'
import { registerExports } from './exports.js'
import { registerChangelog } from './changelog.js'
import { registerDocs } from './docs-index.js'

// A tiny bit of shared base styling for elements common across every panel
// (headings, help text) so panels don't each redefine the same rules. Kept
// intentionally minimal — most styling lives beside the component that
// needs it via injectStyleOnce, per module.
injectStyleOnce(
  'site-features-base-style',
  `
  .site-panel-error { padding: 12px; border: 1px dashed var(--md-error, #ba1a1a); border-radius: 8px; color: var(--md-error, #ba1a1a); }
  `,
)

async function loadRegistry() {
  try {
    const mod = await import('../core/registry.js')
    if (!mod || typeof mod !== 'object') {
      console.warn('[nodeterm-site] core/registry.js loaded but exported nothing usable.')
      return null
    }
    return mod
  } catch (err) {
    console.warn(
      '[nodeterm-site] core/registry.js is not available yet (this is expected while the shell lane is still building it) — feature modules will not register.',
      err,
    )
    return null
  }
}

/** Wraps a registry function so a missing export, or a call that throws,
 * never takes down the rest of registration. */
function safeWrap(fn, name) {
  if (typeof fn !== 'function') {
    return (entry) => {
      console.warn(`[nodeterm-site] registry.${name} is not a function — skipping registration of`, entry && entry.id)
    }
  }
  return (entry) => {
    try {
      return fn(entry)
    } catch (err) {
      console.warn(`[nodeterm-site] registry.${name} threw while registering`, entry && entry.id, err)
    }
  }
}

const FEATURE_REGISTRARS = [
  registerLanguageFeature,
  registerSchoolMode,
  registerVocabulary,
  registerDimSum,
  registerNarrator,
  registerLocks,
  registerExports,
  registerChangelog,
  registerDocs,
]

async function main() {
  const registry = await loadRegistry()
  if (!registry) return

  const api = {
    registerTab: safeWrap(registry.registerTab, 'registerTab'),
    registerSetting: safeWrap(registry.registerSetting, 'registerSetting'),
    registerCommand: safeWrap(registry.registerCommand, 'registerCommand'),
  }

  for (const register of FEATURE_REGISTRARS) {
    try {
      register(api)
    } catch (err) {
      console.warn('[nodeterm-site] a feature module failed to register:', register.name, err)
    }
  }
}

main()
