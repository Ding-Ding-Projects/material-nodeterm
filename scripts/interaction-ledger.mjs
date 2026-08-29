#!/usr/bin/env node

/**
 * Commit-bound interaction evidence for the Windows desktop acceptance route.
 *
 * This module is intentionally independent from a particular feature driver.  A driver records
 * what it actually clicked and what the built app actually showed; this module disbelieves the
 * driver's claims by resolving the commit and executable files, recomputing every digest, and
 * opening every PNG before promotion.  A source preview or a CDP-only run can look convincing in
 * a gallery, but it is not evidence of the packaged desktop application.
 */
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { renameAtomicSync } from './lib/rename-atomic.mjs'

export const SCHEMA_VERSION = 1
export const CHEAP_HEADLESS_ROUTE = 'cheap-lowlevel-headless'
export const CHEAP_HEADLESS_TOOL = 'lowlevel-computer-use-cheap'
export const REQUIRED_SCALES = Object.freeze([1, 1.25, 1.5, 2])
export const REQUIRED_CLIPPING_IDS = Object.freeze([
  'narrow-320',
  'scale-100',
  'scale-125',
  'scale-150',
  'scale-200'
])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const FULL_SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u
const INPUT_KINDS = new Set(['pointer', 'keyboard', 'touch'])
const THEMES = new Set(['light', 'dark', 'high-contrast'])

export class InteractionLedgerRefusal extends Error {
  constructor(message) {
    super(message)
    this.name = 'InteractionLedgerRefusal'
  }
}

function refuse(message) {
  throw new InteractionLedgerRefusal(message)
}

function text(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || /[\0\r\n]/u.test(value)) {
    refuse(`${label} must be a non-empty string without NUL or newline`)
  }
  return value
}

function id(value, label) {
  const result = text(value, label)
  if (!SAFE_ID.test(result)) refuse(`${label} is not a safe evidence identifier`)
  return result
}

function commit(value, label) {
  const result = text(value, label).toLowerCase()
  if (!FULL_SHA.test(result)) refuse(`${label} must be a full 40-character commit SHA`)
  return result
}

function digest(value, label) {
  const result = text(value, label).toLowerCase()
  if (!SHA256.test(result)) refuse(`${label} must be exactly 64 hexadecimal characters`)
  return result
}

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) refuse(`${label} must be a positive finite number`)
  return value
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) refuse(`${label} must be a positive safe integer`)
  return value
}

function canonical(value) {
  return path.resolve(value).replace(/[\\/]+$/u, '').toLocaleLowerCase('en-US')
}

function inside(root, candidate) {
  const base = canonical(root)
  const target = canonical(candidate)
  return target === base || target.startsWith(`${base}${path.sep}`)
}

function absoluteFile(value, label) {
  const file = text(value, label)
  if (!path.isAbsolute(file)) refuse(`${label} must be an absolute path`)
  const resolved = path.resolve(file)
  let stat
  try {
    stat = fs.statSync(resolved)
  } catch (error) {
    refuse(`${label} is unreadable at ${resolved}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!stat.isFile()) refuse(`${label} is not a regular file: ${resolved}`)
  return resolved
}

function sha256File(file) {
  const hash = createHash('sha256')
  const handle = fs.openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const bytes = fs.readSync(handle, buffer, 0, buffer.length, null)
      if (bytes === 0) break
      hash.update(buffer.subarray(0, bytes))
    }
  } finally {
    fs.closeSync(handle)
  }
  return hash.digest('hex')
}

function commitExists(repoRoot, sha) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

function requireCommit(repoRoot, value, label) {
  const sha = commit(value, label)
  if (!commitExists(repoRoot, sha)) refuse(`${label} ${sha} is not a commit in this repository`)
  return sha
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) refuse(`${label} must be an object`)
  return value
}

function exactJson(left, right, label) {
  if (JSON.stringify(left) !== JSON.stringify(right)) refuse(`${label} does not match the ledger provenance`)
}

function validateCaptureFile(raw, evidenceDir, label, expected) {
  const named = text(raw, `${label}.path`)
  const resolved = path.isAbsolute(named) ? path.resolve(named) : path.resolve(evidenceDir, named)
  // Relative paths are scoped to the ledger's evidence directory. The headless harness may emit
  // an absolute path in its task directory, so absolute paths are accepted and still verified by
  // bytes below rather than trusted as metadata.
  if (!path.isAbsolute(named) && !inside(evidenceDir, resolved)) refuse(`${label}.path must remain inside the evidence directory`)
  let stat
  try {
    stat = fs.statSync(resolved)
  } catch {
    refuse(`${label}.path does not exist at ${resolved}`)
  }
  if (!stat.isFile()) refuse(`${label}.path is not a regular file`)
  const bytes = fs.readFileSync(resolved)
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    refuse(`${label}.path is not a PNG capture`)
  }
  if (bytes.length < 64) refuse(`${label}.path is too small to be a rendered capture`)
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    refuse(`${label}.path has no PNG IHDR`)
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width <= 0 || height <= 0) refuse(`${label}.path has invalid PNG dimensions`)
  const actualSha = sha256File(resolved)
  if (expected.bytes !== bytes.length) refuse(`${label}.bytes changed after capture`)
  if (digest(expected.sha256, `${label}.sha256`) !== actualSha) {
    refuse(`${label}.sha256 does not match the bytes on disk`)
  }
  if (expected.width !== width || expected.height !== height) {
    refuse(`${label} dimensions do not match the PNG on disk`)
  }
  return { path: resolved, bytes: bytes.length, width, height, sha256: actualSha }
}

function validateStateTuple(value, label) {
  const state = object(value, label)
  const viewport = object(state.viewport, `${label}.viewport`)
  const screen = text(state.screen, `${label}.screen`)
  const stateName = text(state.state, `${label}.state`)
  const theme = text(state.theme, `${label}.theme`)
  if (!THEMES.has(theme)) refuse(`${label}.theme must be light, dark, or high-contrast`)
  const width = safeInteger(viewport.width, `${label}.viewport.width`)
  const height = safeInteger(viewport.height, `${label}.viewport.height`)
  if (width < 320) refuse(`${label}.viewport.width must be at least 320 pixels`)
  const scale = finitePositive(state.scale, `${label}.scale`)
  if (!REQUIRED_SCALES.includes(scale)) refuse(`${label}.scale must be one of 1, 1.25, 1.5, or 2`)
  return { screen, state: stateName, theme, viewport: { width, height }, scale }
}

function validateTarget(value, label) {
  const target = object(value, label)
  return {
    accessibleName: text(target.accessibleName, `${label}.accessibleName`),
    role: text(target.role, `${label}.role`),
    locator: text(target.locator, `${label}.locator`)
  }
}

function validateInput(value, label) {
  const input = object(value, label)
  const kind = text(input.kind, `${label}.kind`)
  if (!INPUT_KINDS.has(kind)) refuse(`${label}.kind must be pointer, keyboard, or touch`)
  return {
    kind,
    button: typeof input.button === 'string' ? input.button : null,
    key: typeof input.key === 'string' ? input.key : null,
    coordinates: input.coordinates === undefined ? null : object(input.coordinates, `${label}.coordinates`)
  }
}

function validateObserved(value, label) {
  const observed = object(value, label)
  const changed = observed.changed
  if (typeof changed !== 'boolean') refuse(`${label}.changed must be boolean`)
  const consequence = text(observed.consequence, `${label}.consequence`)
  if (/\bclick\s+(?:was\s+)?(?:dispatched|sent|fired)\b/iu.test(consequence)) {
    refuse(`${label}.consequence must describe an observed UI result, not an input-only claim`)
  }
  return {
    before: text(observed.before, `${label}.before`),
    after: text(observed.after, `${label}.after`),
    consequence,
    changed
  }
}

function validatePrivacy(value, label) {
  const privacy = object(value, label)
  if (privacy.verdict !== 'pass') refuse(`${label}.verdict must be pass`)
  return { verdict: 'pass', note: text(privacy.note, `${label}.note`) }
}

function validateCheapRoute(value) {
  const capture = object(value, 'capture')
  if (capture.route !== CHEAP_HEADLESS_ROUTE) {
    refuse('capture.route must be cheap-lowlevel-headless; CDP-only evidence is rejected')
  }
  if (capture.tool !== CHEAP_HEADLESS_TOOL) refuse('capture.tool must be lowlevel-computer-use-cheap')
  if (capture.source !== 'built-artifact') refuse('capture.source must be built-artifact; source previews are rejected')
  if (capture.window !== 'named-headless-desktop') refuse('capture.window must be named-headless-desktop')
  return {
    route: CHEAP_HEADLESS_ROUTE,
    tool: CHEAP_HEADLESS_TOOL,
    source: 'built-artifact',
    window: 'named-headless-desktop'
  }
}

/** Validate the receipt returned by the cheap headless launch wrapper. */
export function validateCheapHeadlessLaunchReceipt(receipt, options = {}) {
  const value = object(receipt, 'headless launch receipt')
  if (value.schemaVersion !== SCHEMA_VERSION) refuse('headless launch receipt schemaVersion must be 1')
  if (value.status !== 'verified') refuse('headless launch receipt status must be verified')
  if (value.route !== CHEAP_HEADLESS_ROUTE || value.tool !== CHEAP_HEADLESS_TOOL) {
    refuse('headless launch receipt must identify the cheap lowlevel headless route')
  }
  const launch = object(value.launch, 'headless launch receipt.launch')
  const pid = safeInteger(Number(launch.pid), 'headless launch receipt.launch.pid')
  const desktop = text(launch.desktop, 'headless launch receipt.launch.desktop')
  if (launch.ok !== true) refuse('headless launch receipt.launch.ok must be true')
  if (launch.focusStealing !== false) refuse('headless launch receipt must prove focusStealing=false')
  if (launch.terminalWindow !== false) refuse('headless launch receipt must prove terminalWindow=false')
  if (options.expectedDesktop !== undefined && desktop !== options.expectedDesktop) {
    refuse(`headless launch desktop mismatch: expected ${options.expectedDesktop}, got ${desktop}`)
  }
  return { schemaVersion: 1, status: 'verified', route: CHEAP_HEADLESS_ROUTE, tool: CHEAP_HEADLESS_TOOL, launch: { pid, desktop, ok: true, focusStealing: false, terminalWindow: false } }
}

/** Create a launch receipt from an actual cheap-tool response and a hashed executable. */
export function createCheapHeadlessLaunchReceipt(options) {
  const executable = absoluteFile(options.executablePath, 'launch executable')
  const executableSha256 = digest(options.executableSha256, 'launch executable sha256')
  if (sha256File(executable) !== executableSha256) refuse('launch executable sha256 does not match the file on disk')
  const launch = validateCheapHeadlessLaunchReceipt({
    schemaVersion: 1,
    status: 'verified',
    route: CHEAP_HEADLESS_ROUTE,
    tool: CHEAP_HEADLESS_TOOL,
    launch: {
      ok: options.launchResult?.ok,
      pid: options.launchResult?.pid,
      desktop: options.launchResult?.desktop,
      focusStealing: options.launchResult?.focus_stealing,
      terminalWindow: options.launchResult?.terminal_window
    }
  })
  return {
    ...launch,
    sourceCommit: commit(options.sourceCommit, 'launch sourceCommit'),
    executable: { path: executable, sha256: executableSha256 },
    recordedAt: new Date(options.recordedAtMs ?? Date.now()).toISOString()
  }
}

function validateInstallation(value, evidence) {
  const installation = object(value, 'installation')
  if (typeof installation.installed !== 'boolean') refuse('installation.installed must be boolean')
  if (!installation.installed) return { installed: false, setup: null }
  const setup = object(installation.setup, 'installation.setup')
  const setupPath = absoluteFile(setup.path, 'installation.setup.path')
  const setupSha256 = digest(setup.sha256, 'installation.setup.sha256')
  const actual = sha256File(setupPath)
  if (actual !== setupSha256) refuse('installation.setup.sha256 does not match the file on disk')
  return { installed: true, setup: { path: setupPath, sha256: actual, bytes: fs.statSync(setupPath).size } }
}

function validateClippingMatrix(value, evidenceDir, expectedStateTheme) {
  if (!Array.isArray(value)) refuse('clippingMatrix must be an array')
  const byId = new Map()
  for (const row of value) {
    const rowObject = object(row, 'clippingMatrix entry')
    const rowId = id(rowObject.id, 'clippingMatrix id')
    if (byId.has(rowId)) refuse(`duplicate clippingMatrix id ${rowId}`)
    byId.set(rowId, rowObject)
  }
  for (const requiredId of REQUIRED_CLIPPING_IDS) {
    const row = byId.get(requiredId)
    if (!row) refuse(`clippingMatrix is missing ${requiredId}`)
    const state = validateStateTuple(row.stateTuple, `clippingMatrix.${requiredId}.stateTuple`)
    if (requiredId === 'narrow-320' && state.viewport.width !== 320) refuse('clippingMatrix.narrow-320 must use a 320-pixel viewport')
    if (requiredId !== 'narrow-320' && state.scale !== REQUIRED_SCALES[REQUIRED_CLIPPING_IDS.indexOf(requiredId) - 1]) {
      refuse(`clippingMatrix.${requiredId} has the wrong display scale`)
    }
    if (state.theme !== expectedStateTheme) refuse(`clippingMatrix.${requiredId} theme does not match the ledger theme`)
    if (row.noClipping !== true) refuse(`clippingMatrix.${requiredId}.noClipping must be true`)
    const observed = text(row.observed, `clippingMatrix.${requiredId}.observed`)
    if (!/\b(no|zero)\s+clipping\b/iu.test(observed)) refuse(`clippingMatrix.${requiredId}.observed must state no clipping`)
    const screenshot = object(row.screenshot, `clippingMatrix.${requiredId}.screenshot`)
    const capture = validateCaptureFile(screenshot.path, evidenceDir, `clippingMatrix.${requiredId}.screenshot`, screenshot)
    row._validated = { ...state, observed, noClipping: true, screenshot: capture }
  }
  return REQUIRED_CLIPPING_IDS.map((requiredId) => ({ id: requiredId, ...byId.get(requiredId)._validated }))
}

/** Validate one full interaction ledger against a caller-supplied expected build. */
export function validateInteractionLedger(ledger, options = {}) {
  const value = object(ledger, 'interaction ledger')
  if (value.schemaVersion !== SCHEMA_VERSION) refuse('interaction ledger schemaVersion must be 1')
  if (value.status !== 'verified') refuse('interaction ledger status must be verified')
  const repoRoot = path.resolve(text(options.repoRoot, 'repoRoot'))
  if (!fs.existsSync(repoRoot) || !fs.statSync(repoRoot).isDirectory() || !fs.existsSync(path.join(repoRoot, '.git'))) {
    refuse('repoRoot must contain a .git directory')
  }
  const evidenceDir = path.resolve(text(options.evidenceDir, 'evidenceDir'))
  if (!fs.existsSync(evidenceDir) || !fs.statSync(evidenceDir).isDirectory()) refuse('evidenceDir must be a directory')
  const expectedCommit = requireCommit(repoRoot, options.expectedCommit, 'expectedCommit')
  const source = object(value.source, 'source')
  const sourceCommit = requireCommit(repoRoot, source.commit, 'source.commit')
  if (sourceCommit !== expectedCommit) refuse(`source.commit ${sourceCommit} is stale; expected ${expectedCommit}`)
  const executable = object(value.executable, 'executable')
  const executablePath = absoluteFile(executable.path, 'executable.path')
  const expectedExecutable = absoluteFile(options.expectedExecutablePath, 'expectedExecutablePath')
  if (canonical(executablePath) !== canonical(expectedExecutable)) refuse('executable.path does not match the expected packaged executable')
  const executableSha256 = digest(executable.sha256, 'executable.sha256')
  if (sha256File(executablePath) !== executableSha256) refuse('executable.sha256 does not match the file on disk')
  if (options.expectedExecutableSha256 !== undefined && executableSha256 !== digest(options.expectedExecutableSha256, 'expectedExecutableSha256')) {
    refuse('executable sha256 is stale or mismatched')
  }
  const capture = validateCheapRoute(value.capture)
  const installation = validateInstallation(value.installation, { repoRoot })
  if (options.expectedSetupPath !== undefined && installation.installed) {
    const expectedSetup = absoluteFile(options.expectedSetupPath, 'expectedSetupPath')
    if (canonical(installation.setup.path) !== canonical(expectedSetup)) refuse('installation.setup.path does not match the expected Setup executable')
  }
  if (options.expectedInstalled !== undefined && installation.installed !== options.expectedInstalled) refuse('installation.installed does not match the expected installation state')
  const clicks = value.clicks
  if (!Array.isArray(clicks) || clicks.length === 0) refuse('interaction ledger must contain at least one click')
  const seen = new Set()
  const validatedClicks = clicks.map((raw, index) => {
    const click = object(raw, `click ${index + 1}`)
    const clickId = id(click.id, `click ${index + 1}.id`)
    if (seen.has(clickId)) refuse(`duplicate click id ${clickId}`)
    seen.add(clickId)
    if (click.sequence !== index + 1) refuse(`click ${clickId}.sequence must be ${index + 1}`)
    const clickCommit = requireCommit(repoRoot, click.sourceCommit, `click ${clickId}.sourceCommit`)
    if (clickCommit !== sourceCommit) refuse(`click ${clickId}.sourceCommit is stale or mismatched`)
    const clickExecutableSha = digest(click.executableSha256, `click ${clickId}.executableSha256`)
    if (clickExecutableSha !== executableSha256) refuse(`click ${clickId}.executableSha256 is stale or mismatched`)
    const setupSha = click.setupSha256 === null ? null : digest(click.setupSha256, `click ${clickId}.setupSha256`)
    if (installation.installed && setupSha !== installation.setup.sha256) refuse(`click ${clickId}.setupSha256 is stale or mismatched`)
    if (!installation.installed && setupSha !== null) refuse(`click ${clickId}.setupSha256 must be null when no Setup was installed`)
    const stateTuple = validateStateTuple(click.stateTuple, `click ${clickId}.stateTuple`)
    const target = validateTarget(click.target, `click ${clickId}.target`)
    const input = validateInput(click.input, `click ${clickId}.input`)
    const observedState = validateObserved(click.observedState, `click ${clickId}.observedState`)
    const privacy = validatePrivacy(click.privacy, `click ${clickId}.privacy`)
    const screenshot = object(click.screenshot, `click ${clickId}.screenshot`)
    const captureFile = validateCaptureFile(screenshot.path, evidenceDir, `click ${clickId}.screenshot`, screenshot)
    return {
      id: clickId,
      sequence: index + 1,
      sourceCommit: clickCommit,
      executableSha256: clickExecutableSha,
      setupSha256: setupSha,
      stateTuple,
      target,
      input,
      observedState,
      privacy,
      screenshot: captureFile
    }
  })
  const matrix = validateClippingMatrix(value.clippingMatrix, evidenceDir, validatedClicks[0].stateTuple.theme)
  return {
    schemaVersion: 1,
    status: 'verified',
    runId: id(value.runId, 'runId'),
    capture,
    source: { commit: sourceCommit },
    executable: { path: executablePath, sha256: executableSha256, bytes: fs.statSync(executablePath).size },
    installation,
    clicks: validatedClicks,
    clippingMatrix: matrix
  }
}

function writeNewFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const handle = fs.openSync(file, 'wx')
  try {
    fs.writeFileSync(handle, content)
  } finally {
    fs.closeSync(handle)
  }
}

/**
 * Promote a validated ledger as one refusal-safe transaction. Validation happens before the first
 * destination byte is written. Existing destinations are refused rather than overwritten, so a
 * second run cannot silently mix captures from two builds.
 */
export function promoteInteractionLedger(options) {
  const evidenceFile = absoluteFile(options.evidenceFile, 'evidenceFile')
  const evidenceDir = path.dirname(evidenceFile)
  let ledger
  try {
    ledger = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'))
  } catch (error) {
    refuse(`evidenceFile is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const validated = validateInteractionLedger(ledger, { ...options, evidenceDir })
  const outFile = path.resolve(text(options.outFile, 'outFile'))
  const shotsDir = path.resolve(text(options.shotsDir, 'shotsDir'))
  if (fs.existsSync(outFile) || fs.existsSync(shotsDir)) refuse('promotion destinations already exist; refusing to mix or overwrite evidence')
  const manifest = {
    schemaVersion: 1,
    status: 'verified',
    runId: validated.runId,
    capture: validated.capture,
    source: validated.source,
    executable: validated.executable,
    installation: validated.installation,
    clicks: validated.clicks.map((click) => ({ ...click, screenshot: { ...click.screenshot, path: path.basename(click.screenshot.path) } })),
    clippingMatrix: validated.clippingMatrix.map((row) => ({ ...row, screenshot: { ...row.screenshot, path: path.basename(row.screenshot.path) } }))
  }
  if (options.dryRun === true) return { wrote: false, manifest, captures: validated.clicks.length + validated.clippingMatrix.length }
  const transaction = path.join(path.dirname(shotsDir), `.interaction-ledger-${randomUUID()}`)
  const stagedShots = path.join(transaction, 'shots')
  const stagedManifest = path.join(transaction, 'manifest.json')
  try {
    fs.mkdirSync(stagedShots, { recursive: true })
    for (const click of validated.clicks) fs.copyFileSync(click.screenshot.path, path.join(stagedShots, `${click.id}.png`), fs.constants.COPYFILE_EXCL)
    for (const row of validated.clippingMatrix) fs.copyFileSync(row.screenshot.path, path.join(stagedShots, `${row.id}.png`), fs.constants.COPYFILE_EXCL)
    writeNewFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`)
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    renameAtomicSync(stagedShots, shotsDir)
    renameAtomicSync(stagedManifest, outFile)
    fs.rmSync(transaction, { recursive: true, force: true })
  } catch (error) {
    fs.rmSync(transaction, { recursive: true, force: true })
    if (fs.existsSync(shotsDir) && !fs.existsSync(outFile)) fs.rmSync(shotsDir, { recursive: true, force: true })
    throw error
  }
  return { wrote: true, manifest, captures: validated.clicks.length + validated.clippingMatrix.length }
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      evidence: { type: 'string' },
      out: { type: 'string' },
      'shots-dir': { type: 'string' },
      repo: { type: 'string' },
      commit: { type: 'string' },
      executable: { type: 'string' },
      'executable-sha256': { type: 'string' },
      setup: { type: 'string' },
      installed: { type: 'boolean' },
      'dry-run': { type: 'boolean', default: false }
    }
  })
  const command = positionals[0]
  if (!command || !['validate', 'promote'].includes(command) || !values.evidence || !values.repo || !values.commit || !values.executable) {
    throw new Error('usage: interaction-ledger.mjs validate|promote --evidence <ledger.json> --repo <root> --commit <sha> --executable <path> [--executable-sha256 <sha>] [--setup <path>] [--installed] [--out <manifest>] [--shots-dir <dir>] [--dry-run]')
  }
  const executableSha256 = values['executable-sha256'] ?? sha256File(path.resolve(values.executable))
  const result = command === 'validate'
    ? validateInteractionLedger(JSON.parse(fs.readFileSync(path.resolve(values.evidence), 'utf8')), {
        repoRoot: values.repo,
        evidenceDir: path.dirname(path.resolve(values.evidence)),
        expectedCommit: values.commit,
        expectedExecutablePath: values.executable,
        expectedExecutableSha256: executableSha256,
        expectedSetupPath: values.setup,
        expectedInstalled: values.installed
      })
    : promoteInteractionLedger({
        evidenceFile: values.evidence,
        outFile: values.out ?? path.join(values.repo, 'docs', 'assets', 'shots', 'interaction-ledger.json'),
        shotsDir: values['shots-dir'] ?? path.join(values.repo, 'docs', 'assets', 'shots', 'interaction-ledger'),
        repoRoot: values.repo,
        expectedCommit: values.commit,
        expectedExecutablePath: values.executable,
        expectedExecutableSha256: executableSha256,
        expectedSetupPath: values.setup,
        expectedInstalled: values.installed,
        dryRun: values['dry-run']
      })
  process.stdout.write(`${command} interaction ledger: ${result.captures ?? result.clicks.length} verified capture(s)\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`interaction-ledger: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
