#!/usr/bin/env node
// scripts/check-vocabulary.mjs
//
// Refuse to build or publish from a checkout whose author does not have the current shared
// working dictionary.
//
//   node scripts/check-vocabulary.mjs
//
// WHY THIS FILE CONTAINS NEITHER THE DICTIONARY NOR ITS HASH
//
// The obvious way to check "are the shared terms current" is to list them and compare. That is
// exactly wrong here: this repository is PUBLIC, the terms are private working vocabulary, and
// committing them is the one leak the whole convention exists to prevent. A guard that enforces
// privacy by publishing the private thing has defeated itself.
//
// The second-most-obvious way is to commit a SHA-256 of them. Better — a digest cannot be read
// backwards — but still wrong, for a different reason: a pinned digest goes stale the moment a
// term is added, so it decays into a number somebody bumps to turn a red build green. A ritual,
// not a check.
//
// So nothing is stored here at all. The lock is DERIVED from the private dictionary at run time
// and compared against a lock file that lives beside it, outside this repository. What is
// committed here is the method; every value stays private.
//
// WHAT IT ACTUALLY PROVES, AND WHAT IT CANNOT
//
// It proves the private source is present and current on this machine. It CANNOT read anybody's
// prose, so it cannot verify that the vocabulary was actually used in conversation — no build
// step can. Claiming otherwise would be the decorative-check problem this codebase keeps finding:
// a gate that looks like it enforces something it never examines.
//
// What it does is make the dictionary a real precondition rather than a thing one is supposed to
// remember. You cannot ship from a machine that has not got it, and you cannot ship against a
// stale copy — which is the failure that actually happens, because a dictionary grows and a
// checkout made last week was made against a shorter one.
//
// FAILS OPEN IN EXACTLY ONE CASE, DELIBERATELY
//
// A contributor who is not part of that working arrangement has no private source and never will.
// Blocking them from building a public project would be absurd, so absence of the whole source
// tree is a SKIP with a printed reason. What is refused is the state that means something went
// wrong: the source is present but its digest does not match, i.e. a stale or edited copy.
//
// Set NODETERM_VOCAB_SOURCE to point at the private file if it does not sit in the usual place.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * THE LOCK IS NEVER WRITTEN DOWN HERE.
 *
 * An earlier version of this file carried the expected digest as a literal. That was wrong twice
 * over. A committed digest goes stale the moment a term is added, so it becomes a number people
 * bump to make a red build green — a ritual rather than a check. And a value pinned in a public
 * repository invites exactly the copy-paste that lets a checkout claim currency it does not have.
 *
 * Instead the lock is DERIVED from the dictionary at run time and compared against a lock file
 * that lives beside the private source, never here. So this public repository holds no digest at
 * all: not in a script, not in a doc, not in the instructions. What it holds is the method.
 *
 * The consequence worth stating plainly: a checkout can only build if the private dictionary is
 * present AND its derived lock matches what the private side recorded. Edit the dictionary
 * without re-locking it and everything refuses — which is the point, because a dictionary that
 * grew without anyone noticing is precisely the failure this guards.
 */
const LOCK_FILE = '.vocab-lock'

/** Where the private source usually lives, relative to this checkout's parent. Never committed
 *  here, never fetched, never printed — only read locally and hashed. */
const CANDIDATES = [
  process.env.NODETERM_VOCAB_SOURCE,
  join(ROOT, '..', 'agent-global-memory', 'memory', 'SHARED_INSTRUCTIONS.md'),
  join(homedir(), 'Documents', 'GitHub', 'agent-global-memory', 'memory', 'SHARED_INSTRUCTIONS.md'),
].filter(Boolean)

/** Section bounds. Headings, not terms — naming the section is not naming its contents. */
const START = '## Vocabulary and locations'
const END = '## Secrets and sensitive input'

function digestOf(file) {
  const text = readFileSync(file, 'utf8')
  const i = text.indexOf(START)
  const j = text.indexOf(END)
  if (i < 0 || j <= i) return null
  // Normalise line endings before hashing. Without this the same content hashes differently on a
  // CRLF checkout than an LF one, and the guard would fail for reasons that have nothing to do
  // with the dictionary — a trap this repository has hit repeatedly in other scans.
  return createHash('sha256').update(text.slice(i, j).replace(/\r\n/g, '\n')).digest('hex')
}

const source = CANDIDATES.find((p) => existsSync(p))

if (!source) {
  console.log('• vocabulary check skipped: the private source is not on this machine')
  console.log('  (expected for an outside contributor — nothing to do)')
  process.exit(0)
}

const actual = digestOf(source)

if (actual === null) {
  console.error('✗ vocabulary lock: the section markers were not found in the private source.')
  console.error('  Either it was restructured, or NODETERM_VOCAB_SOURCE points at the wrong file.')
  process.exit(1)
}

const lockPath = join(dirname(source), LOCK_FILE)

if (process.argv.includes('--relock')) {
  // Writes the derived lock beside the PRIVATE source. Never into this repository, and never
  // into any instruction file — the whole design is that the value exists only where the thing
  // it describes already lives.
  writeFileSync(lockPath, `${actual}\n`, 'utf8')
  console.log(`✓ re-locked: ${lockPath}`)
  process.exit(0)
}

if (!existsSync(lockPath)) {
  console.error('')
  console.error('✗ Refused: the dictionary is present but has never been locked.')
  console.error('')
  console.error('  Read it, then run:  node scripts/check-vocabulary.mjs --relock')
  console.error('')
  console.error('  The lock is written beside the private source, never in this repository — so a')
  console.error('  public checkout carries the method and no value at all.')
  console.error('')
  process.exit(1)
}

const expected = readFileSync(lockPath, 'utf8').trim()

if (actual !== expected) {
  console.error('')
  console.error('✗ Refused: the dictionary has changed since it was last locked.')
  console.error('')
  console.error('  That almost always means terms were added mid-session — which is exactly the')
  console.error('  state this refuses to ship from, because nobody has re-read the new ones.')
  console.error('')
  console.error('  Re-read it, then:  node scripts/check-vocabulary.mjs --relock')
  console.error('')
  process.exit(1)
}

console.log('✓ vocabulary lock: dictionary present, locked and current')
process.exit(0)
