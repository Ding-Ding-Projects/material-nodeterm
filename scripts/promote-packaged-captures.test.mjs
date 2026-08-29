/**
 * Behaviour tests for the packaged-capture promotion door.
 *
 * These run against REAL temp directories and REAL bytes rather than a mocked filesystem, because
 * the whole value of this script is that it opens files it was told about and disbelieves the
 * metadata. A test whose filesystem always agrees with the manifest cannot prove that.
 *
 * The happy-path test additionally asserts the emitted manifest against the four conditions
 * `check-app-contract.mjs`'s `requireCaptureEvidence` actually checks. Asserting our own shape back
 * to ourselves would pass while the contract still rejected the file.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  MIN_CAPTURE_BYTES,
  PNG_SIGNATURE,
  REQUIRED_METHOD_NEEDLE,
  Refusal,
  promote,
} from './promote-packaged-captures.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const REQUIRED_IDS = [
  'windows-terminal-profile-picker',
  'windows-terminal-profile-terminal',
  'windows-terminal-profile-unavailable',
  'windows-terminal-profile-restart-warning',
  'windows-terminal-profile-reattached',
]

/** A real commit in this repository, resolved rather than hard-coded so a rebase cannot stale it. */
const REAL_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()

/**
 * Bytes that begin with the true PNG signature and clear the size floor.
 *
 * Deliberately not a valid image beyond its header: the script's contract is signature + size, and
 * writing a real encoder here would test the encoder rather than the door.
 */
function pngBytes(size = MIN_CAPTURE_BYTES + 512, fill = 0x41) {
  const body = Buffer.alloc(Math.max(0, size - PNG_SIGNATURE.length), fill)
  return Buffer.concat([PNG_SIGNATURE, body])
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

let workspace
let evidenceDir
let outFile
let shotsDir

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-promote-'))
  evidenceDir = path.join(workspace, 'evidence')
  fs.mkdirSync(evidenceDir, { recursive: true })
  outFile = path.join(workspace, 'out', 'packaged-capture-manifest.json')
  shotsDir = path.join(workspace, 'out', 'packaged')
})

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true })
})

/** Write a complete, valid acceptance document plus its PNGs, then apply an override. */
function stageEvidence(overrides = {}, { writeFiles = true, pngFor = () => pngBytes() } = {}) {
  const evidence = REQUIRED_IDS.map((id) => {
    const bytes = pngFor(id)
    if (writeFiles) fs.writeFileSync(path.join(evidenceDir, `${id}.png`), bytes)
    return { id, title: `state ${id}`, file: `${id}.png`, bytes: bytes.length }
  })

  const document = {
    schemaVersion: 1,
    routeStatus: 'passed',
    acceptanceComplete: false,
    method: `${REQUIRED_METHOD_NEEDLE} packaged Windows profile/session-host acceptance`,
    runId: 'run-fixture-0001',
    source: { gitHead: REAL_COMMIT, workingTreeDigest: 'abc123', fileCount: 42 },
    candidate: { path: 'dist/win-unpacked/nodeterm.exe', sha256: 'deadbeef' },
    evidence,
    requiredEvidenceIds: [...REQUIRED_IDS],
    blockers: ['copy-paste-lossless-clipboard-restore'],
    ...overrides,
  }

  const file = path.join(evidenceDir, 'acceptance.json')
  fs.writeFileSync(file, JSON.stringify(document, null, 2))
  return file
}

function run(file) {
  return promote({ evidenceFile: file, outFile, shotsDir, repoRoot: REPO_ROOT })
}

/** Every refusal must leave the destination untouched. A partial promotion reads as evidence. */
function expectRefusal(file, needle) {
  expect(() => run(file)).toThrow(Refusal)
  try {
    run(file)
  } catch (error) {
    expect(error.message).toContain(needle)
  }
  expect(fs.existsSync(outFile), 'a refusal must not write the manifest').toBe(false)
  expect(fs.existsSync(shotsDir), 'a refusal must not create the shots directory').toBe(false)
}

describe('promote-packaged-captures: the happy path', () => {
  it('promotes valid evidence and emits a manifest the contract scanner accepts', () => {
    const result = run(stageEvidence())
    expect(result.wrote).toBe(true)
    expect(result.captured).toBe(REQUIRED_IDS.length)

    const manifest = JSON.parse(fs.readFileSync(outFile, 'utf8'))

    // The four conditions requireCaptureEvidence checks, asserted the way it checks them.
    expect(typeof manifest.method).toBe('string')
    expect(manifest.method.includes('cheap Lowlevel MCP headless')).toBe(true)
    const capturedIds = new Set(
      Array.isArray(manifest.captured)
        ? manifest.captured.map((entry) => entry?.id).filter((id) => typeof id === 'string')
        : [],
    )
    for (const id of REQUIRED_IDS) expect(capturedIds.has(id)).toBe(true)

    // Provenance is carried, not restated.
    expect(manifest.promotedFrom.gitHead).toBe(REAL_COMMIT)
    expect(manifest.promotedFrom.runId).toBe('run-fixture-0001')
    // A partially blocked run must not promote into an unqualified green claim.
    expect(manifest.acceptanceComplete).toBe(false)
    expect(manifest.blockers).toContain('copy-paste-lossless-clipboard-restore')

    // The PNGs really landed, byte-for-byte.
    for (const entry of manifest.captured) {
      const copied = fs.readFileSync(path.join(shotsDir, entry.file))
      expect(copied.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
      expect(sha256(copied)).toBe(entry.sha256)
    }
  })

  it('a dry run reports what it would promote and writes nothing', () => {
    const result = promote({
      evidenceFile: stageEvidence(),
      outFile,
      shotsDir,
      repoRoot: REPO_ROOT,
      dryRun: true,
    })
    expect(result.wrote).toBe(false)
    expect(result.captured).toBe(REQUIRED_IDS.length)
    expect(fs.existsSync(outFile)).toBe(false)
    expect(fs.existsSync(shotsDir)).toBe(false)
  })
})

describe('promote-packaged-captures: refusals', () => {
  it('refuses an unsupported schemaVersion', () => {
    expectRefusal(stageEvidence({ schemaVersion: 2 }), 'unsupported schemaVersion')
  })

  it('refuses a run whose route did not pass', () => {
    expectRefusal(stageEvidence({ routeStatus: 'failed' }), 'not "passed"')
  })

  it('refuses a method that does not name the cheap headless route', () => {
    expectRefusal(
      stageEvidence({ method: 'Electron + CDP Page.captureScreenshot against the built out/ artifact' }),
      'does not name "cheap Lowlevel MCP headless"',
    )
  })

  it('refuses when a required capture id is absent from the evidence', () => {
    const file = stageEvidence()
    const document = JSON.parse(fs.readFileSync(file, 'utf8'))
    document.evidence = document.evidence.filter((entry) => entry.id !== REQUIRED_IDS[2])
    fs.writeFileSync(file, JSON.stringify(document, null, 2))
    expectRefusal(file, `missing required capture id(s): ${REQUIRED_IDS[2]}`)
  })

  it('refuses when a referenced PNG does not exist', () => {
    const file = stageEvidence()
    fs.rmSync(path.join(evidenceDir, `${REQUIRED_IDS[1]}.png`))
    expectRefusal(file, 'does not exist at')
  })

  it('refuses a file that is not a PNG, however it is named', () => {
    const file = stageEvidence({}, {
      pngFor: (id) => (id === REQUIRED_IDS[0] ? Buffer.alloc(MIN_CAPTURE_BYTES + 512, 0x7a) : pngBytes()),
    })
    expectRefusal(file, 'is not a PNG')
  })

  it('refuses a PNG below the blank-frame byte floor', () => {
    const file = stageEvidence({}, {
      pngFor: (id) => (id === REQUIRED_IDS[3] ? pngBytes(MIN_CAPTURE_BYTES - 1) : pngBytes()),
    })
    expectRefusal(file, `below the ${MIN_CAPTURE_BYTES}-byte floor`)
  })

  it('refuses a gitHead that is not a commit in this repository', () => {
    expectRefusal(
      stageEvidence({ source: { gitHead: 'f'.repeat(40), workingTreeDigest: 'x', fileCount: 1 } }),
      'is not a commit in this repository',
    )
  })

  it('refuses a gitHead that is not a full 40-character SHA', () => {
    expectRefusal(
      stageEvidence({ source: { gitHead: REAL_COMMIT.slice(0, 12), workingTreeDigest: 'x', fileCount: 1 } }),
      'is not a full 40-character hex commit SHA',
    )
  })

  it('refuses a capture whose bytes do not match its own recorded sha256', () => {
    const file = stageEvidence()
    const document = JSON.parse(fs.readFileSync(file, 'utf8'))
    // Claim a digest the file cannot have. This is the swap the metadata check exists to catch:
    // the run photographed one frame and a different one is sitting in its place.
    document.evidence[0].sha256 = sha256(Buffer.from('a different frame entirely'))
    fs.writeFileSync(file, JSON.stringify(document, null, 2))
    expectRefusal(file, 'does not match its recorded sha256')
  })

  it('refuses evidence that is not valid JSON', () => {
    const file = path.join(evidenceDir, 'broken.json')
    fs.writeFileSync(file, '{ this is not json')
    expectRefusal(file, 'is not valid JSON')
  })

  it('refuses an evidence file that does not exist', () => {
    expectRefusal(path.join(evidenceDir, 'absent.json'), 'could not read the acceptance evidence')
  })
})
