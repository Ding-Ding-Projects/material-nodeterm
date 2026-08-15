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
    contentChecks: [['site/app/features/dimsum.js', 'Math.random() < 0.1']],
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
