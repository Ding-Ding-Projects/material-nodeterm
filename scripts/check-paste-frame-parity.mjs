#!/usr/bin/env node
// Drift guard for the vendored paste-frame duplicate.
//
// material-nodeterm is a public repository; agent-whip's `@agent-whip/paste-frame` package is
// not published to any registry. A `file:`-protocol dependency would resolve on the machine
// that authored it and dangle (silent-green install, ERR_MODULE_NOT_FOUND at runtime) for
// anyone who clones this repo on its own. So the implementation is vendored here as a real
// file, `src/core/paste-injection.ts`, deliberately duplicating
// `agent-whip/packages/paste-frame/src/index.ts` from a sibling checkout.
//
// This script is the mitigation for that duplication, not the fix. It makes the drift LOUD
// instead of removing it: whenever both checkouts are present on the same machine, it compares
// the two implementations' normative content (comments and formatting stripped) and fails when
// they disagree. It skips cleanly — printing why — when the sibling checkout is absent, so a
// standalone clone of this repo still builds.
//
// The real fix is publishing @agent-whip/paste-frame to a registry once rights exist; at that
// point this file, the vendored copy, and this guard are all deleted in favor of one dependency.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const LOCAL_PATH = path.join(repoRoot, 'src', 'core', 'paste-injection.ts')
const SIBLING_REPO = path.resolve(repoRoot, '..', 'agent-whip')
const SIBLING_PATH = path.join(SIBLING_REPO, 'packages', 'paste-frame', 'src', 'index.ts')

/** Strip //-comments and /* *\/-comments while respecting string/template literals. */
function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  let inString = null // one of ' " ` or null
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (inString) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (c === inString) inString = null
      i += 1
      continue
    }
    if (c === '\'' || c === '"' || c === '`') {
      inString = c
      out += c
      i += 1
      continue
    }
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i += 1
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** Collapse formatting differences (semicolons, whitespace, blank lines) that carry no meaning. */
function normalize(src) {
  return stripComments(src)
    .replace(/\r\n/g, '\n')
    .replace(/;/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

function main() {
  if (!existsSync(SIBLING_REPO)) {
    console.log(
      `check-paste-frame-parity: SKIP — sibling checkout not found at ${SIBLING_REPO}. ` +
        'Cannot verify src/core/paste-injection.ts stays in step with ' +
        '@agent-whip/paste-frame; this is expected for a standalone clone of this repo.'
    )
    return
  }

  if (!existsSync(SIBLING_PATH)) {
    console.error(
      `check-paste-frame-parity: FAIL — sibling checkout is present at ${SIBLING_REPO} but ` +
        `its expected source file is missing: ${SIBLING_PATH}. Cannot verify parity.`
    )
    process.exit(1)
  }

  const localRaw = readFileSync(LOCAL_PATH, 'utf8')
  const siblingRaw = readFileSync(SIBLING_PATH, 'utf8')
  const localNorm = normalize(localRaw)
  const siblingNorm = normalize(siblingRaw)

  if (localNorm === siblingNorm) {
    console.log(
      'check-paste-frame-parity: PASS — ' +
        `${path.relative(repoRoot, LOCAL_PATH)} matches ` +
        `${SIBLING_PATH} (normalized: comments/semicolons/blank-lines stripped).`
    )
    return
  }

  console.error('check-paste-frame-parity: FAIL — the vendored paste-frame copy has drifted.')
  console.error(`  local:   ${LOCAL_PATH}`)
  console.error(`  sibling: ${SIBLING_PATH}`)
  console.error('')
  console.error('--- normalized local ---')
  console.error(localNorm)
  console.error('--- normalized sibling ---')
  console.error(siblingNorm)
  console.error('')
  const localLines = localNorm.split('\n')
  const siblingLines = siblingNorm.split('\n')
  const max = Math.max(localLines.length, siblingLines.length)
  for (let i = 0; i < max; i += 1) {
    if (localLines[i] !== siblingLines[i]) {
      console.error(`first differing line (${i + 1}):`)
      console.error(`  local:   ${localLines[i] ?? '<missing>'}`)
      console.error(`  sibling: ${siblingLines[i] ?? '<missing>'}`)
      break
    }
  }
  process.exit(1)
}

main()
