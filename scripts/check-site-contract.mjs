#!/usr/bin/env node
// scripts/check-site-contract.mjs
//
// A hand-written completeness guard for the GitHub Pages site's feature
// contract. This is deliberately NOT wired into any GitHub Actions
// workflow — this project's CI runs no gating checks by policy (see
// CLAUDE.md's "Continuous integration and releases" section). It is a
// local tool: run it yourself before you consider a site change finished.
//
//   node scripts/check-site-contract.mjs
//
// WHY THIS IS HAND-WRITTEN RATHER THAN PATTERN-MATCHED: a guard that only
// validates whatever it happens to find already passes cleanly on a site
// that implements nothing at all, because it never looked for anything by
// name. Every row below names a REAL required file, export, or exact
// substring and asserts it is PRESENT — not merely that whatever exists is
// well-formed. When a new contract feature is added to this site, add its
// row here in the same change, or this guard will not know to look for it.
//
// It also fails on any root-absolute internal URL under site/ (an href,
// src, or url() starting with a bare "/"), because this fork's Pages
// deployment is served from a subpath (/material-nodeterm/, not a domain
// root) and a root-absolute link is invisible in local testing but 404s
// the moment it ships.
//
// REWRITTEN 2026-08 for the imported "nodeterm playground" redesign (a
// hallway-of-doors landing page + per-room shell, replacing the earlier
// tabbed marketing-site layout). The site's implementation architecture
// changed — from tabs.js-driven tab panels to a single store + render()
// loop with a room/settings-card registry (see site/app/core/engine.js
// and site/app/core/render.js) — so this guard's FEATURES table below was
// updated to match: it now points at each feature's *registrar* function
// under site/app/features/, which is how every room and settings card
// actually gets wired into the running app (see
// site/app/features/index.js#FEATURE_REGISTRARS). Nine feature rows are
// new in this pass (authenticator, Ollama shop, converter, coverage,
// playroom, appearance, about-you, timers, download-demo) because the
// redesign's component.js implements real behaviour for all of them that
// the previous guard never had a row for. Three new sections (6-8) guard
// the redesign's own divergences from the imported design and its removed
// design-tool scaffolding.

import { copyFileSync, mkdtempSync, readFileSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..')
const SITE_DIR = join(REPO_ROOT, 'site')

let failures = 0
let checkedCount = 0

function fail(message) {
  failures += 1
  console.error(`✗ ${message}`)
}
function pass(message) {
  checkedCount += 1
  console.log(`✓ ${message}`)
}

function readText(relPath) {
  const abs = join(REPO_ROOT, relPath)
  if (!existsSync(abs)) return null
  try {
    return readFileSync(abs, 'utf8')
  } catch (_err) {
    return null
  }
}

function requireFileExists(relPath, label) {
  checkedCount += 1
  if (!existsSync(join(REPO_ROOT, relPath))) {
    fail(`${label}: missing required file ${relPath}`)
    return false
  }
  pass(`${label}: ${relPath} exists`)
  return true
}

function requireFileContains(relPath, needle, label) {
  checkedCount += 1
  const text = readText(relPath)
  if (text == null) {
    fail(`${label}: cannot read ${relPath}`)
    return false
  }
  const found = needle instanceof RegExp ? needle.test(text) : text.includes(needle)
  if (!found) {
    fail(`${label}: ${relPath} does not contain expected content (${needle})`)
    return false
  }
  pass(`${label}: ${relPath} contains expected content`)
  return true
}

function requireFileOmits(relPath, needle, label) {
  checkedCount += 1
  const text = readText(relPath)
  if (text == null) {
    fail(`${label}: cannot read ${relPath}`)
    return false
  }
  if (text.includes(needle)) {
    fail(`${label}: ${relPath} still contains retired content (${needle})`)
    return false
  }
  pass(`${label}: ${relPath} omits retired content`)
  return true
}

function requireExportedFunction(relPath, fnName, label) {
  return requireFileContains(relPath, new RegExp(`export\\s+(async\\s+)?function\\s+${fnName}\\b`), label || `exports ${fnName}`)
}

function listSiteFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSiteFiles(full))
    else if (/\.(html|js|css|json)$/i.test(entry.name)) out.push(full)
  }
  return out
}
const ALL_SITE_FILES = listSiteFiles(SITE_DIR)

// ---------------------------------------------------------------------
// 1. Registered feature contracts — one row per canonical feature this
//    lane owns. Each row asserts the implementing file exists, exports
//    the function that registers it, and that features/index.js actually
//    calls that registrar (so a feature that exists but was never wired
//    into the entry point still fails this guard).
// ---------------------------------------------------------------------

const INDEX_FILE = 'site/app/features/index.js'
const indexText = readText(INDEX_FILE) || ''

const FEATURES = [
  {
    // Every user-facing app AND every user-facing page carries the accommodations — a docs site
    // that describes one while not offering it is the exact gap that rule closes.
    id: 'adhd-modes',
    label: 'ADHD modes',
    file: 'site/app/features/adhd-modes.js',
    exportName: 'registerAdhdModes',
    contentChecks: [
      // Five independent switches, never a master toggle.
      ['site/app/features/adhd-modes.js', 'adhd-toggle-'],
      // Focus dims and never hides — asserted on the stylesheet, where it would actually break.
      ['site/styles.css', 'data-adhd-focus'],
      ['site/styles.css', 'data-adhd-quiet'],
      // Not medical, said on the surface rather than only in the docs.
      ['site/app/features/adhd-modes.js', 'Not a diagnosis'],
    ],
  },
  {
    // The site is a tour of a desktop app, and until this room existed it showed no picture of
    // that app: the captures lived only under docs/, which Pages never serves. Listed here so a
    // gallery that silently stops rendering fails the inventory rather than going quietly.
    id: 'app-screenshots',
    label: 'Screenshots of the real built app',
    file: 'site/app/features/screenshots.js',
    exportName: 'registerScreenshots',
    contentChecks: [
      ['site/app/features/screenshots.js', 'makeMatcher'],
      ['site/app/shared/data.js', "id: 'shots'"],
      ['site/styles.css', '.shot-grid'],
    ],
  },
  {
    id: 'language-modes-funny-emoji',
    label: 'Language modes, funny levels, emoji toggle',
    file: 'site/app/features/language-settings.js',
    exportName: 'registerLanguageFeature',
    contentChecks: [
      ['site/app/shared/i18n.js', 'LANGUAGE_MODES'],
      ['site/app/shared/i18n.js', 'shapeVoice'],
      ['site/app/shared/i18n.js', 'getEmojiEnabled'],
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance: colours, presets, logo, export/import/reset',
    file: 'site/app/features/appearance.js',
    exportName: 'registerAppearance',
    contentChecks: [
      ['site/app/shared/data.js', 'SWATCHES'],
      ['site/app/shared/data.js', 'PRESETS'],
    ],
  },
  {
    id: 'about-you',
    label: 'About you: nickname + little sounds',
    file: 'site/app/features/about-you.js',
    exportName: 'registerAboutYou',
    contentChecks: [['site/app/core/engine.js', 'export function blip(']],
  },
  {
    id: 'school-mode',
    label: 'School mode',
    file: 'site/app/features/school-mode.js',
    exportName: 'registerSchoolMode',
    contentChecks: [
      ['site/app/shared/school-state.js', 'SHIPPED_NAME'],
      ['site/app/shared/school-state.js', 'setPin'],
      ['site/app/shared/school-state.js', 'verifyPin'],
    ],
  },
  {
    id: 'personal-vocabulary',
    label: 'Personal-vocabulary swaps',
    file: 'site/app/features/vocabulary.js',
    exportName: 'registerVocabulary',
    contentChecks: [
      ['site/app/shared/vocabulary-state.js', 'validateVocabularyJson'],
      ['site/app/shared/vocabulary-state.js', 'validateVocabularyCacheJson'],
      ['site/app/shared/vocabulary-state.js', 'VOCAB_MAX_ENTRIES'],
      ['site/app/core/render.js', 'data-bind-file'],
      ['site/app/main.js', 'bindFile'],
      ['site/app/shared/vocabulary-state.js', '__proto__'],
      ['site/app/shared/i18n.js', 'applyReplacements'],
    ],
  },
  {
    // Added after the completeness check below found it had no row — which is not an academic
    // gap: this exact file once imported a module that does not exist, which killed the whole
    // ES-module graph and served a BLANK site. `node --check` passed (syntax is not resolution),
    // this guard passed, and the server returned 200. Only a browser console showed it.
    id: 'pair-device',
    label: 'Remote access routes',
    file: 'site/app/features/pair-device.js',
    exportName: 'registerPairDevice',
    contentChecks: [
      // The import that broke it. Asserting the real one is present means the same mistake fails
      // here rather than in production.
      ['site/app/features/pair-device.js', "from '../core/engine.js'"],
    ],
  },
  {
    id: 'dim-sum-surprise',
    label: 'Dim sum surprise',
    file: 'site/app/features/dimsum.js',
    exportName: 'registerDimSum',
    contentChecks: [['site/app/features/dimsum.js', 'Math.random() < 0.1']],
  },
  {
    id: 'narrator',
    label: 'Narrator',
    file: 'site/app/features/narrator.js',
    exportName: 'registerNarrator',
    contentChecks: [
      // The subscription lives in main.js, not the narrator module — the ORIGINAL needle here was
      // satisfied by a COMMENT in narrator.js while the real listener could be deleted unseen.
      //
      // Moving it to the right file was only half the repair, and the half that was missing is the
      // one this repository keeps relearning: as a bare substring it was STILL satisfied by
      // `// window.speechSynthesis.addEventListener('voiceschanged', readVoices)`, so commenting
      // the real subscription out left the site contract fully green. Watched, on this file.
      //
      // Anchored to the start of the line, which a `//` prefix cannot survive. Optional whitespace
      // only, and the receiver is named so the listener cannot be moved onto some other object and
      // still match. Without this, the site silently reverts to the documented empty-voice-list bug
      // — reporting "no voices installed" on a machine with forty.
      ['site/app/main.js', /^\s*window\.speechSynthesis\.addEventListener\('voiceschanged'/m],
      ['site/app/shared/narrator-state.js', 'voiceUri'],
    ],
  },
  {
    id: 'toy-locks',
    label: 'Toy locks',
    file: 'site/app/features/locks.js',
    exportName: 'registerLocks',
    contentChecks: [
      ['site/app/shared/locks-state.js', 'createLock'],
      ['site/app/shared/lockGate.js', 'guardPanel'],
    ],
  },
  {
    id: 'exports-bulk-actions',
    label: 'Exports + bulk actions',
    file: 'site/app/features/exports.js',
    exportName: 'registerExports',
    contentChecks: [
      ['site/app/shared/exportFormats.js', 'EXPORT_FORMATS'],
      ['site/app/shared/bulkList.js', 'createBulkList'],
    ],
  },
  {
    id: 'changelog-viewer',
    label: 'Changelog viewer',
    file: 'site/app/features/changelog.js',
    exportName: 'registerChangelog',
    contentChecks: [['site/content/changelog.json', '"entries"']],
  },
  {
    id: 'docs-index',
    label: 'Per-feature documentation index',
    file: 'site/app/features/docs-index.js',
    exportName: 'registerDocs',
    contentChecks: [['site/docs/index.html', 'Documentation']],
  },
  {
    id: 'authenticator',
    label: 'Built-in TOTP authenticator (Code maker room)',
    file: 'site/app/features/authenticator.js',
    exportName: 'registerAuthenticator',
    contentChecks: [
      ['site/app/shared/crypto.js', 'b32decode'],
      ['site/app/shared/crypto.js', 'export async function totp('],
    ],
  },
  {
    id: 'ollama-shop',
    label: 'Ollama browser with hardware-fit verdicts (Model shop room)',
    file: 'site/app/features/ollama-shop.js',
    exportName: 'registerOllamaShop',
    contentChecks: [['site/app/shared/hardware-fit.js', 'export function fitVerdict(']],
  },
  {
    id: 'converter',
    label: 'Local file/text converter with honest unsupported cases (Turn-it-into lab)',
    file: 'site/app/features/converter.js',
    exportName: 'registerConverter',
    contentChecks: [
      ['site/app/shared/convert.js', 'export function parseRecords('],
      ['site/app/shared/data.js', 'loss:'],
    ],
  },
  {
    id: 'coverage-checklist',
    label: 'The big checklist (hand-written coverage table)',
    file: 'site/app/features/coverage.js',
    exportName: 'registerCoverage',
    contentChecks: [['site/app/shared/data.js', 'export const COVERAGE']],
  },
  {
    id: 'playroom',
    label: 'Three working games that keep score (Playroom)',
    file: 'site/app/features/playroom.js',
    exportName: 'registerPlayroom',
    contentChecks: [['site/app/shared/games.js', 'export function dealMemory(']],
  },
  {
    id: 'timers',
    label: 'Scheduled settings (Timers)',
    file: 'site/app/features/timers.js',
    exportName: 'registerTimers',
    contentChecks: [],
  },
  {
    id: 'download-demo',
    label: 'Download-capture demonstration (partial by design — documented)',
    file: 'site/app/features/download-demo.js',
    exportName: 'registerDownloadDemo',
    contentChecks: [['site/app/features/download-demo.js', 'cannot hand a transfer to an installed']],
  },
]

const SITE_RENDER_COPY_FUNNELS = [
  ['hall', 'site/app/core/render.js', 'function renderHall'],
  ['room', 'site/app/core/render.js', 'function renderRoom'],
  ['list-room', 'site/app/core/render.js', 'function renderListRoom'],
  ['row-item', 'site/app/core/render.js', 'function rowItem'],
  ['menu', 'site/app/core/render.js', 'function renderMenu'],
  ['regex-dialog', 'site/app/core/render.js', 'function renderRx'],
  ['command-palette', 'site/app/core/render.js', 'function renderPalette'],
  ['settings-card', 'site/app/core/render.js', 'function settingsCardHtml'],
  ['home-room', 'site/app/core/render.js', 'function renderHomeRoom'],
  ['door-tile', 'site/app/core/render.js', 'function doorTile'],
  ['feature-card', 'site/app/core/render.js', 'function featureCard']
]
const CANONICAL_SITE_RENDER_FUNNEL_IDS = `hall room list-room row-item menu regex-dialog command-palette settings-card home-room door-tile feature-card`.split(/\s+/)
const SITE_RENDER_STRING_OWNERSHIP = [
  ['hall-top-bar', 'the top bar', 'authored', 'function renderHall'],
  ['hall-menu-button', 'this button', 'authored', 'function renderHall'],
  ['hall-day-night', 'Day or night', 'authored', 'function renderHall'],
  ['hall-message-box', 'Message box', 'authored', 'function renderHall'],
  ['hall-hello', 'Hello,', 'authored', 'function renderHall'],
  ['hall-pick-door', 'Pick a door.', 'authored', 'function renderHall'],
  ['hall-empty-prefix', 'No door has that name. Try the', 'authored', 'function renderHall'],
  ['hall-empty-suffix', 'button next to the filter!', 'authored', 'function renderHall'],
  ['hall-peek-code', 'Peek at the code', 'authored', 'function renderHall'],
  ['room-top-bar', 'the top bar', 'authored', 'function renderRoom'],
  ['room-rail', 'the room list', 'authored', 'function renderRoom'],
  ['room-day-night', 'Switch between day and night', 'authored', 'function renderRoom'],
  ['room-message-box', 'Open the message box', 'authored', 'function renderRoom'],
  ['room-nav-items', 'items', 'authored', 'function renderRoom'],
  ['list-from-date', 'From date', 'authored', 'function renderListRoom'],
  ['list-and', 'and', 'authored', 'function renderListRoom'],
  ['list-to-date', 'To date', 'authored', 'function renderListRoom'],
  ['settings-lock-copy', 'This box has its own password.', 'authored', 'function settingsCardHtml'],
  ['settings-unlock', 'Unlock password', 'authored', 'function settingsCardHtml'],
  ['settings-open', 'Open', 'authored', 'function settingsCardHtml'],
  ['regex-groups', 'Things it caught', 'authored', 'function renderRx'],
  ['regex-builder-label', 'Regex builder', 'authored', 'function renderRx'],
  ['regex-pattern', 'Pattern', 'authored', 'function renderRx'],
  ['regex-flags', 'Flags', 'authored', 'function renderRx'],
  ['regex-sample', 'Sample text', 'authored', 'function renderRx'],
  ['palette-label', 'Magic jump box', 'authored', 'function renderPalette'],
  ['palette-placeholder', 'Where do you want to go?', 'authored', 'function renderPalette'],
  ['palette-search', 'Magic jump box search', 'authored', 'function renderPalette'],
  ['palette-regex', 'Regex builder for the jump box', 'authored', 'function renderPalette'],
  ['confirm-question', 'Are you sure?', 'authored', 'function renderConfirm'],
  ['confirm-type', 'Type', 'authored', 'function renderConfirm'],
  ['confirm-unlock', 'to unlock the button', 'authored', 'function renderConfirm'],
  ['confirm-word-label', 'Confirmation word', 'authored', 'function renderConfirm'],
  ['confirm-keep', 'Keep it', 'authored', 'function renderConfirm'],
  ['confirm-yes', 'Yes, do it', 'authored', 'function renderConfirm'],
  ['confirm-first', '” first', 'authored', 'function renderConfirm'],
  ['toast-close', 'Close this message', 'authored', 'function renderToasts'],
  ['hall-brand', 'nodeterm school', 'fact', 'function renderHall'],
  ['hall-jump-command', 'Jump', 'fact', 'function renderHall'],
  ['hall-download-command', 'Get nodeterm', 'fact', 'function renderHall'],
  ['hall-download-command-2', 'Download nodeterm', 'fact', 'function renderHall'],
  ['hall-brew-command', 'brew install --cask nodeterm', 'fact', 'function renderHall'],
  ['room-brand', 'nodeterm', 'fact', 'function renderRoom'],
  ['room-version', 'v0.3.0', 'fact', 'function renderRoom'],
  ['room-license', 'BUSL-1.1 licensed · fork of', 'fact', 'function renderRoom'],
  ['room-upstream-brand', 'eneskirca/nodeterm', 'fact', 'function renderRoom'],
  ['room-forge-brand', 'GitHub', 'fact', 'function renderRoom'],
  ['room-legal-notice', '“Claude” and “Claude Code” are trademarks of Anthropic. nodeterm is not affiliated with or endorsed by Anthropic.', 'fact', 'function renderRoom'],
  ['hall-jump-tooltip', 'Magic jump box — Ctrl+Shift+F', 'fact', 'function renderHall'],
  ['room-jump-tooltip', 'Magic jump box — Ctrl+Shift+F', 'fact', 'function renderRoom'],
]
const CANONICAL_SITE_RENDER_STRING_IDS = SITE_RENDER_STRING_OWNERSHIP.map(([id]) => id)

for (const feature of FEATURES) {
  const fileOk = requireFileExists(feature.file, feature.label)
  if (fileOk) requireExportedFunction(feature.file, feature.exportName, feature.label)
  for (const [file, needle] of feature.contentChecks || []) {
    requireFileContains(file, needle, feature.label)
  }
  // Presence in the entry point, not just existence of the module. A
  // single substring match is not enough here: the import line alone
  // ("import { registerSchoolMode } from './school-mode.js'") contains
  // the exact name too, so a feature removed from the FEATURE_REGISTRARS
  // array but left imported would still pass a bare `.includes()` check —
  // exactly the "renamed/removed symbol still matches" trap. Requiring at
  // least TWO occurrences of the exact identifier (import + actual use in
  // the array) is what catches that.
  checkedCount += 1
  const occurrences = (indexText.match(new RegExp(`\\b${feature.exportName}\\b`, 'g')) || []).length
  if (occurrences < 2) {
    fail(
      `${feature.label}: ${feature.exportName} appears only ${occurrences} time(s) in ${INDEX_FILE} — expected an import AND a use in FEATURE_REGISTRARS (a feature imported but never registered is not shipped)`,
    )
  } else {
    pass(`${feature.label}: registered from ${INDEX_FILE} (${occurrences} occurrences)`)
  }
}

// ---------------------------------------------------------------------
// 2. Documentation articles — one row per required topic. Presence of the
//    FILE is asserted directly; a missing article fails even though the
//    rest of the site works.
// ---------------------------------------------------------------------
const REQUIRED_DOC_SLUGS = [
  'terminal-sessions',
  'windows-support',
  'projects-and-tabs',
  'node-kinds',
  'agent-support',
  'canvas-lifecycle',
  'source-control-worktrees',
  'kanban-board',
  'remote-ssh-projects',
  'server-edition',
  'speech-dictation',
  'packaging-updates',
  'language-modes',
  'school-mode',
  'personal-vocabulary',
  'dim-sum-surprise',
  'narrator',
  'toy-locks',
  'exports-and-history',
  'changelog-viewer',
]
for (const slug of REQUIRED_DOC_SLUGS) {
  const rel = `site/docs/${slug}.html`
  const ok = requireFileExists(rel, 'Documentation article')
  if (ok) {
    requireFileContains(rel, 'doc-suggested', 'Documentation article has suggested articles')
  }
}
requireFileExists('site/docs/index.html', 'Documentation index page')

// Windows profiles and the session host share the two existing Windows/terminal articles rather
// than adding a third near-duplicate page. Pin the facts that the retired plain-shell copy
// contradicted: stock Windows uses the standalone host, reboot is cold restore rather than a live
// process, and installed-artifact evidence is still pending. Positive checks alone would let
// somebody paste the stale paragraph back underneath the correct one, so prohibit the old claims
// explicitly too.
requireFileContains(
  'site/docs/windows-support.html',
  "nodeterm's standalone session host owns each live PTY",
  'Windows profiles documentation: standalone session host',
)
requireFileContains(
  'site/docs/windows-support.html',
  'PowerShell 7, Windows PowerShell, Command Prompt, Git Bash, each installed WSL distribution, and an advanced custom executable',
  'Windows profiles documentation: complete detected profile catalog',
)
requireFileContains(
  'site/docs/windows-support.html',
  'Packaged Windows interaction and capture evidence',
  'Windows profiles documentation: packaged verification stays explicit',
)
requireFileOmits(
  'site/docs/windows-support.html',
  'fall back to a plain shell with no cross-restart continuity',
  'Windows profiles documentation: retired plain-shell fallback claim',
)
requireFileContains(
  'site/docs/terminal-sessions.html',
  'Neither keeps that process alive through a machine reboot.',
  'Terminal continuity documentation: reboot boundary',
)
requireFileContains(
  'site/docs/terminal-sessions.html',
  "stock Windows uses nodeterm's standalone session host",
  'Terminal continuity documentation: Windows backend',
)
requireFileOmits(
  'site/docs/terminal-sessions.html',
  'survives an app restart and even a full machine reboot',
  'Terminal continuity documentation: retired live-process reboot claim',
)

// ---------------------------------------------------------------------
// 3. Dim-sum illustration assets — original SVGs, not third-party images.
// ---------------------------------------------------------------------
const REQUIRED_DISH_SVGS = ['har-gow', 'siu-mai', 'char-siu-bao', 'egg-tart', 'cheung-fun', 'turnip-cake']
for (const dish of REQUIRED_DISH_SVGS) {
  requireFileExists(`site/app/features/assets/dimsum/${dish}.svg`, 'Dim sum illustration')
}

// ---------------------------------------------------------------------
// 4. Generated content.
// ---------------------------------------------------------------------
requireFileExists('site/content/changelog.json', 'Generated changelog content')
{
  const text = readText('site/content/changelog.json')
  checkedCount += 1
  if (text) {
    try {
      const json = JSON.parse(text)
      if (!Array.isArray(json.entries) || json.entries.length === 0) {
        fail('site/content/changelog.json: "entries" must be a non-empty array')
      } else {
        pass(`site/content/changelog.json: ${json.entries.length} changelog entries present`)
      }
    } catch (err) {
      fail(`site/content/changelog.json: invalid JSON (${err.message})`)
    }
  }
}

// ---------------------------------------------------------------------
// 5. Root-absolute internal URL scan across the whole site/ tree — a
//    positive check ("no forbidden pattern found"), scoped to files this
//    guard can read as text. Skips protocol-relative ("//") and full
//    http(s):// URLs, which are not root-absolute in the sense that
//    breaks a subpath deployment.
// ---------------------------------------------------------------------
const ROOT_ABSOLUTE_PATTERN = /(href|src)\s*=\s*["']\/(?!\/)|url\(\s*\/(?!\/)/gi

let rootAbsoluteHits = []
for (const file of ALL_SITE_FILES) {
  const text = readFileSync(file, 'utf8')
  const matches = text.match(ROOT_ABSOLUTE_PATTERN)
  if (matches) {
    const rel = relative(REPO_ROOT, file)
    for (const m of matches) rootAbsoluteHits.push(`${rel}: ${m}`)
  }
}
checkedCount += 1
if (rootAbsoluteHits.length > 0) {
  fail(`Found ${rootAbsoluteHits.length} root-absolute internal URL(s) under site/ (breaks a subpath Pages deployment):`)
  for (const hit of rootAbsoluteHits) console.error(`    - ${hit}`)
} else {
  pass(`No root-absolute internal URLs found across ${ALL_SITE_FILES.length} scanned files under site/`)
}

// ---------------------------------------------------------------------
// 6. No third-party CDN requests — the redesign's imported source links
//    fonts.googleapis.com / fonts.gstatic.com for "Baloo 2" and "Nunito".
//    This project forbids CDN assets and any request that leaves the
//    origin, so the shipped site drops to the design's own declared
//    fallback font stack instead (see site/styles.css's top comment for
//    the full reasoning). Guard against that regressing, and against any
//    other common CDN host creeping back in.
// ---------------------------------------------------------------------
const FORBIDDEN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'google-analytics.com', 'googletagmanager.com']
let cdnHits = []
for (const file of ALL_SITE_FILES) {
  const text = readFileSync(file, 'utf8')
  for (const host of FORBIDDEN_HOSTS) {
    if (text.includes(host)) cdnHits.push(`${relative(REPO_ROOT, file)}: ${host}`)
  }
}
checkedCount += 1
if (cdnHits.length > 0) {
  fail(`Found ${cdnHits.length} third-party CDN/tracking reference(s) under site/ (this project bundles everything locally):`)
  for (const hit of cdnHits) console.error(`    - ${hit}`)
} else {
  pass(`No third-party CDN or tracking hosts referenced across ${ALL_SITE_FILES.length} scanned files under site/`)
}

// ---------------------------------------------------------------------
// 7. Upstream-repository link scan — the imported design points at
//    github.com/eneskirca/nodeterm (the upstream project this repo is a
//    fork of). Every repository link in the shipped site must point at
//    THIS fork instead, with exactly one deliberate exception: a single
//    "forked from" attribution line in the room footer. Anything beyond
//    that exact count is a leftover upstream link that needs repointing.
// ---------------------------------------------------------------------
{
  // site/app/shared/data.js is where UPSTREAM_URL is DEFINED (one
  // legitimate occurrence of the substring, by design — see that file's
  // top comment) and is excluded from this scan for exactly that reason.
  // Every OTHER file may contain the substring at most once, and that one
  // occurrence must be app/core/render.js's single "forked from"
  // attribution link in the room footer.
  const ATTRIBUTION_ALLOWANCE = 1
  let upstreamHits = 0
  const perFile = []
  for (const file of ALL_SITE_FILES) {
    const rel = relative(REPO_ROOT, file)
    if (rel.endsWith('shared/data.js') || rel.endsWith('shared\\data.js')) continue // UPSTREAM_URL's own definition
    if (rel.endsWith('changelog.json')) continue // real project history may name eneskirca's Homebrew tap as a historical fact, not a link
    const text = readFileSync(file, 'utf8')
    const matches = text.match(/eneskirca\/nodeterm/g)
    if (matches) {
      upstreamHits += matches.length
      perFile.push(`${rel}: ${matches.length}`)
    }
  }
  checkedCount += 1
  if (upstreamHits > ATTRIBUTION_ALLOWANCE) {
    fail(`Found ${upstreamHits} reference(s) to the upstream repo (eneskirca/nodeterm) outside its one definition in shared/data.js — expected at most ${ATTRIBUTION_ALLOWANCE} (the single "forked from" attribution link):`)
    for (const hit of perFile) console.error(`    - ${hit}`)
  } else {
    pass(`Upstream-repository references bounded to the single attribution link (${upstreamHits} found outside shared/data.js, ${ATTRIBUTION_ALLOWANCE} allowed)`)
  }
}

// ---------------------------------------------------------------------
// 8. No leftover design-tool scaffolding — the imported design.html is a
//    proprietary <x-dc>/{{expr}}/support.js preview-harness template, not
//    something this site ships. Fail if any of it survived into site/.
// ---------------------------------------------------------------------
{
  const FORBIDDEN_TOKENS = ['<x-dc', 'data-dc-script', 'support.js', 'window.React', 'ReactDOM', 'hint-placeholder']
  let scaffoldHits = []
  for (const file of ALL_SITE_FILES) {
    const text = readFileSync(file, 'utf8')
    for (const token of FORBIDDEN_TOKENS) {
      if (text.includes(token)) scaffoldHits.push(`${relative(REPO_ROOT, file)}: ${token}`)
    }
  }
  checkedCount += 1
  if (scaffoldHits.length > 0) {
    fail(`Found ${scaffoldHits.length} leftover design-tool artefact(s) under site/ (the design's own React preview harness must never ship):`)
    for (const hit of scaffoldHits) console.error(`    - ${hit}`)
  } else {
    pass('No leftover design-tool scaffolding (<x-dc>, {{ }} bindings, support.js, React) found under site/')
  }
  // A bare "{{" is also checked, separately, because it is common enough
  // in unrelated JSON/JS (template literals, object destructuring) that
  // bundling it with the exact-token list above would produce false
  // failures on innocent code. This regex specifically looks for the
  // design template's own double-mustache binding shape.
  checkedCount += 1
  let mustacheHits = []
  for (const file of ALL_SITE_FILES) {
    const text = readFileSync(file, 'utf8')
    if (/\{\{[a-zA-Z][\w.]*\}\}/.test(text)) mustacheHits.push(relative(REPO_ROOT, file))
  }
  if (mustacheHits.length > 0) {
    fail(`Found ${mustacheHits.length} file(s) with a leftover {{binding}} template expression:`)
    for (const hit of mustacheHits) console.error(`    - ${hit}`)
  } else {
    pass('No leftover {{binding}} template expressions found under site/')
  }
}

// ---------------------------------------------------------------------
// The shared-link embed graphic (Discord/Slack/iMessage unfurl).
// ---------------------------------------------------------------------
//
// A link is how this project introduces itself, and most people meet it for the first time in a
// chat window. Without these tags the embed is a grey card with some text on it.
//
// Each assertion below is a way the embed breaks WITHOUT anything looking wrong in the source:
// a relative og:image (the crawler cannot resolve it), a missing twitter:card (a big picture
// silently becomes a thumbnail), or an image path that no longer exists in the published tree
// (the Pages workflow ships `site/` only, so a card left in docs/ is a tag pointing at a 404).
{
  const html = readText('site/index.html') ?? ''
  const tag = (prop) => {
    // Attribute order and whitespace both vary once a formatter has been through the file, so
    // match the property and then look for the content anywhere in the same tag.
    const re = new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*>`, 'i')
    const m = re.exec(html)
    if (!m) return null
    const c = /content=["']([^"']*)["']/i.exec(m[0])
    return c ? c[1] : null
  }

  const required = [
    'og:title',
    'og:description',
    'og:type',
    'og:url',
    'og:site_name',
    'og:image',
    'og:image:width',
    'og:image:height',
    'og:image:alt',
    'twitter:card',
    'twitter:image'
  ]
  for (const p of required) {
    checkedCount += 1
    const v = tag(p)
    if (!v) fail(`Shared-link embed: site/index.html is missing a <meta> for ${p}`)
    else pass(`Shared-link embed: ${p} present`)
  }

  // og:image must be absolute https — the failure that looks fine in the source and shows no
  // picture in the embed.
  checkedCount += 1
  const img = tag('og:image')
  if (img && /^https:\/\//.test(img)) pass('Shared-link embed: og:image is an absolute https URL')
  else fail(`Shared-link embed: og:image must be an absolute https:// URL, got "${img ?? '(none)'}" — a relative path renders no picture`)

  // summary_large_image is the difference between a big card and a stamp.
  checkedCount += 1
  const tc = tag('twitter:card')
  if (tc === 'summary_large_image') pass('Shared-link embed: twitter:card is summary_large_image (big card, not a thumbnail)')
  else fail(`Shared-link embed: twitter:card must be "summary_large_image", got "${tc ?? '(none)'}"`)

  // The referenced image has to exist in the tree the Pages workflow actually publishes.
  checkedCount += 1
  const marker = '/material-nodeterm/'
  const idx = img ? img.indexOf(marker) : -1
  const rel = idx >= 0 ? img.slice(idx + marker.length) : null
  if (rel && existsSync(join(REPO_ROOT, 'site', rel))) {
    pass(`Shared-link embed: og:image resolves to a real published file (site/${rel})`)
  } else {
    fail(`Shared-link embed: og:image points at "${img}", which is not a file under site/ — the Pages workflow publishes site/ only, so this would 404`)
  }

  // The masters live in the REPOSITORY ROOT. GitHub's social-preview upload cannot be scripted,
  // so the last step is always a person opening a folder and dragging an image in — and a path
  // four directories deep turns that into a hunt, which is a step that quietly does not happen.
  requireFileExists('social-preview.png', 'Shared-link embed')
  requireFileExists('social-card.png', 'Shared-link embed')
  requireFileExists('scripts/make-social-card.mjs', 'Shared-link embed')

  // The served copy exists only because Pages publishes `site/` alone, and two copies of a
  // picture are two pictures that will disagree eventually. One generator writes both from the
  // same buffer; this is the check that keeps that true.
  checkedCount += 1
  const master = join(REPO_ROOT, 'social-card.png')
  const served = join(REPO_ROOT, 'site/assets/social-card.png')
  if (existsSync(master) && existsSync(served)) {
    const a = readFileSync(master)
    const b = readFileSync(served)
    if (a.equals(b)) {
      pass('Shared-link embed: the served og:image is byte-identical to the root master')
    } else {
      fail(
        'Shared-link embed: site/assets/social-card.png has drifted from the root social-card.png — ' +
          're-run `npm run make-social-card`, which writes both from one buffer'
      )
    }
  } else {
    fail('Shared-link embed: expected both social-card.png (root master) and site/assets/social-card.png (served copy)')
  }
}

// ---------------------------------------------------------------------
// Every relative import resolves to a file that exists.
// ---------------------------------------------------------------------
//
// This site is plain ES modules loaded straight from disk by the browser — there is no bundler
// to fail, so an import of a file that does not exist is a 404 at RUNTIME. And because the whole
// feature graph hangs off one `main.js`, a single missing module takes the ENTIRE page down: the
// server still answers 200 for index.html, every asset still resolves, the deploy still goes
// green, and the visitor gets a blank page.
//
// That is not hypothetical. `app/features/pair-device.js` shipped importing a
// `../core/registry.js` that was never written, and the site rendered nothing at all until it was
// found by attaching a debugger to a real browser. Nothing else caught it:
//   - `node --check` passes, because the file's SYNTAX is perfect. It never resolves an import.
//   - the contract checks below pass, because they assert files and strings are present, not that
//     the app boots.
//   - curl passes, because index.html and every real asset are served fine.
// The only cheap signal was the one missing here, so it is here now.
{
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(rel, out)
      } else if (entry.name.endsWith('.js')) {
        out.push(rel)
      }
    }
    return out
  }
  // `import x from './y.js'`, `export * from '../z.js'`, and dynamic `import('./w.js')` alike.
  const SPEC_RE = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g
  let importCount = 0
  const missing = []
  for (const file of walk('site')) {
    const text = readText(file) ?? ''
    const dir = file.slice(0, file.lastIndexOf('/'))
    for (const m of text.matchAll(SPEC_RE)) {
      importCount += 1
      // Resolved the way the BROWSER resolves it — relative to the importing file, no extension
      // guessing and no index.js fallback, because the browser does neither.
      const target = join(REPO_ROOT, dir, m[1])
      if (!existsSync(target)) missing.push(`${file} imports ${m[1]} — no such file`)
    }
  }
  checkedCount += 1
  if (missing.length) {
    for (const m of missing) fail(`Broken module import (the page will be blank): ${m}`)
  } else {
    pass(`Module graph: all ${importCount} relative imports across site/ resolve to real files`)
  }
}

// ---------------------------------------------------------------------
// The inventory's OWN completeness
// ---------------------------------------------------------------------
//
// Everything above checks that each listed feature is present. Nothing checked that the LIST was
// complete, and the sibling guard (check-app-contract.mjs) was found with FIVE shipped features
// missing from its list, passing cleanly the whole time. A list that only validates what it
// already knows about cannot notice what nobody added to it.
//
// This found two here, and one of them matters: `pair-device.js` had no row — and it is the exact
// file whose unresolvable import blanked the ENTIRE site earlier, undetected by this guard, by
// `node --check` (syntax is not resolution), and by a 200 response from the server. The one
// feature nobody was watching is the one that took the site down.
//
// The check reads the ROWS, not this file's source text. Scanning the source would let a module
// count as covered because its name appears in a comment — which is precisely what hid these two,
// since the header above mentions `site/app/features/index.js`. Worse, every NON_FEATURE_MODULES
// key is written in this file too, so the exemption map would have been redundant with the check
// it is meant to qualify: a guard whose two halves cannot disagree only looks like it has two.
const NON_FEATURE_MODULES = new Map([
  ['index.js', 'the registrar barrel (FEATURE_REGISTRARS) — it wires features rather than being one'],
])

function renderFunnelBody(source, marker) {
  if (!source) return null
  const start = source.indexOf(marker)
  if (start < 0) return null
  const next = source.indexOf('\nfunction ', start + marker.length)
  return source.slice(start, next < 0 ? source.length : next)
}

function hasAuthoredCopyFunnel(body) {
  return !!body && (body.includes('copy(') || body.includes('copyAttr('))
}

function hasOwnedRenderString(body, text, owner) {
  if (!body) return false
  const lines = body.split(/\r?\n/).filter((line) => line.includes(text))
  if (!lines.length) return false
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const copiedExactly = new RegExp(`copy(?:Attr)?\\(s,\\s*['"]${escaped}['"]\\)`).test(body)
  if (owner === 'fact') return !copiedExactly
  return lines.some((line) => /copy(?:Attr)?\(/.test(line))
}

{
  const ids = SITE_RENDER_COPY_FUNNELS.map(([id]) => id)
  checkedCount += 1
  if (ids.length !== CANONICAL_SITE_RENDER_FUNNEL_IDS.length || ids.some((id, i) => id !== CANONICAL_SITE_RENDER_FUNNEL_IDS[i])) {
    fail('Site renderer funnel inventory does not match its independent canonical list')
  } else {
    pass('Site renderer funnel inventory matches its independent canonical list')
  }
  for (const [id, file, marker] of SITE_RENDER_COPY_FUNNELS) {
    const body = renderFunnelBody(readText(file), marker)
    checkedCount += 1
    if (!hasAuthoredCopyFunnel(body)) fail(`${id}: authored-copy funnel is missing`)
    else pass(`${id}: authored-copy funnel is present`)

    const mutatedBody = renderFunnelBody(body.split('copy(').join('').split('copyAttr(').join(''), marker)
    checkedCount += 1
    if (hasAuthoredCopyFunnel(mutatedBody)) fail(`${id}: authored-copy funnel mutation was not rejected`)
    else pass(`${id}: authored-copy funnel mutation is rejected`)
  }
  const renderSource = readText('site/app/core/render.js') || ''
  const copyStart = renderSource.indexOf('function copy(')
  const copyEnd = renderSource.indexOf('function copyAttr(', copyStart)
  const copyHelper = copyStart >= 0 && copyEnd > copyStart ? renderSource.slice(copyStart, copyEnd) : ''
  checkedCount += 1
  if (!copyHelper.includes('shapeCopy(')) fail('shared site copy helper does not call shapeCopy')
  else pass('shared site copy helper calls shapeCopy')
  const mutated = renderSource.split('copy(').join('').split('copyAttr(').join('')
  checkedCount += 1
  const body = renderFunnelBody(mutated, 'function renderHall')
  if (hasAuthoredCopyFunnel(body)) fail('Site renderer funnel mutation was not rejected')
  else pass('Site renderer funnel mutation is rejected')
}

{
  checkedCount += 1
  if (new Set(CANONICAL_SITE_RENDER_STRING_IDS).size !== CANONICAL_SITE_RENDER_STRING_IDS.length) {
    fail('Site renderer string ownership inventory contains duplicate identifiers')
  } else {
    pass('Site renderer string ownership inventory has unique identifiers')
  }
  for (const [id, text, owner, marker] of SITE_RENDER_STRING_OWNERSHIP) {
    const body = renderFunnelBody(readText('site/app/core/render.js'), marker)
    checkedCount += 1
    if (hasOwnedRenderString(body, text, owner)) pass(`${id}: ${owner} ownership is explicit`)
    else fail(`${id}: ${owner} ownership is missing or ambiguous`)

    const mutatedBody = body ? body.split(text).join('') : null
    checkedCount += 1
    if (hasOwnedRenderString(mutatedBody, text, owner)) fail(`${id}: string-removal mutation was not rejected`)
    else pass(`${id}: string-removal mutation is rejected`)
  }

  const mutationRoot = mkdtempSync(join(tmpdir(), 'nodeterm-site-render-audit-'))
  const renderCopy = join(mutationRoot, 'render.js')
  try {
    copyFileSync(join(REPO_ROOT, 'site/app/core/render.js'), renderCopy)
    const original = readFileSync(renderCopy, 'utf8')
    for (const [id, text, owner, marker] of SITE_RENDER_STRING_OWNERSHIP) {
      writeFileSync(renderCopy, original.split(text).join(''), 'utf8')
      const copiedSource = readFileSync(renderCopy, 'utf8')
      const copiedBody = renderFunnelBody(copiedSource, marker)
      checkedCount += 1
      if (hasOwnedRenderString(copiedBody, text, owner)) fail(`${id}: file-backed string mutation was not rejected`)
      else pass(`${id}: file-backed string mutation is rejected`)
      writeFileSync(renderCopy, original, 'utf8')
    }
  } finally {
    rmSync(mutationRoot, { recursive: true, force: true })
  }
}

{
  const FEATURES_DIR = join(SITE_DIR, 'app', 'features')
  let modules = []
  try {
    // Runtime tests sit beside the unbundled JS they exercise. They are not registrar modules and
    // never enter FEATURE_REGISTRARS, so counting them here makes adding behavioral coverage look
    // like an unregistered product feature. Keep the production inventory strict and explicit.
    modules = readdirSync(FEATURES_DIR).filter(
      (f) => f.endsWith('.js') && !f.endsWith('.test.js'),
    )
  } catch {
    fail('Inventory completeness: cannot read site/app/features — the scan below would pass vacuously')
  }
  checkedCount += 1
  if (modules.length < 10) {
    // A scan that finds almost nothing reports clean — the same silent failure this guard exists
    // to prevent, one level up.
    fail(`Inventory completeness: only ${modules.length} feature modules found — that is not the features directory`)
  } else {
    const rowFiles = new Set(
      FEATURES.flatMap((f) => [f.file, ...(f.contentChecks ?? []).map(([p]) => p)])
        .filter(Boolean)
        .map((p) => p.split('/').pop()),
    )
    const orphans = modules.filter((m) => !rowFiles.has(m) && !NON_FEATURE_MODULES.has(m))
    if (orphans.length) {
      fail(
        `Inventory completeness: ${orphans.length} feature module(s) have no row and no stated ` +
          `reason — ${orphans.join(', ')}. Add a FEATURES row, or add it to NON_FEATURE_MODULES ` +
          `with why it is not a contract.`,
      )
    } else {
      pass(`Inventory completeness: all ${modules.length} feature modules are covered by a row`)
    }
    // A stale exemption is its own drift — it stops anyone noticing the module was deleted.
    checkedCount += 1
    const gone = [...NON_FEATURE_MODULES.keys()].filter((m) => !modules.includes(m))
    if (gone.length) {
      fail(`Inventory completeness: NON_FEATURE_MODULES names ${gone.join(', ')}, which no longer exist`)
    } else {
      pass('Inventory completeness: no stale entries in NON_FEATURE_MODULES')
    }
  }
}

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------
console.log('')
console.log(`Checked ${checkedCount} contract assertions.`)
if (failures > 0) {
  console.error(`\n${failures} FAILURE(S). This is a local tool, not a CI gate — fix these before considering the site change complete.`)
  process.exit(1)
} else {
  console.log('\nAll contract features present. ✓')
  process.exit(0)
}
