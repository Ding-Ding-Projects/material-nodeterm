// site/app/features/index.js
//
// The single entry point that wires every canonical feature into the
// running app. app/main.js calls registerFeatures() once at boot, after
// registerCoreRooms(); every module below registers its own room and/or
// settings card into app/core/engine.js's registries. This file is also
// what scripts/check-site-contract.mjs reads to prove a feature was not
// merely imported but actually invoked (see FEATURE_REGISTRARS below).

import { registerLanguageFeature } from './language-settings.js'
import { registerAppearance } from './appearance.js'
import { registerAboutYou } from './about-you.js'
import { registerSchoolMode } from './school-mode.js'
import { registerNarrator } from './narrator.js'
import { registerVocabulary } from './vocabulary.js'
import { registerTimers } from './timers.js'
import { registerDownloadDemo } from './download-demo.js'
import { registerLocks } from './locks.js'
import { registerExports } from './exports.js'
import { registerChangelog } from './changelog.js'
import { registerDocs } from './docs-index.js'
import { registerDimSum } from './dimsum.js'
import { registerCoverage } from './coverage.js'
import { registerAuthenticator } from './authenticator.js'
import { registerOllamaShop } from './ollama-shop.js'
import { registerConverter } from './converter.js'
import { registerPlayroom } from './playroom.js'
import { registerPairDevice } from './pair-device.js'
import { registerScreenshots } from './screenshots.js'
import { registerAdhdModes } from './adhd-modes.js'
import { registerCloudflare } from './cloudflare.js'

// Order matters only for the Settings room's card order and mirrors the
// imported design's own settings-card order.
const FEATURE_REGISTRARS = [
  registerLanguageFeature,
  registerAppearance,
  registerAboutYou,
  registerSchoolMode,
  registerNarrator,
  registerVocabulary,
  registerTimers,
  registerDownloadDemo,
  registerLocks,
  registerExports,
  registerChangelog,
  registerDocs,
  registerDimSum,
  registerCoverage,
  registerAuthenticator,
  registerOllamaShop,
  registerConverter,
  registerPlayroom,
  registerPairDevice,
  registerScreenshots,
  registerAdhdModes,
  registerCloudflare,
]

export function registerFeatures({ store, deps, registerAction, registerBinding }) {
  FEATURE_REGISTRARS.forEach((fn) => fn(store, deps, registerAction, registerBinding))
}
