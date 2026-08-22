#!/usr/bin/env node

/**
 * Freeze the exact dirty-or-clean working-tree bytes before packaging, then seal those bytes to
 * the generated Windows artifacts afterward. This deliberately does not require a clean checkout:
 * the user's no-Git-mutation acceptance run is bound by the source digest, not by a false claim
 * that HEAD alone describes uncommitted implementation work.
 */
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { parseArgs } from 'node:util'
import { renameAtomicSync } from './lib/rename-atomic.mjs'

const require = createRequire(import.meta.url)
const {
  SOURCE_ROOTS,
  createBuildProvenance,
  createSourceSnapshot,
  isInside
} = require('./windows-profile-packaged-acceptance-core.cjs')

function usage(message) {
  if (message) process.stderr.write(`${message}\n`)
  process.stderr.write(
    'Usage:\n' +
      '  node scripts/write-windows-profile-build-provenance.mjs snapshot --repo <absolute> --head <40-sha> --output <absolute-json>\n' +
      '  node scripts/write-windows-profile-build-provenance.mjs seal --repo <absolute> --snapshot <absolute-json> --output <absolute-json> [artifact overrides]\n'
  )
  process.exit(message ? 1 : 0)
}

const parsed = parseArgs({
  strict: true,
  allowPositionals: true,
  options: {
    repo: { type: 'string' },
    head: { type: 'string' },
    output: { type: 'string' },
    snapshot: { type: 'string' },
    candidate: { type: 'string' },
    'session-host': { type: 'string' },
    setup: { type: 'string' },
    releases: { type: 'string' },
    nupkg: { type: 'string' },
    'app-asar': { type: 'string' },
    'packaged-node-pty': { type: 'string' },
    'out-main': { type: 'string' },
    'out-preload': { type: 'string' },
    'out-renderer': { type: 'string' },
    'out-session-host': { type: 'string' }
  }
})

if (parsed.positionals.length !== 1) usage('Exactly one mode, snapshot or seal, is required.')
const mode = parsed.positionals[0]
if (!['snapshot', 'seal'].includes(mode)) usage(`Unknown mode ${mode}.`)

function absoluteOption(name) {
  const value = parsed.values[name]
  if (typeof value !== 'string' || value.trim() === '' || !path.isAbsolute(value)) {
    usage(`--${name} must be an absolute path.`)
  }
  return path.resolve(value)
}

function optionalAbsolute(name) {
  const value = parsed.values[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '' || !path.isAbsolute(value)) {
    usage(`--${name} must be an absolute path.`)
  }
  return path.resolve(value)
}

function writeExclusiveAtomic(output, value) {
  if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing provenance file ${output}.`)
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const temporary = `${output}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    renameAtomicSync(temporary, output)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // Retain the primary write failure.
    }
    throw error
  }
}

try {
  const repoRoot = absoluteOption('repo')
  const output = absoluteOption('output')
  for (const sourceRoot of SOURCE_ROOTS) {
    if (isInside(path.join(repoRoot, sourceRoot), output)) {
      throw new Error(`Provenance output may not mutate snapshotted source root ${sourceRoot}.`)
    }
  }
  if (mode === 'snapshot') {
    const forbidden = [
      'snapshot',
      'candidate',
      'session-host',
      'setup',
      'releases',
      'nupkg',
      'app-asar',
      'packaged-node-pty',
      'out-main',
      'out-preload',
      'out-renderer',
      'out-session-host'
    ].filter((name) => parsed.values[name] !== undefined)
    if (forbidden.length) usage(`snapshot mode does not accept: ${forbidden.map((name) => `--${name}`).join(', ')}`)
    const source = createSourceSnapshot(repoRoot, parsed.values.head)
    writeExclusiveAtomic(output, source)
    process.stdout.write(
      `${JSON.stringify({ ok: true, mode, gitHead: source.gitHead, workingTreeDigest: source.workingTreeDigest, files: source.files.length })}\n`
    )
  } else {
    if (parsed.values.head !== undefined) usage('seal mode reads HEAD from --snapshot and does not accept --head.')
    const snapshotFile = absoluteOption('snapshot')
    const sourceSnapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'))
    const provenance = createBuildProvenance({
      repoRoot,
      sourceSnapshot,
      expectedCommit: sourceSnapshot.gitHead,
      candidate: optionalAbsolute('candidate'),
      sessionHost: optionalAbsolute('session-host'),
      setup: optionalAbsolute('setup'),
      releases: optionalAbsolute('releases'),
      nupkg: optionalAbsolute('nupkg'),
      appAsar: optionalAbsolute('app-asar'),
      packagedNodePty: optionalAbsolute('packaged-node-pty'),
      outMain: optionalAbsolute('out-main'),
      outPreload: optionalAbsolute('out-preload'),
      outRenderer: optionalAbsolute('out-renderer'),
      outSessionHost: optionalAbsolute('out-session-host')
    })
    writeExclusiveAtomic(output, provenance)
    process.stdout.write(
      `${JSON.stringify({ ok: true, mode, gitHead: provenance.source.gitHead, workingTreeDigest: provenance.source.workingTreeDigest, artifacts: provenance.artifacts.length })}\n`
    )
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}

