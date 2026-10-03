#!/usr/bin/env node
/**
 * Port changes from the canonical upstream repository into this fork.
 *
 * This fork shares no Git history with `eneskirca/nodeterm`: it began as a squashed source
 * import, so `git merge`, `git cherry-pick` and `git rebase` can never relate the two trees. What
 * can relate them is content. For every path, the fork remembers the upstream commit whose
 * content it last absorbed (the port ledger), and a port is a per-file three-way merge:
 *
 *   base   = the path at the ledger commit (or an explicit --from)
 *   theirs = the path at the target upstream commit (--to, default: the reviewed submodule pin)
 *   ours   = the fork's working-tree file
 *
 * Upstream objects are read from the initialized `upstream/nodeterm` submodule checkout only;
 * nothing is ever written there. The ledger lives at `scripts/upstream-port-ledger.json`.
 *
 * Subcommands:
 *   classify --from <sha> --to <sha> [--json]        bucket every differing path without writing
 *   apply (--paths <file> | --commit <sha>) [--from <sha>] [--to <sha>] [--write] [--force] [--advance]
 *   ledger init --at <sha>                           seed the ledger for every shared path
 *   ledger update --to <sha> --paths <file> [--declined] [--accept-delete]
 *   check                                            offline consistency guard (used by the build)
 *
 * `apply` is a dry run unless `--write` is given. Conflicts are written WITH markers (diff3
 * style) so the resolution is reviewable; `apply` exits 2 while any conflict remains, and
 * `ledger update` refuses a path that still carries markers.
 */
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANONICAL_COMMIT, CANONICAL_PATH, CANONICAL_URL } from './check-canonical-upstream.mjs'
import { renameAtomicSync } from './lib/rename-atomic.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const LEDGER_PATH = 'scripts/upstream-port-ledger.json'
export const LEDGER_VERSION = 1
const SHA_RE = /^[0-9a-f]{40}$/
const MARKER_OPEN = /^<{7}( |$)/m
const MARKER_CLOSE = /^>{7}( |$)/m

export function gitRunner(cwd) {
  return (args, options = {}) =>
    execFileSync('git', args, {
      cwd,
      encoding: options.binary ? 'buffer' : 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      input: options.input,
    })
}

function trim(value) {
  return typeof value === 'string' ? value.trim() : value.toString('utf8').trim()
}

/** Everything the subcommands need; tests inject fixture repositories here. */
export function createContext({ root = ROOT, upstreamDir, runGit } = {}) {
  const upstream = upstreamDir ?? path.join(root, CANONICAL_PATH)
  const forkGit = runGit ?? gitRunner(root)
  const upstreamGit = runGit ? (args, opts) => runGit(['-C', upstream, ...args], opts) : gitRunner(upstream)
  return { root, upstream, forkGit, upstreamGit, ledgerFile: path.join(root, LEDGER_PATH) }
}

function requireUpstream(ctx, sha) {
  if (!existsSync(path.join(ctx.upstream, '.git')) && !existsSync(path.join(ctx.upstream, 'HEAD'))) {
    throw new Error(
      `upstream checkout is missing at ${ctx.upstream}; run \`git submodule update --init -- ${CANONICAL_PATH}\` first`,
    )
  }
  try {
    const type = trim(ctx.upstreamGit(['cat-file', '-t', sha]))
    if (type !== 'commit') throw new Error(`${sha} is a ${type}, not a commit`)
  } catch (error) {
    throw new Error(
      `upstream commit ${sha} is not available in ${ctx.upstream}; run \`git -C ${CANONICAL_PATH} fetch origin ${sha}\` (origin must be ${CANONICAL_URL}). ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** `{ path -> { mode, blob } }` for every regular file at an upstream commit; gitlinks skipped. */
export function upstreamTree(ctx, sha) {
  const out = ctx.upstreamGit(['ls-tree', '-r', '-z', sha], { binary: true }).toString('utf8')
  const entries = new Map()
  for (const record of out.split('\0')) {
    if (!record) continue
    const match = /^(\d{6}) (blob|commit|tree) ([0-9a-f]{40})\t(.+)$/s.exec(record)
    if (!match || match[2] !== 'blob') continue
    entries.set(match[4], { mode: match[1], blob: match[3] })
  }
  return entries
}

/** Blob ids of the fork's working-tree files, using Git's own filters (no network, no blobs). */
export function forkBlobIds(ctx, paths) {
  const present = paths.filter((p) => {
    const full = path.join(ctx.root, p)
    return existsSync(full) && statSync(full).isFile()
  })
  const ids = new Map()
  if (present.length === 0) return ids
  const out = ctx.forkGit(['hash-object', '--stdin-paths'], { input: present.join('\n') + '\n' })
  const lines = trim(out).split('\n')
  present.forEach((p, index) => ids.set(p, lines[index]))
  return ids
}

export function upstreamContent(ctx, sha, filePath) {
  try {
    return ctx.upstreamGit(['show', `${sha}:${filePath}`], { binary: true })
  } catch {
    return null
  }
}

function isBinary(buffer) {
  return buffer.subarray(0, 8000).includes(0)
}

/** Run `git merge-file`; returns { text, conflicts } where conflicts is the marker count (0 = clean). */
export function threeWayMerge(ctx, { ours, base, theirs, labels }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'port-upstream-'))
  try {
    const ourFile = path.join(dir, 'ours')
    const baseFile = path.join(dir, 'base')
    const theirFile = path.join(dir, 'theirs')
    writeFileSync(ourFile, ours)
    writeFileSync(baseFile, base)
    writeFileSync(theirFile, theirs)
    const args = ['merge-file', '-p', '--diff3']
    for (const label of labels ?? []) args.push('-L', label)
    args.push(ourFile, baseFile, theirFile)
    try {
      return { text: ctx.forkGit(args, { binary: true }), conflicts: 0 }
    } catch (error) {
      const status = typeof error.status === 'number' ? error.status : 255
      if (status > 0 && status < 128 && error.stdout) return { text: Buffer.from(error.stdout), conflicts: status }
      throw error
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Bucket every path that differs between two upstream commits against the fork tree:
 * new | fast-forward | current | merge-clean | conflict | deleted-upstream.
 */
export function classify(ctx, { from, to }) {
  requireUpstream(ctx, from)
  requireUpstream(ctx, to)
  const oldTree = upstreamTree(ctx, from)
  const newTree = upstreamTree(ctx, to)
  const candidates = []
  for (const [p, entry] of newTree) {
    const old = oldTree.get(p)
    if (!old || old.blob !== entry.blob) candidates.push(p)
  }
  for (const p of oldTree.keys()) if (!newTree.has(p)) candidates.push(p)
  candidates.sort()
  const forkIds = forkBlobIds(ctx, candidates)
  const rows = []
  for (const p of candidates) {
    const old = oldTree.get(p)
    const fresh = newTree.get(p)
    const fork = forkIds.get(p)
    let bucket
    let conflicts = 0
    if (!fresh) bucket = 'deleted-upstream'
    else if (fork === undefined) bucket = 'new'
    else if (fork === fresh.blob) bucket = 'current'
    else if (old && fork === old.blob) bucket = 'fast-forward'
    else {
      const ours = readFileSync(path.join(ctx.root, p))
      const base = old ? upstreamContent(ctx, from, p) : Buffer.alloc(0)
      const theirs = upstreamContent(ctx, to, p)
      if (isBinary(ours) || isBinary(base) || isBinary(theirs)) bucket = 'binary-manual'
      else {
        const merged = threeWayMerge(ctx, { ours, base, theirs })
        conflicts = merged.conflicts
        bucket = conflicts === 0 ? 'merge-clean' : 'conflict'
      }
    }
    rows.push({ path: p, bucket, conflicts })
  }
  const counts = {}
  for (const row of rows) counts[row.bucket] = (counts[row.bucket] ?? 0) + 1
  return { from, to, rows, counts }
}

export function loadLedger(ctx) {
  if (!existsSync(ctx.ledgerFile)) return { version: LEDGER_VERSION, upstream: CANONICAL_URL, baseline: null, paths: {}, declined: {} }
  const parsed = JSON.parse(readFileSync(ctx.ledgerFile, 'utf8'))
  return parsed
}

function sortedObject(object) {
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]))
}

export function saveLedger(ctx, ledger) {
  const normalized = {
    version: LEDGER_VERSION,
    upstream: ledger.upstream ?? CANONICAL_URL,
    baseline: ledger.baseline ?? null,
    paths: sortedObject(ledger.paths ?? {}),
    declined: sortedObject(ledger.declined ?? {}),
  }
  const lines = ['{']
  lines.push(`  "version": ${normalized.version},`)
  lines.push(`  "upstream": ${JSON.stringify(normalized.upstream)},`)
  lines.push(`  "baseline": ${JSON.stringify(normalized.baseline)},`)
  for (const section of ['paths', 'declined']) {
    const entries = Object.entries(normalized[section])
    const trailing = section === 'paths' ? ',' : ''
    if (entries.length === 0) {
      lines.push(`  "${section}": {}${trailing}`)
      continue
    }
    lines.push(`  "${section}": {`)
    entries.forEach(([key, value], index) => {
      lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)}${index === entries.length - 1 ? '' : ','}`)
    })
    lines.push(`  }${trailing}`)
  }
  lines.push('}')
  writeAtomic(ctx.ledgerFile, lines.join('\n') + '\n')
  return normalized
}

function writeAtomic(target, content, mode) {
  mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.port-${process.pid}-${randomUUID()}.tmp`
  writeFileSync(temporary, content)
  if (mode) chmodSync(temporary, mode)
  renameAtomicSync(temporary, target)
}

export function ledgerInit(ctx, { at }) {
  requireUpstream(ctx, at)
  const tree = upstreamTree(ctx, at)
  const paths = {}
  for (const p of tree.keys()) {
    const full = path.join(ctx.root, p)
    if (existsSync(full) && statSync(full).isFile()) paths[p] = at
  }
  const ledger = saveLedger(ctx, { baseline: at, paths, declined: {} })
  return { seeded: Object.keys(ledger.paths).length, at }
}

function hasMarkers(text) {
  return MARKER_OPEN.test(text) && MARKER_CLOSE.test(text)
}

function isDirty(ctx, filePath) {
  const out = ctx.forkGit(['status', '--porcelain', '--', filePath])
  return trim(out).length > 0
}

function modeOf(entry) {
  return entry?.mode === '100755' ? 0o755 : undefined
}

/**
 * Port a list of paths (range mode) or one upstream commit (cherry-pick mode).
 * Returns rows with per-path verdicts; writes only with `write: true`.
 */
export function apply(ctx, { paths, commit, from, to = CANONICAL_COMMIT, write = false, force = false, advance = false }) {
  const ledger = loadLedger(ctx)
  let targets
  let baseFor
  let target = to
  if (commit) {
    requireUpstream(ctx, commit)
    target = commit
    const parent = trim(ctx.upstreamGit(['rev-parse', `${commit}^`]))
    const diff = ctx.upstreamGit(['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '-z', commit], { binary: true })
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
    targets = []
    for (let i = 0; i < diff.length; i++) {
      const status = diff[i]
      if (status.startsWith('R') || status.startsWith('C')) {
        const oldPath = diff[++i]
        const newPath = diff[++i]
        targets.push({ path: newPath, renamedFrom: oldPath })
      } else {
        targets.push({ path: diff[++i] })
      }
    }
    baseFor = () => parent
  } else {
    requireUpstream(ctx, target)
    if (from) requireUpstream(ctx, from)
    targets = paths.map((p) => ({ path: p }))
    baseFor = (p) => ledger.paths?.[p] ?? from ?? null
  }
  const theirTree = upstreamTree(ctx, target)
  const rows = []
  let ledgerChanged = false
  for (const item of targets) {
    const p = item.path
    const full = path.join(ctx.root, p)
    const base = baseFor(p)
    const theirs = theirTree.has(p) ? upstreamContent(ctx, target, p) : null
    const ours = existsSync(full) && statSync(full).isFile() ? readFileSync(full) : null
    const row = { path: p, base, verdict: '', conflicts: 0, written: false }
    rows.push(row)
    if (theirs === null) {
      row.verdict = ours === null ? 'absent' : 'deleted-upstream'
      continue
    }
    if (ours === null) {
      row.verdict = 'new'
      if (write) {
        writeAtomic(full, theirs, modeOf(theirTree.get(p)))
        row.written = true
      }
      continue
    }
    if (ours.equals(theirs)) {
      row.verdict = 'unchanged'
      continue
    }
    if (base === null) {
      row.verdict = 'no-base'
      continue
    }
    if (!force && isDirty(ctx, p)) {
      row.verdict = 'dirty'
      continue
    }
    const baseContent = upstreamContent(ctx, base, p) ?? Buffer.alloc(0)
    if (isBinary(ours) || isBinary(baseContent) || isBinary(theirs)) {
      row.verdict = 'binary-manual'
      continue
    }
    if (ours.equals(baseContent)) {
      row.verdict = 'fast-forward'
      if (write) {
        writeAtomic(full, theirs, modeOf(theirTree.get(p)))
        row.written = true
      }
      continue
    }
    const merged = threeWayMerge(ctx, {
      ours,
      base: baseContent,
      theirs,
      labels: ['fork', `base ${base.slice(0, 7)}`, `upstream ${target.slice(0, 7)}`],
    })
    row.conflicts = merged.conflicts
    row.verdict = merged.conflicts === 0 ? (merged.text.equals(ours) ? 'unchanged' : 'merged') : `conflict (${merged.conflicts})`
    if (write && !merged.text.equals(ours)) {
      writeAtomic(full, merged.text, modeOf(theirTree.get(p)))
      row.written = true
    }
  }
  if (write && advance && commit) {
    for (const row of rows) {
      if (row.conflicts > 0 || row.verdict === 'no-base' || row.verdict === 'dirty' || row.verdict === 'binary-manual') continue
      if (row.verdict === 'deleted-upstream' || row.verdict === 'absent') continue
      if (ledger.paths?.[row.path] === row.base || (row.verdict === 'new' && !(row.path in (ledger.paths ?? {})))) {
        ledger.paths[row.path] = commit
        row.advanced = true
        ledgerChanged = true
      }
    }
    if (ledgerChanged) saveLedger(ctx, ledger)
  }
  const conflicts = rows.filter((row) => row.conflicts > 0).length
  return { target, rows, conflicts, exitCode: conflicts > 0 ? 2 : 0 }
}

export function ledgerUpdate(ctx, { to, paths, declined = false, acceptDelete = false }) {
  const ledger = loadLedger(ctx)
  const problems = []
  for (const p of paths) {
    const full = path.join(ctx.root, p)
    const exists = existsSync(full) && statSync(full).isFile()
    if (!exists) {
      if (acceptDelete || declined) continue
      problems.push(`${p}: file does not exist in the fork (use --accept-delete only for a path already removed on purpose)`)
      continue
    }
    const content = readFileSync(full)
    if (!isBinary(content) && hasMarkers(content.toString('utf8'))) problems.push(`${p}: still carries conflict markers`)
  }
  if (problems.length > 0) return { ok: false, problems }
  ledger.paths ??= {}
  ledger.declined ??= {}
  for (const p of paths) {
    const full = path.join(ctx.root, p)
    const exists = existsSync(full) && statSync(full).isFile()
    if (!exists && !declined) {
      delete ledger.paths[p]
      delete ledger.declined[p]
      continue
    }
    if (declined) {
      delete ledger.paths[p]
      ledger.declined[p] = to
    } else {
      delete ledger.declined[p]
      ledger.paths[p] = to
    }
  }
  saveLedger(ctx, ledger)
  return { ok: true, problems: [], updated: paths.length }
}

/** Offline guard: the ledger is well formed and no tracked text file carries conflict markers. */
export function check(ctx) {
  const problems = []
  if (!existsSync(ctx.ledgerFile)) {
    problems.push(`${LEDGER_PATH} is missing`)
    return { ok: false, problems }
  }
  let ledger
  try {
    ledger = JSON.parse(readFileSync(ctx.ledgerFile, 'utf8'))
  } catch (error) {
    problems.push(`${LEDGER_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, problems }
  }
  if (ledger.version !== LEDGER_VERSION) problems.push(`${LEDGER_PATH} version must be ${LEDGER_VERSION}`)
  if (ledger.upstream !== CANONICAL_URL) problems.push(`${LEDGER_PATH} upstream must be ${CANONICAL_URL}`)
  for (const section of ['paths', 'declined']) {
    const object = ledger[section]
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      problems.push(`${LEDGER_PATH} ${section} must be an object`)
      continue
    }
    const keys = Object.keys(object)
    const sorted = [...keys].sort()
    if (keys.some((key, index) => key !== sorted[index])) problems.push(`${LEDGER_PATH} ${section} keys are not sorted`)
    for (const [key, value] of Object.entries(object)) {
      if (typeof value !== 'string' || !SHA_RE.test(value)) problems.push(`${LEDGER_PATH} ${section}.${key} is not a 40-hex commit id`)
      const full = path.join(ctx.root, key)
      if (section === 'paths' && (!existsSync(full) || !statSync(full).isFile())) problems.push(`${LEDGER_PATH} paths names a path that does not exist: ${key}`)
    }
  }
  const tracked = ctx.forkGit(['ls-files', '-z'], { binary: true }).toString('utf8').split('\0').filter(Boolean)
  for (const p of tracked) {
    if (p === 'scripts/port-upstream.test.mjs') continue
    const full = path.join(ctx.root, p)
    if (!existsSync(full) || !statSync(full).isFile()) continue
    const content = readFileSync(full)
    if (isBinary(content)) continue
    if (hasMarkers(content.toString('utf8'))) problems.push(`conflict markers remain in ${p}`)
  }
  return { ok: problems.length === 0, problems }
}

function readPathList(file) {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2)
      if (inline !== undefined) flags[key] = inline
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[key] = argv[++i]
      else flags[key] = true
    } else positional.push(arg)
  }
  return { positional, flags }
}

function printRows(rows, columns) {
  const widths = columns.map((column) => Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length)))
  const line = (row) => columns.map((column, i) => String(row[column] ?? '').padEnd(widths[i])).join('  ')
  console.log(line(Object.fromEntries(columns.map((c) => [c, c]))))
  for (const row of rows) console.log(line(row))
}

function main(argv) {
  const { positional, flags } = parseArgs(argv)
  const [command, sub] = positional
  const ctx = createContext()
  if (command === 'classify') {
    if (!flags.from || !flags.to) throw new Error('classify needs --from <sha> --to <sha>')
    const report = classify(ctx, { from: flags.from, to: flags.to })
    if (flags.json) console.log(JSON.stringify(report, null, 2))
    else {
      printRows(report.rows, ['bucket', 'conflicts', 'path'])
      console.log('')
      for (const [bucket, count] of Object.entries(report.counts).sort()) console.log(`${String(count).padStart(6)}  ${bucket}`)
      console.log(`${String(report.rows.length).padStart(6)}  total (${report.from.slice(0, 7)}..${report.to.slice(0, 7)})`)
    }
    if (flags.out) writeFileSync(flags.out, JSON.stringify(report, null, 2) + '\n')
    return 0
  }
  if (command === 'apply') {
    const paths = flags.paths ? readPathList(flags.paths) : undefined
    if (!paths && !flags.commit) throw new Error('apply needs --paths <file> or --commit <sha>')
    const result = apply(ctx, {
      paths,
      commit: flags.commit,
      from: flags.from,
      to: flags.to ?? CANONICAL_COMMIT,
      write: Boolean(flags.write),
      force: Boolean(flags.force),
      advance: Boolean(flags.advance),
    })
    printRows(
      result.rows.map((row) => ({ ...row, base: row.base ? row.base.slice(0, 7) : '-', written: row.written ? 'yes' : (flags.write ? 'no' : 'dry-run') })),
      ['verdict', 'base', 'written', 'path'],
    )
    console.log(`\n${result.rows.length} paths against ${result.target.slice(0, 7)}; ${result.conflicts} with conflicts${flags.write ? '' : ' (dry run; add --write to apply)'}`)
    return result.exitCode
  }
  if (command === 'ledger' && sub === 'init') {
    if (!flags.at) throw new Error('ledger init needs --at <sha>')
    const result = ledgerInit(ctx, { at: flags.at })
    console.log(`seeded ${result.seeded} paths at ${result.at}`)
    return 0
  }
  if (command === 'ledger' && sub === 'update') {
    if (!flags.to || !flags.paths) throw new Error('ledger update needs --to <sha> --paths <file>')
    const result = ledgerUpdate(ctx, {
      to: flags.to,
      paths: readPathList(flags.paths),
      declined: Boolean(flags.declined),
      acceptDelete: Boolean(flags['accept-delete']),
    })
    for (const problem of result.problems) console.error(`  ! ${problem}`)
    if (result.ok) console.log(`ledger updated for ${result.updated} paths -> ${flags.to}`)
    return result.ok ? 0 : 1
  }
  if (command === 'check') {
    const result = check(ctx)
    for (const problem of result.problems) console.error(`  ! ${problem}`)
    console.log(`upstream port ledger: ${result.ok ? 'ok' : 'invalid'}`)
    return result.ok ? 0 : 1
  }
  console.error('usage: port-upstream.mjs <classify|apply|ledger init|ledger update|check> [options]')
  return 64
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
