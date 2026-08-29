// The hand-written feature inventory must stay complete, and every claim in it must be real.
//
// docs/uh-feature-inventory.md names every canonical user-facing contract with its implementation,
// documentation and focused test. A row pointing at a file that does not exist reports coverage
// that is not there — worse than no row. And a guard that only validates the rows already present
// passes happily on a file with no rows at all, so the load-bearing half of this check is the
// REQUIRED_FEATURES list embedded below: it is what makes a silently deleted row detectable.
// Adding a canonical feature means adding it to BOTH the inventory and that list, in one change.
//
//     node scripts/check-uh-inventory.mjs
//
// Wired beside `check-site-shots.mjs` and the other contract guards rather than the build, because
// a stale inventory is a bookkeeping defect, not a compile error.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const INVENTORY = join(ROOT, 'docs/uh-feature-inventory.md')

// Every canonical feature the inventory must carry a row for — in ANY of its three tables, but it
// must be there. Matched by EXACT feature-cell text (trimmed), not by substring: a substring
// needle survives a rename ("School mode" still matches inside "School modeRENAMED"), and this
// repo has shipped exactly that kind of toothless guard before. An exact match goes red on any
// rename, which is the correct direction — a renamed row is a row someone must re-verify anyway.
const REQUIRED_FEATURES = [
  'Language modes (English / Cantonese / bilingual)',
  'Both funny-level sliders, independent per language',
  'Emoji-in-dialogs switch',
  'School mode',
  'Kids mode',
  'Narrator, with a voice picker per language',
  'Scheduled settings, incl. external sources',
  'Dim sum surprise',
  'Regex builder, anchored beside every search',
  'ADHD modes',
  'Non-blocking notifications + centre',
  'Destructive-action super confirmation',
  'Material Design 3 across every surface',
  'MD3 primitive set',
  'Per-element appearance editor',
  'Infinite colour picker + translator',
  'App rename (display name only)',
  'App-logo customization + safe conversion',
  'Universal file converter',
  'Local Ollama suite manager',
  'VeraCrypt mount management',
  'Agent continuation recovery',
  'Tabbed navigation',
  'Toy locks on every element',
  'Unlock ladder',
  'Built-in authenticator + QR pairing',
  'Changelog viewer',
  'Command palette',
  'Local version history',
  'Personal-vocabulary JSON upload',
  'Export everything, in every format',
  'Bulk actions on every list',
  'External-editor handoff',
  'Landing page and documentation site',
  'Shared-link embed graphic',
  'One-click build scripts',
  'One-click dependency fetcher',
  'Vocabulary hash lock',
  'Line count in every release',
  'Dim-sum release code names',
  'Design-reference parity app',
  'Sanitized instruction mirror',
  'Status Hub',
  'In-app documentation browser',
  'Browser-extension download capture dialogs (Start / Downloading / completion)',
  'Purchase / licence / paid-tier flows'
]

const problems = []
// Printed on every run, pass or fail: a manual: predicate is only as good as somebody reading it.
const predicateReport = []

if (!existsSync(INVENTORY)) {
  console.error('✗ docs/uh-feature-inventory.md does not exist — the inventory itself is gone')
  process.exit(1)
}

// The repo is CRLF; split on either ending or every "line" keeps a trailing \r and nothing
// downstream matches (the exact trap CLAUDE.md warns about).
const lines = readFileSync(INVENTORY, 'utf8').split(/\r?\n/)

// ---- parse the three markdown tables, keyed by their section headings -------------------------

const SECTIONS = {
  shipped: '## Shipped',
  notApplicable: '## Not applicable, with the reason',
  open: '## Open'
}

function isSeparatorRow(cells) {
  // | --- | --- | ... — every cell is dashes (optionally colon-aligned).
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()))
}

function parseSection(heading) {
  const start = lines.findIndex((l) => l.trim() === heading)
  if (start === -1) return null
  const rows = []
  let sawHeader = false
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('## ') || line.startsWith('# ')) break
    if (!line.startsWith('|')) continue
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (isSeparatorRow(cells)) continue
    if (!sawHeader) {
      sawHeader = true // the first pipe row is the column header, not data
      continue
    }
    rows.push({ cells, lineNo: i + 1 })
  }
  return rows
}

const shipped = parseSection(SECTIONS.shipped)
const notApplicable = parseSection(SECTIONS.notApplicable)
const open = parseSection(SECTIONS.open)

if (shipped === null) problems.push(`missing section heading: "${SECTIONS.shipped}"`)
if (notApplicable === null) problems.push(`missing section heading: "${SECTIONS.notApplicable}"`)
if (open === null) problems.push(`missing section heading: "${SECTIONS.open}"`)

if (shipped !== null && shipped.length === 0) {
  // An empty Shipped table would make every per-row check below pass vacuously — the exact way a
  // guard ends up proving nothing at all.
  problems.push('the Shipped table has no rows — the sweep would pass vacuously')
}

// ---- Shipped: every evidence path must exist on disk ------------------------------------------

// A cell's evidence is its FIRST backtick token (checked unconditionally, so root files like
// `build.bat` are not exempt), plus any later backtick token that contains a `/` — later tokens
// without one are annotations (guard-row ids, symbol names), not paths.
function cellPaths(cell) {
  const tokens = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  if (tokens.length === 0) return { missing: true, paths: [] }
  return { missing: false, paths: [tokens[0], ...tokens.slice(1).filter((t) => t.includes('/'))] }
}

const COLUMNS = ['implementation', 'documentation', 'focused test']

for (const row of shipped ?? []) {
  const feature = row.cells[0] ?? '(unnamed)'
  if (row.cells.length !== 4) {
    problems.push(`Shipped "${feature}" (line ${row.lineNo}): expected 4 cells, found ${row.cells.length}`)
    continue
  }
  for (let c = 1; c <= 3; c++) {
    const { missing, paths } = cellPaths(row.cells[c])
    if (missing) {
      problems.push(`Shipped "${feature}" (line ${row.lineNo}): ${COLUMNS[c - 1]} cell names no backtick-quoted path`)
      continue
    }
    for (const p of paths) {
      if (!existsSync(join(ROOT, p))) {
        problems.push(`Shipped "${feature}" (line ${row.lineNo}): ${COLUMNS[c - 1]} path does not exist: ${p}`)
      }
    }
  }
}

// ---- Not applicable: the reason is mandatory ---------------------------------------------------

for (const row of notApplicable ?? []) {
  const feature = row.cells[0] ?? '(unnamed)'
  const reason = (row.cells[1] ?? '').trim()
  if (reason.length < 10) {
    problems.push(`Not-applicable "${feature}" (line ${row.lineNo}): the reason is missing or too thin to mean anything`)
  }
}

// ---- Open: the note is mandatory, AND the stated blocker must still hold ----------------------

// Four rows sat here stale for a day. The work had landed; nobody moved the row. Nothing could
// notice, because this block used to be a prose-LENGTH check — it asked whether the cells were
// non-empty, never whether they were still true. And the stale table is bundled into the shipped
// app, so it was not a private embarrassment: nodeterm told its own users that four shipped
// features were missing.
//
// The symmetric guard is wrong on contact, which is worth stating so nobody "simplifies" toward
// it: you cannot assert that no path named in an Open row exists. The external-editor row
// deliberately cited its own implementation, because that row meant "built but untested".
//
// So each row declares ONE machine-evaluable exit condition and this evaluates it. Red means the
// blocker dissolved — close the row or restate what is missing.
function evaluateClosesWhen(spec) {
  // The cell is written backticked in the table, so unwrap BEFORE matching. Doing it after is
  // how the first version of this rejected its own only row as an unrecognised predicate.
  const bare = spec.trim().replace(/^`/, '').replace(/`$/, '').trim()
  const m = /^(absent|fails|contract|manual):([\s\S]+)$/.exec(bare)
  if (!m) return { ok: false, held: false, detail: `unrecognised predicate (want absent:/fails:/contract:/manual:)` }
  const kind = m[1]
  const arg = m[2].trim().replace(/^`/, "").replace(/`$/, "")
  if (arg.length === 0) return { ok: false, held: false, detail: `${kind}: has an empty argument` }

  if (kind === "manual") {
    // Never mechanically red — the whole point is a blocker no script can observe. The reason is
    // printed on EVERY run so a lazily-written one is visible to a reviewer instead of hiding
    // behind a green tick. That visibility is the only thing keeping this from being a rubber stamp.
    return { ok: true, held: true, detail: `manual — ${arg}` }
  }

  if (kind === "absent") {
    const exists = existsSync(join(ROOT, arg))
    return { ok: true, held: !exists, detail: exists ? `${arg} EXISTS now` : `${arg} still absent` }
  }

  if (kind === "contract") {
    // Deliberately narrow, and say so: this asks whether check-app-contract.mjs has a FEATURES row
    // with that id, not whether the row passes. Running the whole contract from inside this guard
    // would be slow and circular. A row that exists is enough to mean "somebody has taken this on",
    // which is the moment the inventory row needs revisiting.
    let src = ""
    try {
      src = readFileSync(join(ROOT, "scripts/check-app-contract.mjs"), "utf8")
    } catch {
      return { ok: false, held: true, detail: `contract: could not read scripts/check-app-contract.mjs` }
    }
    // Anchored to the line and to the quotes: a bare substring would match inside a longer id,
    // which is the toothless-needle trap this repository keeps re-learning.
    const has = new RegExp(`^\\s*id: [\u0027"]${arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\u0027"],`, "m").test(src)
    return { ok: true, held: !has, detail: has ? `contract row ${arg} EXISTS now` : `no contract row ${arg} yet` }
  }

  // fails:<command> — held while the command still exits non-zero.
  // Executed WITHOUT a shell and only for `node scripts/<file>.mjs`. This string comes out of a
  // markdown table that anybody can edit, so a general command runner here would be a shell
  // injection wearing a documentation hat.
  const parts = arg.split(/\s+/)
  if (parts[0] !== "node" || parts.length !== 2 || !/^scripts\/[\w.-]+\.mjs$/.test(parts[1])) {
    return { ok: false, held: true, detail: `fails: only "node scripts/<file>.mjs" is allowed, got ${arg}` }
  }
  try {
    execFileSync(process.execPath, [join(ROOT, parts[1])], { cwd: ROOT, stdio: "ignore" })
    return { ok: true, held: false, detail: `${arg} EXITS 0 now` }
  } catch {
    return { ok: true, held: true, detail: `${arg} still fails` }
  }
}

for (const row of open ?? []) {
  const feature = row.cells[0] ?? "(unnamed)"
  const missing = (row.cells[1] ?? "").trim()
  const closesWhen = (row.cells[2] ?? "").trim()
  const note = (row.cells[3] ?? "").trim()
  if (missing.length === 0) {
    problems.push(`Open "${feature}" (line ${row.lineNo}): the "What is missing" cell is empty`)
  }
  if (note.length < 10) {
    problems.push(`Open "${feature}" (line ${row.lineNo}): the note is missing or too thin to mean anything`)
  }
  if (closesWhen.length === 0) {
    problems.push(`Open "${feature}" (line ${row.lineNo}): no "Closes when" predicate — an open row must say what would close it`)
    continue
  }
  const verdict = evaluateClosesWhen(closesWhen)
  predicateReport.push(`    ${feature}: ${verdict.detail}`)
  if (!verdict.ok) {
    problems.push(`Open "${feature}" (line ${row.lineNo}): ${verdict.detail}`)
  } else if (!verdict.held) {
    problems.push(
      `Open "${feature}" (line ${row.lineNo}): the stated blocker no longer holds — ${verdict.detail}. ` +
        `Close the row, or restate what is still missing.`,
    )
  }
}

// ---- the load-bearing half: every required canonical feature has a row somewhere ---------------

const allRows = [...(shipped ?? []), ...(notApplicable ?? []), ...(open ?? [])]
const seen = new Map()
for (const row of allRows) {
  const name = (row.cells[0] ?? '').trim()
  seen.set(name, (seen.get(name) ?? 0) + 1)
}

for (const name of REQUIRED_FEATURES) {
  if (!seen.has(name)) {
    problems.push(`required canonical feature has no row in any table: "${name}"`)
  }
}

// A feature in two tables at once reports two contradictory statuses — usually a row moved to
// Open with the Shipped copy left behind, which is double-counted coverage.
for (const [name, count] of seen) {
  if (count > 1) problems.push(`feature appears in ${count} rows at once: "${name}"`)
}

// ---- the predicate report, printed pass OR fail --------------------------------------------------

// A manual: predicate is only as strong as somebody reading it, so every open row prints its exit
// condition and that condition's CURRENT value on every run. Hiding these behind a green tick is
// how an escape hatch quietly becomes a rubber stamp.
if (predicateReport.length) {
  console.log('  open-row exit conditions:')
  for (const line of predicateReport) console.log(line)
}

// ---- verdict -----------------------------------------------------------------------------------

if (problems.length) {
  console.error('Feature inventory is out of sync:\n')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('\nFix docs/uh-feature-inventory.md — and if a canonical feature was added or removed,')
  console.error('update REQUIRED_FEATURES in this script in the same change.')
  process.exit(1)
}

const shippedCount = shipped?.length ?? 0
console.log(
  `✓ feature inventory: ${shippedCount} shipped, ${notApplicable?.length ?? 0} not-applicable, ` +
    `${open?.length ?? 0} open — all ${REQUIRED_FEATURES.length} required features present, every shipped path exists`
)
