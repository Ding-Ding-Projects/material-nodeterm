/**
 * One implementation of fixture teardown, enforced by scan.
 *
 * `fs.rmSync`'s retries are synchronous: they block the event loop, so they cannot let in-flight
 * async work in this same process release what it holds. That was diagnosed once, written up in
 * `server-e2e.test.ts`, and fixed there alone -- so seven sibling suites kept the synchronous
 * call and kept failing under load, and one of them failed a full-suite run months later with
 * both its tests green and no message, because a throwing `afterAll` fails a FILE rather than a
 * test. A comment in one file is not a mechanism; this is.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Anchored to the call, not the bare name: a substring needle matches inside a comment, inside a
 *  renamed symbol, and inside a line somebody commented out -- three ways a guard silently stops
 *  guarding, all of which this repository has actually shipped. */
const SYNC_REMOVE = /(^|[^\w.])fs\s*\.\s*rmSync\s*\(/

/** The permitted exceptions, each with the reason it is one. Anything else must use the helper. */
const ALLOWED = new Map<string, string>([
  // Asserts on cleanup behaviour itself rather than using it for teardown.
  ['hook-install-guard.test.ts', 'the subject under test is removal, not a fixture teardown']
])

function serverTestFiles(): string[] {
  return fs
    .readdirSync(HERE)
    .filter((f) => f.endsWith('.test.ts') && f !== 'fixture-cleanup.guard.test.ts')
}

describe('server e2e fixture teardown', () => {
  it('never uses the synchronous remove, which cannot release what this process still holds', () => {
    const offenders = serverTestFiles().filter((file) => {
      if (ALLOWED.has(file)) return false
      return fs
        .readFileSync(path.join(HERE, file), 'utf8')
        .split(/\r?\n/)
        .some((line) => SYNC_REMOVE.test(line))
    })
    expect(offenders).toEqual([])
  })

  it('finds real files to check, so an empty pass cannot mean an empty search', () => {
    // A rule-shaped guard passes vacuously on a directory it failed to read. The count is the
    // tripwire: it is not a target, only proof the scan looked at something.
    expect(serverTestFiles().length).toBeGreaterThan(8)
  })

  it('the helper itself is the one place that removes a fixture directory', () => {
    const helper = fs.readFileSync(path.join(HERE, 'fixture-cleanup.ts'), 'utf8')
    expect(helper).toMatch(/await fs\.promises\.rm\(/)
    // The catch is a net rather than a shortcut: a teardown must never fail a test that passed.
    expect(helper).toMatch(/catch \(error\)/)
  })
})
