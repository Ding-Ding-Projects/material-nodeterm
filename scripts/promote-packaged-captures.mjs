#!/usr/bin/env node

/**
 * Promote packaged Windows acceptance evidence into a committed, contract-readable manifest.
 *
 * WHY THIS EXISTS — the gap it closes was structural, not clerical.
 *
 * `scripts/run-windows-profile-packaged-acceptance.mjs` produces genuine packaged evidence, but
 * writes it to a disposable TASK ROOT. `scripts/check-app-contract.mjs` reads a committed manifest.
 * Nothing carried one to the other, so the `windows-terminal-profiles` capture row could not be
 * closed even by somebody who had done the work — the evidence had nowhere durable to land.
 *
 * The obvious repair — hand-merge the ids into `docs/assets/shots/capture-manifest.json` — is
 * self-erasing and dishonest, for two independent reasons:
 *
 *   1. `capture-shots.mjs` rewrites that file WHOLESALE on every `npm run shots`. A hand-added
 *      entry survives until the next capture run and not one moment longer, and nothing warns.
 *   2. One manifest declares ONE `method`. That file's method is the unpackaged Electron+CDP
 *      sweep. Packaged cheap-Lowlevel-headless evidence sharing that file would have to sit under
 *      a method string describing a different route against a different artifact — a false
 *      provenance claim in the exact field the contract reads to prevent one.
 *
 * So promoted evidence gets its OWN committed manifest, with its own honest method line, at a
 * path `capture-shots.mjs` never touches. Two records, two routes, neither able to launder the
 * other's provenance.
 *
 * REFUSAL IS THE POINT. This script is the only door between a disposable task root and a
 * committed evidence claim, so it is deliberately hostile: every precondition below is checked,
 * the first failure exits non-zero, and a refusal writes NOTHING. A half-promoted manifest is
 * worse than no manifest, because it reads as evidence.
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { renameAtomicSync } from './lib/rename-atomic.mjs'

const HERE = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(HERE), '..')

/** The 8 bytes every PNG starts with. A file named .png that lacks these is not a capture. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * The same floor the acceptance core uses (MIN_CAPTURE_BYTES). A PNG smaller than this is a blank
 * or near-blank frame — a window that never painted, which is precisely what a capture exists to
 * disprove.
 */
const MIN_CAPTURE_BYTES = 6_000

/** The method needle `check-app-contract.mjs` requires. Kept here so the two cannot drift apart. */
const REQUIRED_METHOD_NEEDLE = 'cheap Lowlevel MCP headless'

const DEFAULT_OUT = 'docs/assets/shots/packaged-capture-manifest.json'
const DEFAULT_SHOTS_DIR = 'docs/assets/shots/packaged'

class Refusal extends Error {}

function refuse(message) {
  throw new Refusal(message)
}

function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch (error) {
    return refuse(`${what} is not valid JSON: ${error.message}`)
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Is this SHA a real commit in this repository?
 *
 * Asked with `git cat-file -e <sha>^{commit}` rather than by parsing `git log`, because that form
 * answers with an exit code and nothing else — no output to misparse, and it separates "not a
 * commit" from "not an object at all" without a second call.
 */
function commitExists(sha, repoRoot) {
  const result = spawnSync('git', ['cat-file', '-e', sha + '^{commit}'], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) refuse(`could not run git to verify the recorded commit: ${result.error.message}`)
  return result.status === 0
}

/**
 * Validate the acceptance evidence document and return the records to promote.
 *
 * Exported so the tests exercise the real decision rather than a restatement of it. Every refusal
 * names the exact unmet condition: a promotion that fails without saying why sends the next person
 * hunting through a 200 MB build.
 */
export function validateAcceptanceEvidence(document, options) {
  const { evidenceDir, repoRoot } = options

  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    refuse('the acceptance evidence document is not a JSON object')
  }
  if (document.schemaVersion !== 1) {
    refuse(`unsupported schemaVersion ${JSON.stringify(document.schemaVersion)} — expected 1`)
  }
  if (document.routeStatus !== 'passed') {
    refuse(
      `routeStatus is ${JSON.stringify(document.routeStatus)}, not "passed" — a run that did not pass is not evidence`,
    )
  }
  if (typeof document.method !== 'string' || !document.method.includes(REQUIRED_METHOD_NEEDLE)) {
    refuse(
      `method ${JSON.stringify(document.method)} does not name "${REQUIRED_METHOD_NEEDLE}" — only the cheap headless route may be promoted`,
    )
  }

  const source = document.source
  if (!source || typeof source !== 'object') refuse('the acceptance evidence records no source block')
  const gitHead = source.gitHead
  if (typeof gitHead !== 'string' || !/^[0-9a-f]{40}$/u.test(gitHead)) {
    refuse(`source.gitHead ${JSON.stringify(gitHead)} is not a full 40-character hex commit SHA`)
  }
  if (!commitExists(gitHead, repoRoot)) {
    refuse(
      `source.gitHead ${gitHead} is not a commit in this repository — the evidence names a tree nobody can check out`,
    )
  }

  const requiredIds = document.requiredEvidenceIds
  if (!Array.isArray(requiredIds) || requiredIds.length === 0) {
    refuse('the acceptance evidence records no requiredEvidenceIds')
  }
  const records = document.evidence
  if (!Array.isArray(records) || records.length === 0) {
    refuse('the acceptance evidence records no evidence entries')
  }

  const byId = new Map()
  for (const record of records) {
    if (record && typeof record.id === 'string') byId.set(record.id, record)
  }
  const missing = requiredIds.filter((id) => !byId.has(id))
  if (missing.length > 0) {
    refuse(`the acceptance evidence is missing required capture id(s): ${missing.join(', ')}`)
  }

  const captured = []
  for (const id of requiredIds) {
    const record = byId.get(id)
    const named = record.file ?? record.path ?? `${id}.png`
    // An absolute path in the record is honoured — the harness may legitimately write one — but it
    // is still opened and verified below. Recorded metadata never stands in for reading the bytes.
    const resolved = path.isAbsolute(named) ? named : path.join(evidenceDir, named)

    let stats
    try {
      stats = fs.statSync(resolved)
    } catch {
      refuse(`capture "${id}" names ${named}, which does not exist at ${resolved}`)
    }
    if (!stats.isFile()) refuse(`capture "${id}" names ${named}, which is not a file`)

    let bytes
    try {
      bytes = fs.readFileSync(resolved)
    } catch (error) {
      refuse(`capture "${id}" at ${resolved} could not be read: ${error.message}`)
    }

    if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      refuse(`capture "${id}" at ${resolved} is not a PNG — its first bytes are not the PNG signature`)
    }
    if (bytes.length < MIN_CAPTURE_BYTES) {
      refuse(
        `capture "${id}" is ${bytes.length} bytes, below the ${MIN_CAPTURE_BYTES}-byte floor — a frame that small is blank or near-blank`,
      )
    }

    const digest = sha256(bytes)
    if (typeof record.sha256 === 'string' && record.sha256.toLowerCase() !== digest) {
      refuse(
        `capture "${id}" does not match its recorded sha256 — the file on disk is not the file the run photographed`,
      )
    }

    captured.push({
      id,
      title: typeof record.title === 'string' ? record.title : id,
      bytes: bytes.length,
      sha256: digest,
      file: `${id}.png`,
      sourcePath: resolved,
    })
  }

  return { captured, gitHead }
}

/** Build the committed manifest. Pure, so a test can assert its shape without touching disk. */
export function buildPromotedManifest(document, captured, promotedAt) {
  return {
    schemaVersion: 1,
    // Verbatim from the acceptance run. This is the field the contract reads to confirm the route,
    // so restating it in our own words would be exactly the provenance laundering this file exists
    // to prevent.
    method: document.method,
    promotedAt,
    promotedFrom: {
      runId: document.runId ?? null,
      gitHead: document.source.gitHead,
      workingTreeDigest: document.source.workingTreeDigest ?? null,
      fileCount: document.source.fileCount ?? null,
    },
    candidate: document.candidate ?? null,
    // `captured[]` with an `id` per entry is deliberate: it is exactly the shape
    // `requireCaptureEvidence` already reads, so promotion needs no change to the contract scanner.
    captured: captured.map((entry) => ({
      id: entry.id,
      title: entry.title,
      bytes: entry.bytes,
      sha256: entry.sha256,
      file: entry.file,
    })),
    // Carried forward rather than dropped. The acceptance run records its own remaining blockers,
    // and a promotion that silently discarded them would turn a partially blocked run into an
    // unqualified green claim.
    acceptanceComplete: document.acceptanceComplete === true,
    blockers: Array.isArray(document.blockers) ? [...document.blockers] : [],
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // Random UUID entropy, not pid-plus-timestamp. Two callers routinely start in the same
  // millisecond and a pid is not a global dimension, so the obvious spelling collides — which the
  // repository's own atomic-write guard caught in this exact function before it ever shipped.
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
    renameAtomicSync(temporary, file)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // Keep the original failure; cleanup is best effort.
    }
    throw error
  }
}

/**
 * Promote, or refuse and change nothing.
 *
 * Ordering is load-bearing: EVERY precondition is validated before the first byte is written, so a
 * refusal cannot leave a half-populated shots directory beside a manifest that was never emitted.
 */
export function promote(options) {
  const {
    evidenceFile,
    outFile,
    shotsDir,
    repoRoot = REPO_ROOT,
    dryRun = false,
    now = () => new Date(),
  } = options

  let raw
  try {
    raw = fs.readFileSync(evidenceFile, 'utf8')
  } catch (error) {
    refuse(`could not read the acceptance evidence at ${evidenceFile}: ${error.message}`)
  }
  const document = parseJson(raw, `the acceptance evidence at ${evidenceFile}`)
  const evidenceDir = path.dirname(path.resolve(evidenceFile))

  const { captured } = validateAcceptanceEvidence(document, { evidenceDir, repoRoot })
  const manifest = buildPromotedManifest(document, captured, now().toISOString())

  if (dryRun) return { manifest, wrote: false, captured: captured.length }

  fs.mkdirSync(shotsDir, { recursive: true })
  for (const entry of captured) {
    fs.copyFileSync(entry.sourcePath, path.join(shotsDir, entry.file))
  }
  writeJsonAtomic(outFile, manifest)
  return { manifest, wrote: true, captured: captured.length }
}

function main() {
  const { values } = parseArgs({
    strict: true,
    allowPositionals: false,
    options: {
      evidence: { type: 'string' },
      out: { type: 'string' },
      'shots-dir': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })

  if (!values.evidence) {
    console.error('Usage: node scripts/promote-packaged-captures.mjs --evidence <acceptance-manifest.json>')
    console.error('              [--out docs/assets/shots/packaged-capture-manifest.json]')
    console.error('              [--shots-dir docs/assets/shots/packaged] [--dry-run]')
    process.exitCode = 2
    return
  }

  const outFile = path.resolve(REPO_ROOT, values.out ?? DEFAULT_OUT)
  const shotsDir = path.resolve(REPO_ROOT, values['shots-dir'] ?? DEFAULT_SHOTS_DIR)

  try {
    const result = promote({
      evidenceFile: path.resolve(values.evidence),
      outFile,
      shotsDir,
      dryRun: values['dry-run'],
    })
    if (result.wrote) {
      console.log(`Promoted ${result.captured} packaged capture(s) to ${path.relative(REPO_ROOT, outFile)}`)
    } else {
      console.log(`Dry run: ${result.captured} packaged capture(s) would be promoted. Nothing was written.`)
    }
  } catch (error) {
    if (error instanceof Refusal) {
      console.error(`Refusing to promote: ${error.message}`)
      console.error('Nothing was written.')
      process.exitCode = 1
      return
    }
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE)) main()

export { DEFAULT_OUT, DEFAULT_SHOTS_DIR, MIN_CAPTURE_BYTES, PNG_SIGNATURE, Refusal, REQUIRED_METHOD_NEEDLE }
