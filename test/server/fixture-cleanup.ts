/**
 * Remove a server-e2e fixture directory without ever failing the run.
 *
 * `fs.rmSync`'s retries are SYNCHRONOUS: they block the event loop, so they cannot let in-flight
 * async work in this same process finish and release what it holds -- the retry loop waits for the
 * very thing it is itself preventing. The holder is a mirror publication, which opens
 * `agent-status.json.publication.sqlite3` under the fixture directory inside a BEGIN IMMEDIATE
 * transaction, and nothing awaits that flush.
 *
 * That was diagnosed once, in `server-e2e.test.ts`, and fixed there alone -- so seven sibling
 * suites kept the synchronous call and kept failing under load. This is the shape this repository
 * names explicitly: one file documents a trap and none of the others know. Hence one helper.
 *
 * The catch is a net, not a shortcut. A teardown must never fail a test that passed: a fixture
 * directory left in the OS temp area is strictly less bad than a red suite that hides a real one.
 * On the async path it should be silent, so a warning here is worth reading.
 */
import fs from 'fs'

export async function removeFixtureDir(dir: string | undefined, label: string): Promise<void> {
  if (!dir) return
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  } catch (error) {
    console.warn(
      `[${label}] fixture directory outlived the run and could not be removed: ${dir}
` +
        `  ${String(error)}
` +
        '  The assertions above still passed; this is a resource-release signal, not a failure ' +
        'of the behaviour under test.'
    )
  }
}
