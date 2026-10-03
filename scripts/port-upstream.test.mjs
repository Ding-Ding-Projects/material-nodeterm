import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  LEDGER_PATH,
  apply,
  check,
  classify,
  createContext,
  ledgerInit,
  ledgerUpdate,
  loadLedger,
} from './port-upstream.mjs'

const roots = []

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function initRepo(dir) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'fixture')
  git(dir, 'config', 'user.email', 'fixture@example.invalid')
  git(dir, 'config', 'commit.gpgsign', 'false')
}

function commitAll(dir, message) {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}

function write(dir, file, content) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  writeFileSync(path.join(dir, file), content)
}

const CONFLICT_OPEN = '<'.repeat(7)
const CONFLICT_CLOSE = '>'.repeat(7)

/**
 * Upstream: c1 (a, b, shared, same) -> c2 (a edited, new.txt added, b deleted) -> c3 (shared bottom edited).
 * Fork: a copy of c1 (no shared history) with its own edits to a (same region as c2) and shared (top).
 */
function fixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), 'port-upstream-'))
  roots.push(base)
  const upstream = path.join(base, 'upstream')
  const fork = path.join(base, 'fork')
  initRepo(upstream)
  write(upstream, 'a.txt', 'alpha 1\nalpha 2\nalpha 3\n')
  write(upstream, 'b.txt', 'bravo\n')
  write(upstream, 'shared.txt', 'top 1\ntop 2\nmiddle\nbottom 1\nbottom 2\n')
  write(upstream, 'same.txt', 'unchanged\n')
  const c1 = commitAll(upstream, 'c1')
  write(upstream, 'a.txt', 'alpha 1\nalpha 2 upstream\nalpha 3\n')
  write(upstream, 'new.txt', 'brand new\n')
  rmSync(path.join(upstream, 'b.txt'))
  const c2 = commitAll(upstream, 'c2')
  write(upstream, 'shared.txt', 'top 1\ntop 2\nmiddle\nbottom 1 upstream\nbottom 2\n')
  const c3 = commitAll(upstream, 'c3')

  initRepo(fork)
  for (const file of ['a.txt', 'b.txt', 'shared.txt', 'same.txt']) {
    write(fork, file, git(upstream, 'show', `${c1}:${file}`) + '\n')
  }
  write(fork, 'fork-only.txt', 'only here\n')
  commitAll(fork, 'import')
  write(fork, 'a.txt', 'alpha 1\nalpha 2 fork\nalpha 3\n')
  write(fork, 'shared.txt', 'top 1 fork\ntop 2\nmiddle\nbottom 1\nbottom 2\n')
  commitAll(fork, 'fork edits')
  const ctx = createContext({ root: fork, upstreamDir: upstream })
  return { upstream, fork, ctx, c1, c2, c3 }
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true })
})

describe('port-upstream', () => {
  it('classifies every differing path into the right bucket', () => {
    const { ctx, c1, c3 } = fixture()
    const report = classify(ctx, { from: c1, to: c3 })
    const bucket = Object.fromEntries(report.rows.map((row) => [row.path, row.bucket]))
    expect(bucket['new.txt']).toBe('new')
    expect(bucket['b.txt']).toBe('deleted-upstream')
    expect(bucket['shared.txt']).toBe('merge-clean')
    expect(bucket['a.txt']).toBe('conflict')
    expect(bucket['same.txt']).toBeUndefined()
    expect(report.counts).toEqual({ new: 1, 'deleted-upstream': 1, 'merge-clean': 1, conflict: 1 })
  })

  it('apply --write merges, copies, reports a deletion untouched, keeps conflict markers, and a dry run writes nothing', () => {
    const { ctx, fork, c1, c3 } = fixture()
    ledgerInit(ctx, { at: c1 })
    const paths = ['shared.txt', 'new.txt', 'b.txt', 'a.txt']
    const before = Object.fromEntries(paths.filter((p) => existsSync(path.join(fork, p))).map((p) => [p, readFileSync(path.join(fork, p), 'utf8')]))
    const dry = apply(ctx, { paths, to: c3, force: true })
    expect(dry.exitCode).toBe(2)
    for (const [p, content] of Object.entries(before)) expect(readFileSync(path.join(fork, p), 'utf8')).toBe(content)
    expect(existsSync(path.join(fork, 'new.txt'))).toBe(false)
    expect(readFileSync(path.join(fork, 'scripts', 'upstream-port-ledger.json'), 'utf8')).not.toContain('.tmp')

    const result = apply(ctx, { paths, to: c3, write: true, force: true })
    const verdict = Object.fromEntries(result.rows.map((row) => [row.path, row.verdict]))
    expect(verdict['shared.txt']).toBe('merged')
    expect(readFileSync(path.join(fork, 'shared.txt'), 'utf8')).toBe('top 1 fork\ntop 2\nmiddle\nbottom 1 upstream\nbottom 2\n')
    expect(verdict['new.txt']).toBe('new')
    expect(readFileSync(path.join(fork, 'new.txt'), 'utf8')).toBe('brand new\n')
    expect(verdict['b.txt']).toBe('deleted-upstream')
    expect(existsSync(path.join(fork, 'b.txt'))).toBe(true)
    expect(verdict['a.txt']).toMatch(/^conflict \(\d+\)$/)
    const merged = readFileSync(path.join(fork, 'a.txt'), 'utf8')
    expect(merged).toContain(`${CONFLICT_OPEN} fork`)
    expect(merged).toContain(`${CONFLICT_CLOSE} upstream ${c3.slice(0, 7)}`)
    expect(result.exitCode).toBe(2)
  })

  it('cherry-picks one upstream commit against its parent and leaves the ledger alone without --advance', () => {
    const { ctx, fork, c1, c3 } = fixture()
    ledgerInit(ctx, { at: c1 })
    const pick = apply(ctx, { commit: c3, write: true, force: true })
    const verdict = Object.fromEntries(pick.rows.map((row) => [row.path, row.verdict]))
    expect(Object.keys(verdict)).toEqual(['shared.txt'])
    expect(verdict['shared.txt']).toBe('merged')
    expect(readFileSync(path.join(fork, 'shared.txt'), 'utf8')).toBe('top 1 fork\ntop 2\nmiddle\nbottom 1 upstream\nbottom 2\n')
    expect(loadLedger(ctx).paths['shared.txt']).toBe(c1)
    const range = apply(ctx, { paths: ['shared.txt'], to: c3, write: true, force: true })
    expect(range.rows[0].verdict).toBe('unchanged')
    expect(range.exitCode).toBe(0)
  })

  it('ledger update advances clean paths and refuses a path that still carries markers', () => {
    const { ctx, fork, c1, c3 } = fixture()
    ledgerInit(ctx, { at: c1 })
    apply(ctx, { paths: ['shared.txt', 'a.txt'], to: c3, write: true, force: true })
    const bytesBefore = readFileSync(ctx.ledgerFile, 'utf8')
    const refused = ledgerUpdate(ctx, { to: c3, paths: ['a.txt'] })
    expect(refused.ok).toBe(false)
    expect(refused.problems[0]).toContain('conflict markers')
    expect(readFileSync(ctx.ledgerFile, 'utf8')).toBe(bytesBefore)
    const ok = ledgerUpdate(ctx, { to: c3, paths: ['shared.txt'] })
    expect(ok.ok).toBe(true)
    expect(loadLedger(ctx).paths['shared.txt']).toBe(c3)
    const declined = ledgerUpdate(ctx, { to: c3, paths: ['never-taken.txt'], declined: true })
    expect(declined.ok).toBe(true)
    expect(loadLedger(ctx).declined['never-taken.txt']).toBe(c3)
    const guarded = check(ctx)
    expect(guarded.ok).toBe(false)
    expect(guarded.problems).toEqual(['conflict markers remain in a.txt'])
  })

  it('check is green on a healthy tree and red for a missing ledger path or a marker-bearing tracked file', () => {
    const { ctx, fork, c1 } = fixture()
    ledgerInit(ctx, { at: c1 })
    expect(check(ctx)).toEqual({ ok: true, problems: [] })

    const ledger = loadLedger(ctx)
    ledger.paths['ghost.txt'] = c1
    writeFileSync(ctx.ledgerFile, JSON.stringify(ledger, null, 2))
    const missing = check(ctx)
    expect(missing.ok).toBe(false)
    expect(missing.problems.some((p) => p.includes('ghost.txt'))).toBe(true)
    delete ledger.paths['ghost.txt']
    writeFileSync(ctx.ledgerFile, JSON.stringify(ledger, null, 2))
    expect(check(ctx).ok).toBe(true)

    write(fork, 'same.txt', `${CONFLICT_OPEN} fork\nours\n=======\ntheirs\n${CONFLICT_CLOSE} upstream\n`)
    git(fork, 'add', 'same.txt')
    const markers = check(ctx)
    expect(markers.ok).toBe(false)
    expect(markers.problems).toContain('conflict markers remain in same.txt')
    expect(LEDGER_PATH).toBe('scripts/upstream-port-ledger.json')
  })
})
