#!/usr/bin/env node
/**
 * count-lines.mjs — the repository's committed line counter.
 *
 * Prints (and, via `computeLineCounts`, returns as data) how many lines this project
 * has at the currently checked-out commit: project source / tests / styles counted
 * separately, total and non-blank, split per language, with the exclusion list stated
 * plainly and a grand total alongside the project total. It also attributes SURVIVING
 * lines (via `git blame`, never by summing added lines from the log — churn is not
 * authorship) to an agent or a person, and states the exact rule it used.
 *
 * Usage:
 *   node scripts/count-lines.mjs            # prints the table for HEAD
 *   node scripts/count-lines.mjs <ref>       # prints the table for a specific ref
 *
 * `release-notes.mjs` imports `computeLineCounts()` directly rather than shelling out,
 * so the release notes and a standalone `node scripts/count-lines.mjs` run always agree.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)

// Paths this counter deliberately never scans. `git ls-files` already excludes
// .gitignore'd trees (node_modules, dist/out build output, etc.) since those are
// untracked — but a few tracked paths are not the project's own source and are
// named here explicitly so a reader never has to guess why they are absent.
const EXCLUDED_PATH_PATTERNS = [
  { pattern: /^package-lock\.json$/, reason: 'npm-generated lockfile, not hand-written' },
  { pattern: /^resources\/mascot\//, reason: 'binary art assets (images), not text source' },
  { pattern: /^resources\/bin\//, reason: 'prebuilt vendored binaries, not source' },
  { pattern: /^resources\/licenses\//, reason: 'third-party license text, not this project\'s code' },
  { pattern: /^docs\/assets\//, reason: 'documentation image/binary assets' },
]

// Extensions counted as text; anything else (images, fonts, binaries, lockfile-shaped
// generated JSON) is skipped rather than guessed at.
const LANGUAGE_BY_EXT = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (TSX)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (JSX)',
  '.mjs': 'JavaScript (ESM)',
  '.cjs': 'JavaScript (CJS)',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.html': 'HTML',
  '.md': 'Markdown',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.sh': 'Shell',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
}

const STYLE_EXTS = new Set(['.css', '.scss', '.less'])
const DOC_EXTS = new Set(['.md'])
const CONFIG_EXTS = new Set(['.json', '.yml', '.yaml'])

function isTestPath(path) {
  return (
    /\.test\.[cm]?[jt]sx?$/.test(path) ||
    /\.spec\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)(__tests__|test|tests)\//.test(path)
  )
}

function classify(path) {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  if (!(ext in LANGUAGE_BY_EXT)) return null // unknown extension: not counted as text source
  if (isTestPath(path)) return { bucket: 'tests', ext }
  if (STYLE_EXTS.has(ext)) return { bucket: 'styles', ext }
  if (DOC_EXTS.has(ext)) return { bucket: 'docs', ext }
  if (CONFIG_EXTS.has(ext)) return { bucket: 'config', ext }
  return { bucket: 'source', ext }
}

function excludedReason(path) {
  for (const { pattern, reason } of EXCLUDED_PATH_PATTERNS) {
    if (pattern.test(path)) return reason
  }
  return null
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 1024 * 1024 * 256,
  })
  return stdout
}

function countLines(text) {
  if (text.length === 0) return { total: 0, nonBlank: 0 }
  // A trailing newline must not be counted as an extra blank line — git itself does
  // not count it as one, and a counter that does will disagree with its own blame
  // totals for no reason other than an off-by-one in how it split the file.
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const lines = body.length === 0 ? [] : body.split('\n')
  const nonBlank = lines.reduce((n, l) => (l.trim().length > 0 ? n + 1 : n), 0)
  return { total: lines.length, nonBlank }
}

const AGENT_AUTHOR_PATTERNS = [
  /noreply@anthropic\.com/i,
  /claude/i,
  /codex/i,
  /copilot/i,
  /openai/i,
  /\bbot\b/i,
  /\[bot\]/i,
  /github-actions/i,
]

const AGENT_TRAILER_RE = /^co-authored-by:.*$/im

function isAgentCommit(authorName, authorEmail, body) {
  const authorHay = `${authorName} <${authorEmail}>`
  if (AGENT_AUTHOR_PATTERNS.some((re) => re.test(authorHay))) return true
  const trailerMatch = body.match(AGENT_TRAILER_RE)
  if (trailerMatch && AGENT_AUTHOR_PATTERNS.some((re) => re.test(trailerMatch[0]))) return true
  return false
}

/**
 * Attribute every surviving line of `files` to an agent or a person, via `git blame`
 * on the given ref. This is deliberately NOT `git log --numstat` summed over commits:
 * a line added and later deleted belongs to nobody, and churn is not authorship.
 */
async function attributeLines(files, ref, cwd) {
  const commitCache = new Map() // sha -> { isAgent }
  let agentLines = 0
  let personLines = 0
  let unknownLines = 0

  async function classifyCommit(sha) {
    if (commitCache.has(sha)) return commitCache.get(sha)
    if (/^0{40}$/.test(sha)) {
      // Uncommitted / working-tree line (only possible when ref is HEAD with local
      // edits). Not attributable to anyone yet.
      const info = { isAgent: false, unknown: true }
      commitCache.set(sha, info)
      return info
    }
    let info
    try {
      const raw = await git(['show', '-s', '--format=%an%x1f%ae%x1f%B', sha], cwd)
      const sep = raw.indexOf('\x1f')
      const sep2 = raw.indexOf('\x1f', sep + 1)
      const authorName = raw.slice(0, sep)
      const authorEmail = raw.slice(sep + 1, sep2)
      const body = raw.slice(sep2 + 1)
      info = { isAgent: isAgentCommit(authorName, authorEmail, body), unknown: false }
    } catch {
      info = { isAgent: false, unknown: true }
    }
    commitCache.set(sha, info)
    return info
  }

  for (const file of files) {
    let raw
    try {
      raw = await git(['blame', '--line-porcelain', ref, '--', file], cwd)
    } catch {
      // A file git cannot blame at this ref (e.g. added uncommitted) contributes no
      // attributed lines; it is still counted in the size tables above.
      continue
    }
    if (raw.length === 0) continue
    const lines = raw.split('\n')
    for (const line of lines) {
      // Each blamed source line starts a porcelain record with "<sha> <orig> <final> [<n>]".
      if (/^[0-9a-f]{40} \d+ \d+/.test(line)) {
        const sha = line.slice(0, 40)
        const info = await classifyCommit(sha)
        if (info.unknown) unknownLines++
        else if (info.isAgent) agentLines++
        else personLines++
      }
    }
  }

  return { agentLines, personLines, unknownLines }
}

export async function computeLineCounts({ cwd = process.cwd(), ref = 'HEAD' } = {}) {
  // A bad ref must fail loudly, not silently report every count as zero — an empty
  // table and "there is nothing here" are different facts, and this counter exists
  // to state the difference (see the session-memory `ok:false` rule in CLAUDE.md).
  try {
    await git(['rev-parse', '--verify', `${ref}^{commit}`], cwd)
  } catch {
    throw new Error(`ref ${JSON.stringify(ref)} does not resolve to a commit in this repository`)
  }

  const lsOut = await git(['ls-files'], cwd)
  const allTracked = lsOut.split('\n').filter(Boolean)

  const excluded = []
  const counted = []
  for (const path of allTracked) {
    const reason = excludedReason(path)
    if (reason) {
      excluded.push({ path, reason })
      continue
    }
    counted.push(path)
  }

  const buckets = {
    source: { total: 0, nonBlank: 0, files: 0 },
    tests: { total: 0, nonBlank: 0, files: 0 },
    styles: { total: 0, nonBlank: 0, files: 0 },
    docs: { total: 0, nonBlank: 0, files: 0 },
    config: { total: 0, nonBlank: 0, files: 0 },
  }
  const byLanguage = new Map() // language -> { total, nonBlank, files }
  const uncounted = [] // tracked, not excluded, but not a recognized text extension

  const textFiles = [] // files actually counted (fed to blame attribution)

  for (const path of counted) {
    const cls = classify(path)
    if (!cls) {
      uncounted.push(path)
      continue
    }
    let raw
    try {
      raw = await git(['show', `${ref}:${path}`], cwd)
    } catch {
      // Deleted between ls-files (working tree) and ref, or binary git refuses to
      // "show" as text — skip rather than guess.
      continue
    }
    const { total, nonBlank } = countLines(raw)
    buckets[cls.bucket].total += total
    buckets[cls.bucket].nonBlank += nonBlank
    buckets[cls.bucket].files += 1

    const langName = LANGUAGE_BY_EXT[cls.ext]
    const langEntry = byLanguage.get(langName) ?? { total: 0, nonBlank: 0, files: 0 }
    langEntry.total += total
    langEntry.nonBlank += nonBlank
    langEntry.files += 1
    byLanguage.set(langName, langEntry)

    textFiles.push(path)
  }

  const projectTotal = Object.values(buckets).reduce(
    (acc, b) => ({ total: acc.total + b.total, nonBlank: acc.nonBlank + b.nonBlank, files: acc.files + b.files }),
    { total: 0, nonBlank: 0, files: 0 },
  )
  // This project has no tracked vendored source subtree, so "everything counted"
  // and "the project's own code" are the same set — the grand total therefore equals
  // the project total. The distinction is preserved in the shape of the output (both
  // fields are always reported) so a future vendored subtree does not silently merge
  // into the project figure without anyone noticing the rule stopped holding.
  const grandTotal = projectTotal

  const attribution = await attributeLines(textFiles, ref, cwd)
  const attributedLines = attribution.agentLines + attribution.personLines + attribution.unknownLines
  const agentPercent = attributedLines > 0 ? (attribution.agentLines / attributedLines) * 100 : 0

  return {
    ref,
    generatedAt: new Date().toISOString(),
    buckets,
    byLanguage: [...byLanguage.entries()]
      .map(([language, counts]) => ({ language, ...counts }))
      .sort((a, b) => b.total - a.total),
    excluded,
    uncounted,
    projectTotal,
    grandTotal,
    attribution: {
      ...attribution,
      attributedLines,
      agentPercent,
      rule:
        'A surviving line (git blame at ' +
        ref +
        ') is attributed to an agent when the line\'s commit author name/email matches a ' +
        'known automation identity, or the commit body carries a Co-Authored-By trailer ' +
        'naming one (Claude, Codex, Copilot, OpenAI, *bot*, [bot], or github-actions, ' +
        'case-insensitive). Every other attributable line is a person. This sums lines that ' +
        'SURVIVE at the counted ref, never lines added across history — a line written and ' +
        'later deleted belongs to nobody.',
    },
  }
}

function fmt(n) {
  return n.toLocaleString('en-US')
}

function renderTable(data) {
  const lines = []
  lines.push(`Line count @ ${data.ref} (generated ${data.generatedAt})`)
  lines.push('')
  lines.push('By category (total / non-blank / files):')
  for (const [name, b] of Object.entries(data.buckets)) {
    lines.push(`  ${name.padEnd(8)} ${fmt(b.total).padStart(8)} / ${fmt(b.nonBlank).padStart(8)} / ${b.files} files`)
  }
  lines.push('')
  lines.push('By language (total / non-blank / files):')
  for (const l of data.byLanguage) {
    lines.push(`  ${l.language.padEnd(20)} ${fmt(l.total).padStart(8)} / ${fmt(l.nonBlank).padStart(8)} / ${l.files} files`)
  }
  lines.push('')
  lines.push(`Project total: ${fmt(data.projectTotal.total)} lines (${fmt(data.projectTotal.nonBlank)} non-blank) across ${data.projectTotal.files} files`)
  lines.push(`Grand total (everything counted): ${fmt(data.grandTotal.total)} lines (${fmt(data.grandTotal.nonBlank)} non-blank) across ${data.grandTotal.files} files`)
  lines.push('')
  lines.push('Excluded (tracked, but not the project\'s own source):')
  if (data.excluded.length === 0) {
    lines.push('  (none)')
  } else {
    for (const e of data.excluded) lines.push(`  ${e.path} — ${e.reason}`)
  }
  if (data.uncounted.length > 0) {
    lines.push('')
    lines.push(`Tracked files with an unrecognized extension (not counted as text source, ${data.uncounted.length} files):`)
    for (const p of data.uncounted.slice(0, 20)) lines.push(`  ${p}`)
    if (data.uncounted.length > 20) lines.push(`  …and ${data.uncounted.length - 20} more`)
  }
  lines.push('')
  const a = data.attribution
  lines.push(`Attribution — agent-written vs person-written (surviving lines):`)
  lines.push(`  agent:   ${fmt(a.agentLines)} (${a.agentPercent.toFixed(1)}%)`)
  lines.push(`  person:  ${fmt(a.personLines)}`)
  if (a.unknownLines > 0) lines.push(`  unknown: ${fmt(a.unknownLines)} (uncommitted or unresolvable)`)
  lines.push(`  rule:    ${a.rule}`)
  return lines.join('\n')
}

async function main() {
  const ref = process.argv[2] ?? 'HEAD'
  const data = await computeLineCounts({ ref })
  console.log(renderTable(data))
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error('count-lines.mjs failed:', err)
    process.exitCode = 1
  })
}
