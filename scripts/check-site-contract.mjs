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

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

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

function requireExportedFunction(relPath, fnName, label) {
  return requireFileContains(relPath, new RegExp(`export\\s+(async\\s+)?function\\s+${fnName}\\b`), label || `exports ${fnName}`)
}

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
    label: 'Personal-vocabulary JSON upload',
    file: 'site/app/features/vocabulary.js',
    exportName: 'registerVocabulary',
    contentChecks: [
      ['site/app/shared/vocabulary-state.js', 'validateVocabularyText'],
      ['site/app/shared/vocabulary-state.js', 'MAX_ENTRIES'],
      ['site/app/shared/vocabulary-state.js', '__proto__'],
      ['site/app/shared/i18n.js', 'applyReplacements'],
    ],
  },
  {
    id: 'dim-sum-surprise',
    label: 'Dim sum surprise',
    file: 'site/app/features/dimsum.js',
    exportName: 'registerDimSum',
    contentChecks: [['site/app/features/dimsum.js', 'Math.random() >= 0.1']],
  },
  {
    id: 'narrator',
    label: 'Narrator',
    file: 'site/app/features/narrator.js',
    exportName: 'registerNarrator',
    contentChecks: [
      ['site/app/features/narrator.js', 'voiceschanged'],
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
]

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
function listSiteFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listSiteFiles(full))
    else if (/\.(html|js|css)$/i.test(entry.name)) out.push(full)
  }
  return out
}

const ROOT_ABSOLUTE_PATTERN = /(href|src)\s*=\s*["']\/(?!\/)|url\(\s*\/(?!\/)/gi

let scannedFiles = 0
let rootAbsoluteHits = []
for (const file of listSiteFiles(SITE_DIR)) {
  scannedFiles += 1
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
  pass(`No root-absolute internal URLs found across ${scannedFiles} scanned files under site/`)
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
