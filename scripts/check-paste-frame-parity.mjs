#!/usr/bin/env node
// Drift guard for the deliberately vendored paste-frame sanitizer contract.
//
// The canonical sibling package still exports JS-side `bracketedInjection` and
// `legacyInjection`. nodeterm deliberately does not: tmux 3.7 escapes ESC bytes supplied in a
// paste buffer, rendering those frames as visible text. tmux now owns framing through
// `paste-buffer -p`; restoring either helper would regress delivery. The shared contract is
// therefore exactly PASTE_START, PASTE_END, and sanitizePasteText.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const LOCAL_PATH = path.join(repoRoot, 'src', 'core', 'paste-injection.ts')
const CANONICAL_SIBLING_REPO = path.resolve(repoRoot, '..', '..', 'agent-whip')
const FALLBACK_SIBLING_REPO = path.resolve(repoRoot, '..', 'agent-whip')
const SIBLING_RELATIVE_PATH = path.join('packages', 'paste-frame', 'src', 'index.ts')

const SHARED_EXPORTS = ['PASTE_END', 'PASTE_START', 'sanitizePasteText']
const INTENTIONALLY_EXCLUDED_SIBLING_EXPORTS = ['bracketedInjection', 'legacyInjection']
const PAYLOADS = [
  '',
  'ordinary text',
  'line one\nline two\r\n\tindented',
  '\x1b[200~nested\x1b[201~',
  '\x1b[201~\rctrl-u\x15',
  'C1:\u009b201~',
  'trailing\x1b'
]

function siblingRepo() {
  for (const candidate of [CANONICAL_SIBLING_REPO, FALLBACK_SIBLING_REPO]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

async function loadTypeScriptModule(sourcePath) {
  const source = readFileSync(sourcePath, 'utf8')
  const { code } = esbuild.transformSync(source, { loader: 'ts', format: 'esm', target: 'node18' })
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

export function sharedContractProblems(localModule, siblingModule) {
  const problems = []
  const localExports = Object.keys(localModule).sort()
  const siblingExports = Object.keys(siblingModule).sort()
  const expectedLocal = [...SHARED_EXPORTS].sort()
  const expectedSibling = [...SHARED_EXPORTS, ...INTENTIONALLY_EXCLUDED_SIBLING_EXPORTS].sort()

  if (JSON.stringify(localExports) !== JSON.stringify(expectedLocal)) {
    problems.push(`local export set changed: expected ${expectedLocal.join(', ')}, got ${localExports.join(', ') || '<none>'}`)
  }
  if (JSON.stringify(siblingExports) !== JSON.stringify(expectedSibling)) {
    problems.push(`canonical sibling export set changed: expected ${expectedSibling.join(', ')}, got ${siblingExports.join(', ') || '<none>'}`)
  }
  for (const name of SHARED_EXPORTS) {
    if (!(name in localModule)) problems.push(`local module is missing shared export ${name}`)
    if (!(name in siblingModule)) problems.push(`canonical sibling module is missing shared export ${name}`)
  }
  if (localModule.PASTE_START !== siblingModule.PASTE_START) problems.push('PASTE_START differs from the canonical sibling')
  if (localModule.PASTE_END !== siblingModule.PASTE_END) problems.push('PASTE_END differs from the canonical sibling')
  if (typeof localModule.sanitizePasteText !== 'function' || typeof siblingModule.sanitizePasteText !== 'function') {
    problems.push('sanitizePasteText must be a function in both modules')
    return problems
  }
  for (const payload of PAYLOADS) {
    const local = localModule.sanitizePasteText(payload)
    const sibling = siblingModule.sanitizePasteText(payload)
    if (local !== sibling) problems.push(`sanitizePasteText differs for payload ${JSON.stringify(payload)}`)
    if (/[\x1b\u009b]/.test(local)) problems.push(`local sanitizePasteText leaves structural control bytes in ${JSON.stringify(payload)}`)
  }
  return problems
}

export async function checkPasteFrameParity({ localPath = LOCAL_PATH, siblingPath } = {}) {
  const sibling = siblingPath ? undefined : siblingRepo()
  const resolvedSiblingPath = siblingPath ?? (sibling && path.join(sibling, SIBLING_RELATIVE_PATH))
  if (!resolvedSiblingPath) {
    return { skipped: true, message: 'sibling checkout not found; standalone clone cannot compare the vendored sanitizer contract' }
  }
  if (!existsSync(resolvedSiblingPath)) {
    return { problems: [`canonical sibling source is missing: ${resolvedSiblingPath}`] }
  }
  const [localModule, siblingModule] = await Promise.all([loadTypeScriptModule(localPath), loadTypeScriptModule(resolvedSiblingPath)])
  return { problems: sharedContractProblems(localModule, siblingModule), siblingPath: resolvedSiblingPath }
}

async function main() {
  const result = await checkPasteFrameParity()
  if (result.skipped) {
    console.log(`check-paste-frame-parity: SKIP — ${result.message}`)
    return
  }
  if (result.problems.length) {
    console.error('check-paste-frame-parity: FAIL — the shared sanitizer contract has drifted.')
    for (const problem of result.problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }
  console.log(`check-paste-frame-parity: PASS — ${path.relative(repoRoot, LOCAL_PATH)} matches the shared sanitizer contract in ${result.siblingPath}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('check-paste-frame-parity: FAIL —', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
