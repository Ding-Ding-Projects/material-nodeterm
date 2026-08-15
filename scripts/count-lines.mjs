#!/usr/bin/env node
// count-lines.mjs — the project's committed line counter.
//
// Prints an exact table of the repository's line count, broken down the way
// CLAUDE.md's documentation rules require: the project's own source, its
// tests, and its styles/markup counted SEPARATELY (both total and non-blank
// lines), a per-language split, an explicit list of what is excluded and
// why, and a grand total alongside the narrower project total.
//
// Source of truth for "what files exist" is `git ls-files` — it already
// respects .gitignore, so build output (out/, dist/) and installed
// dependencies (node_modules/) never appear here in the first place. The
// EXCLUDED section below still lists those categories explicitly, with a
// real (usually zero) count, so a reader can see what was deliberately held
// out rather than wondering whether it was silently missed.
//
// Usage:
//   node scripts/count-lines.mjs            # human-readable table
//   node scripts/count-lines.mjs --json      # machine-readable JSON
//
// This script has no dependencies beyond `git` and Node's standard library,
// so it runs the same way locally and in CI.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function gitFiles() {
  const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], { encoding: 'utf8' })
  return out.split('\n').filter(Boolean)
}

// --- Category rules -------------------------------------------------------
//
// Every tracked file lands in exactly one bucket. Buckets are checked in
// order, so more specific rules (tests, lockfiles) win over the generic
// extension-based ones.

/** @typedef {'source'|'tests'|'styles'|'docs'|'config'|'assets'|'excluded'} Bucket */

const EXCLUDED_LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'])

/**
 * @param {string} relPath
 * @returns {{ bucket: Bucket, excludedReason?: string, lang: string }}
 */
function classify(relPath) {
  const base = path.basename(relPath)
  const ext = path.extname(base).toLowerCase()

  // Explicit exclusions — vendored trees, dependency directories, build
  // output, lockfiles. git ls-files already keeps most of these out (they
  // are gitignored), but the rule is checked by path/name too rather than
  // trusted to gitignore alone, so a future tracked exception is still
  // caught and reported here instead of silently entering the source count.
  if (
    relPath.startsWith('node_modules/') ||
    relPath.includes('/node_modules/') ||
    relPath.startsWith('vendor/') ||
    relPath.includes('/vendor/') ||
    relPath.startsWith('third_party/') ||
    relPath.includes('/third_party/')
  ) {
    return { bucket: 'excluded', excludedReason: 'Vendored / third-party trees', lang: ext || '(none)' }
  }
  if (
    relPath.startsWith('out/') ||
    relPath.startsWith('dist/') ||
    relPath.startsWith('.superpowers/dist/')
  ) {
    return { bucket: 'excluded', excludedReason: 'Build output', lang: ext || '(none)' }
  }
  if (EXCLUDED_LOCKFILES.has(base)) {
    return { bucket: 'excluded', excludedReason: 'Dependency lockfiles', lang: ext || '(none)' }
  }

  // Tests — *.test.ts(x), the top-level test/ suite tree, and the test
  // runner's own config file. Checked before the generic source rule so a
  // test file never gets double-counted as plain source.
  if (/\.test\.(ts|tsx|js|jsx)$/.test(base) || relPath === 'test' || relPath.startsWith('test/') || base === 'vitest.config.ts') {
    return { bucket: 'tests', lang: ext || '(none)' }
  }

  // Styles / markup.
  if (ext === '.css' || ext === '.scss' || ext === '.html') {
    return { bucket: 'styles', lang: ext }
  }

  // The project's own source: TypeScript/TSX plus the Node scripts that
  // build, patch and package it.
  if (ext === '.ts' || ext === '.tsx' || ext === '.mjs' || ext === '.cjs' || ext === '.js' || ext === '.jsx') {
    return { bucket: 'source', lang: ext }
  }

  // Documentation (counted toward the grand total, held out of the
  // narrower "project total" — prose is not code).
  if (ext === '.md' || ext === '.mdx') {
    return { bucket: 'docs', lang: ext }
  }

  // Structured config/data that is still plain text worth a line count:
  // CI workflow YAML, shell installers, JSON fixtures/config, dotfiles.
  if (['.json', '.jsonl', '.yml', '.yaml', '.sh', '.plist', '.txt', '.dockerignore', '.gitignore'].includes(ext) || base.startsWith('.')) {
    return { bucket: 'config', lang: ext || '(dotfile)' }
  }

  // Everything else (images, video, fonts, binaries) — counted as an asset
  // by file count only; a "line count" for a PNG is meaningless.
  return { bucket: 'assets', lang: ext || '(none)' }
}

const TEXT_ASSET_EXTS = new Set(['.svg']) // XML text, but still an illustration, not code or docs.

function isBinaryLikeAsset(ext) {
  return !TEXT_ASSET_EXTS.has(ext)
}

function countLines(absPath) {
  let buf
  try {
    buf = readFileSync(absPath)
  } catch {
    return null // deleted/renamed between ls-files and read — skip, don't crash the whole report.
  }
  // A NUL byte anywhere is a solid binary signal; skip line counting for it.
  if (buf.includes(0)) return null
  const text = buf.toString('utf8')
  if (text.length === 0) return { total: 0, nonBlank: 0 }
  const lines = text.split('\n')
  // A trailing newline produces one extra empty element from split(); a file
  // ending "a\nb\n" is 2 lines, not 3 — drop that phantom trailing entry so
  // this agrees with what `git blame`/`wc -l` report, rather than over-counting
  // by exactly one line on every LF-terminated file.
  if (lines.length > 0 && lines[lines.length - 1] === '' && text.endsWith('\n')) lines.pop()
  const nonBlank = lines.filter((l) => l.trim().length > 0).length
  return { total: lines.length, nonBlank }
}

function newBucket() {
  return { files: 0, total: 0, nonBlank: 0 }
}

function main() {
  const files = gitFiles()
  const buckets = {
    source: newBucket(),
    tests: newBucket(),
    styles: newBucket(),
    docs: newBucket(),
    config: newBucket(),
    assets: newBucket(), // file count only — no meaningful line total for binaries
  }
  const excluded = new Map() // reason -> { files, total, nonBlank }
  const byLang = new Map() // lang -> { files, total, nonBlank } — spans source+tests+styles only

  for (const rel of files) {
    const { bucket, excludedReason, lang } = classify(rel)
    const abs = path.join(REPO_ROOT, rel)

    if (bucket === 'excluded') {
      const key = excludedReason
      if (!excluded.has(key)) excluded.set(key, newBucket())
      const row = excluded.get(key)
      row.files += 1
      const counted = countLines(abs)
      if (counted) {
        row.total += counted.total
        row.nonBlank += counted.nonBlank
      }
      continue
    }

    if (bucket === 'assets' && isBinaryLikeAsset(path.extname(rel).toLowerCase())) {
      buckets.assets.files += 1
      continue // no line count attempted for real binaries
    }

    const counted = countLines(abs)
    const b = buckets[bucket]
    b.files += 1
    if (counted) {
      b.total += counted.total
      b.nonBlank += counted.nonBlank
    }

    if (bucket === 'source' || bucket === 'tests' || bucket === 'styles') {
      if (!byLang.has(lang)) byLang.set(lang, newBucket())
      const l = byLang.get(lang)
      l.files += 1
      if (counted) {
        l.total += counted.total
        l.nonBlank += counted.nonBlank
      }
    }
  }

  // Project total = the project's own code, exactly the three mandated
  // categories: source, tests, styles/markup.
  const projectTotal = newBucket()
  for (const key of ['source', 'tests', 'styles']) {
    projectTotal.files += buckets[key].files
    projectTotal.total += buckets[key].total
    projectTotal.nonBlank += buckets[key].nonBlank
  }

  // Grand total = everything counted (project code + docs + config/data +
  // asset file count), excluding rows that were deliberately excluded above.
  const grandTotal = newBucket()
  for (const key of Object.keys(buckets)) {
    grandTotal.files += buckets[key].files
    grandTotal.total += buckets[key].total
    grandTotal.nonBlank += buckets[key].nonBlank
  }

  // Self-check: the grand total must equal the sum of every counted bucket.
  // If this ever disagrees, the counter itself has a bug and must be fixed
  // before the figure is published — never silently trusted.
  const recomputedGrand = Object.values(buckets).reduce(
    (acc, b) => ({ files: acc.files + b.files, total: acc.total + b.total, nonBlank: acc.nonBlank + b.nonBlank }),
    newBucket()
  )
  const arithmeticOk =
    recomputedGrand.files === grandTotal.files &&
    recomputedGrand.total === grandTotal.total &&
    recomputedGrand.nonBlank === grandTotal.nonBlank

  const result = {
    generatedAt: new Date().toISOString(),
    repo: 'nodeterm',
    buckets: {
      source: buckets.source,
      tests: buckets.tests,
      styles: buckets.styles,
      docs: buckets.docs,
      config: buckets.config,
      assets: buckets.assets,
    },
    byLanguage: Object.fromEntries([...byLang.entries()].sort((a, b) => b[1].total - a[1].total)),
    excluded: Object.fromEntries([...excluded.entries()]),
    projectTotal,
    grandTotal,
    arithmeticOk,
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return
  }

  printTable(result)
}

function row(label, b, note = '') {
  const files = String(b.files).padStart(6)
  const total = String(b.total).padStart(8)
  const nonBlank = String(b.nonBlank).padStart(8)
  return `${label.padEnd(32)} ${files} ${total} ${nonBlank}  ${note}`
}

function printTable(r) {
  const header = `${'Category'.padEnd(32)} ${'Files'.padStart(6)} ${'Lines'.padStart(8)} ${'Non-blank'.padStart(8)}`
  const rule = '-'.repeat(header.length + 20)
  console.log('nodeterm — line count')
  console.log('generated ' + r.generatedAt)
  console.log()
  console.log(header)
  console.log(rule)
  console.log(row('Source (project code)', r.buckets.source))
  console.log(row('Tests', r.buckets.tests))
  console.log(row('Styles / markup', r.buckets.styles))
  console.log(rule)
  console.log(row('PROJECT TOTAL', r.projectTotal, '(source + tests + styles)'))
  console.log()
  console.log(row('Documentation (.md)', r.buckets.docs, 'not project code — prose'))
  console.log(row('Config / data (json, yml, sh…)', r.buckets.config, 'not project code'))
  console.log(row('Assets (images, video, fonts)', r.buckets.assets, 'file count only, binary'))
  console.log(rule)
  console.log(row('GRAND TOTAL', r.grandTotal, '(every counted tracked file)'))
  console.log()
  console.log('By language (source + tests + styles only):')
  for (const [lang, b] of Object.entries(r.byLanguage)) {
    console.log(row('  ' + lang, b))
  }
  console.log()
  console.log('Excluded (held out of every total above, shown for transparency):')
  const reasons = ['Vendored / third-party trees', 'Build output', 'Dependency lockfiles']
  const excludedEntries = Object.entries(r.excluded)
  const seen = new Set()
  for (const [reason, b] of excludedEntries) {
    seen.add(reason)
    console.log(row('  ' + reason, b))
  }
  for (const reason of reasons) {
    if (!seen.has(reason)) console.log(row('  ' + reason, { files: 0, total: 0, nonBlank: 0 }, 'none tracked'))
  }
  console.log()
  console.log(
    r.arithmeticOk
      ? 'Arithmetic check: OK — grand total equals the sum of every counted bucket.'
      : 'Arithmetic check: MISMATCH — the counter has a bug; do not publish this figure.'
  )
  if (!r.arithmeticOk) process.exitCode = 1
}

main()
