#!/usr/bin/env node
/**
 * check-instruction-mirror.mjs — the sanitized instruction-mirror guard.
 *
 * Two contracts, both fail-closed:
 *
 *  1. BOTH `README.md` and `AGENTS.md` carry a clearly-labelled, sanitized mirror of the shared
 *     working conventions. "Clearly labelled" means the literal mirror label ("mirror, not a
 *     source" + "sanitized summary") so nobody edits the copy expecting the change to propagate,
 *     and each file must still carry every section named in the HAND-WRITTEN marker list below —
 *     a guard that only validates whatever sections it happens to find cannot notice one that
 *     disappeared entirely.
 *
 *  2. Neither file may leak a private machine/account/infrastructure detail. This repository is
 *     public, so an IP-address literal, a Windows/POSIX user-profile path naming a real account,
 *     a literal `ssh user@host` target, or a credential-shaped token in either file is a leak —
 *     the checker fails on the PATTERN so the mirror cannot rot into a leak later, whoever
 *     writes the next revision.
 *
 * Usage:
 *   node scripts/check-instruction-mirror.mjs             # checks this repository
 *   node scripts/check-instruction-mirror.mjs <repoRoot>  # checks another root (used by tests)
 *
 * Exit 0 when both files carry the labelled mirror and no leak pattern matches; exit 1 with
 * every problem listed (file, line, matched text, reason) otherwise.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  checkManagedInstructionMirror,
  loadCanonicalVocabularyValidator
} from './sync-agent-instruction-mirror.mjs'

// Hand-written per-file marker list. Every entry is a literal substring the file must contain.
// The first two are the mirror label itself; the rest are the convention sections the sanitized
// mirror must keep carrying. Add to this list when the mirror grows a section — never let the
// checker infer the list from whichever headings currently exist.
const MIRROR_MARKERS = [
  'mirror, not a source',
  'sanitized summary',
  'Process boundaries are enforced',
  'three surfaces',
  'House rules',
  'Testing',
  'Git and commit conventions',
  'Security boundaries'
]

const MIRROR_FILES = ['README.md', 'AGENTS.md']
const LEAK_SCAN_FILES = ['README.md', 'AGENTS.md', 'CLAUDE.md']

// Private-detail leak patterns. Each is scanned over EVERY line of BOTH files (not only the
// mirror section — a leak elsewhere in a public README is exactly as public). `allowed` names
// the deliberate exceptions; everything else that matches is a failure.
const LEAK_PATTERNS = [
  {
    name: 'IP address literal (a LAN/remote host inventory entry has no place in a public file)',
    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    // Loopback and the any-address are protocol facts, not somebody's host inventory.
    allowed: (m) => m === '0.0.0.0' || m.startsWith('127.')
  },
  {
    name: 'Windows user-profile path (an OS username is a private machine detail)',
    re: /[A-Za-z]:\\Users\\[^\\\s"'`<>|)\]]+/g,
    // An environment-variable placeholder names no one.
    allowed: (m) => /%[A-Za-z_]+%$/.test(m)
  },
  {
    name: 'POSIX home directory naming a user',
    re: /(?:\/home|\/Users)\/[A-Za-z][A-Za-z0-9._-]*/g,
    // Generic placeholder words are documentation, not an account name.
    allowed: (m) => /\/(?:you|user|username|yourname|example)$/i.test(m)
  },
  {
    name: 'literal ssh target (user@host)',
    re: /\bssh\s+(?:-\w+\s+)*[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g,
    allowed: () => false
  },
  {
    name: 'credential/token shape',
    re: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    allowed: () => false
  }
]

/** Pure check over a repository root. Returns { problems: [{file, line, reason, detail}] } —
 *  empty problems means both files carry the labelled mirror and nothing leak-shaped matched. */
export function checkInstructionMirror(repoRoot) {
  const problems = []

  for (const file of MIRROR_FILES) {
    const abs = path.join(repoRoot, file)
    if (!existsSync(abs)) {
      problems.push({ file, line: 0, reason: 'missing file', detail: `${file} does not exist` })
      continue
    }
    const text = readFileSync(abs, 'utf8')

    for (const marker of MIRROR_MARKERS) {
      if (!text.includes(marker)) {
        problems.push({
          file,
          line: 0,
          reason: 'mirror marker missing',
          detail: `required mirror marker not found: ${JSON.stringify(marker)}`
        })
      }
    }

  }

  // Privacy scanning covers every public instruction target, not only the two
  // files that retain the older concise-summary marker contract.
  for (const file of LEAK_SCAN_FILES) {
    const abs = path.join(repoRoot, file)
    if (!existsSync(abs)) continue
    const lines = readFileSync(abs, 'utf8').split(/\r\n|\n|\r/)
    for (let i = 0; i < lines.length; i++) {
      for (const { name, re, allowed } of LEAK_PATTERNS) {
        // A fresh lastIndex per line: the shared regex objects carry /g state.
        re.lastIndex = 0
        let m
        while ((m = re.exec(lines[i])) !== null) {
          if (allowed(m[0])) continue
          problems.push({
            file,
            line: i + 1,
            reason: name,
            detail: m[0]
          })
        }
      }
    }
  }

  const managed = checkManagedInstructionMirror(repoRoot)
  for (const detail of managed.problems) {
    const file = detail.startsWith('CLAUDE.md') ? 'CLAUDE.md' : 'AGENTS.md'
    problems.push({ file, line: 0, reason: 'managed instruction mirror', detail })
  }

  return { problems }
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = process.argv[2] ?? path.join(here, '..')
  const { problems } = checkInstructionMirror(repoRoot)
  const canonical = await loadCanonicalVocabularyValidator(repoRoot)
  if (canonical) {
    const { bodies } = checkManagedInstructionMirror(repoRoot)
    for (const [file, body] of bodies) {
      const leaks = canonical.validate(body)
      if (leaks.length > 0) {
        problems.push({ file, line: 0, reason: 'private vocabulary', detail: leaks.join(', ') })
      }
    }
  }
  if (problems.length > 0) {
    console.error(`check-instruction-mirror: FAILED — ${problems.length} problem(s):`)
    for (const p of problems) {
      console.error(`  ${p.file}:${p.line} — ${p.reason}: ${p.detail}`)
    }
    process.exitCode = 1
    return
  }
  console.log(
    `check-instruction-mirror: OK — README.md and AGENTS.md carry the labelled summary; AGENTS.md and CLAUDE.md carry one identical complete managed block; no private-detail leak pattern matched.`
  )
  if (!canonical) {
    console.warn('check-instruction-mirror: SKIP — canonical private-vocabulary source is unavailable; public-detail and structural checks passed, but vocabulary currentness was not verified.')
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) await main()
