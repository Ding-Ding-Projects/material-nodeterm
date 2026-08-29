import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CHEAP_HEADLESS_ROUTE,
  CHEAP_HEADLESS_TOOL,
  InteractionLedgerRefusal,
  REQUIRED_CLIPPING_IDS,
  createCheapHeadlessLaunchReceipt,
  promoteInteractionLedger,
  validateInteractionLedger
} from './interaction-ledger.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REAL_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** A minimally decodable PNG with an IHDR, enough for the evidence door to read real dimensions. */
function png(width = 320, height = 180, fill = 0x41) {
  const bytes = Buffer.alloc(96, fill)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 4, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

let fixture
let evidenceDir
let executablePath
let setupPath
let executableSha256
let setupSha256

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-interaction-ledger-'))
  evidenceDir = path.join(fixture, 'evidence')
  fs.mkdirSync(evidenceDir, { recursive: true })
  executablePath = path.join(fixture, 'dist', 'win-unpacked', 'nodeterm.exe')
  setupPath = path.join(fixture, 'dist', 'squirrel-windows', 'nodeterm-Setup-0.4.122.exe')
  fs.mkdirSync(path.dirname(executablePath), { recursive: true })
  fs.mkdirSync(path.dirname(setupPath), { recursive: true })
  fs.writeFileSync(executablePath, Buffer.from('packaged executable fixture'))
  fs.writeFileSync(setupPath, Buffer.from('squirrel setup fixture'))
  executableSha256 = sha256(fs.readFileSync(executablePath))
  setupSha256 = sha256(fs.readFileSync(setupPath))
})

afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }))

function screenshotRecord(name, width = 320, height = 180) {
  const bytes = png(width, height, name.length)
  fs.writeFileSync(path.join(evidenceDir, name), bytes)
  return { path: name, bytes: bytes.length, width, height, sha256: sha256(bytes) }
}

function stateTuple(scale, width = 1280) {
  return {
    screen: 'settings',
    state: 'appearance-editor-open',
    theme: 'dark',
    viewport: { width, height: 720 },
    scale
  }
}

function makeLedger(overrides = {}) {
  const clickScreenshot = screenshotRecord('click-open-editor.png')
  const clicks = [
    {
      id: 'open-editor',
      sequence: 1,
      sourceCommit: REAL_COMMIT,
      executableSha256,
      setupSha256,
      stateTuple: stateTuple(1),
      target: { accessibleName: 'Edit appearance', role: 'button', locator: '[aria-label="Edit appearance"]' },
      input: { kind: 'pointer', button: 'left', coordinates: { x: 120, y: 80 } },
      observedState: {
        before: 'appearance editor closed',
        after: 'appearance editor open',
        consequence: 'The anchored appearance editor is visible beside the selected control.',
        changed: true
      },
      privacy: { verdict: 'pass', note: 'The frame contains no credentials, private paths, or personal data.' },
      screenshot: clickScreenshot
    }
  ]
  const clippingMatrix = REQUIRED_CLIPPING_IDS.map((id) => {
    const scale = id === 'narrow-320' ? 1 : Number(id.slice(6)) / 100
    const width = id === 'narrow-320' ? 320 : 1280
    return {
      id,
      stateTuple: stateTuple(scale, width),
      noClipping: true,
      observed: 'The surface has no clipping at this viewport and display scale.',
      screenshot: screenshotRecord(`${id}.png`)
    }
  })
  return {
    schemaVersion: 1,
    status: 'verified',
    runId: 'ledger-fixture-001',
    capture: {
      route: CHEAP_HEADLESS_ROUTE,
      tool: CHEAP_HEADLESS_TOOL,
      source: 'built-artifact',
      window: 'named-headless-desktop'
    },
    source: { commit: REAL_COMMIT },
    executable: { path: executablePath, sha256: executableSha256 },
    installation: { installed: true, setup: { path: setupPath, sha256: setupSha256 } },
    clicks,
    clippingMatrix,
    ...overrides
  }
}

function validate(ledger, options = {}) {
  return validateInteractionLedger(ledger, {
    repoRoot: REPO_ROOT,
    evidenceDir,
    expectedCommit: REAL_COMMIT,
    expectedExecutablePath: executablePath,
    expectedExecutableSha256: executableSha256,
    expectedSetupPath: setupPath,
    expectedInstalled: true,
    ...options
  })
}

describe('interaction ledger validation', () => {
  it('accepts a real click record bound to the executable and all required scale rows', () => {
    const result = validate(makeLedger())
    expect(result.clicks).toHaveLength(1)
    expect(result.clicks[0].sourceCommit).toBe(REAL_COMMIT)
    expect(result.clicks[0].executableSha256).toBe(executableSha256)
    expect(result.clicks[0].setupSha256).toBe(setupSha256)
    expect(result.clippingMatrix.map((row) => row.id)).toEqual([...REQUIRED_CLIPPING_IDS])
    expect(result.clippingMatrix.map((row) => row.scale)).toEqual([1, 1, 1.25, 1.5, 2])
  })

  it('accepts an uninstalled run only when every click carries null Setup provenance', () => {
    const ledger = makeLedger({
      installation: { installed: false, setup: null },
      clicks: makeLedger().clicks.map((click) => ({ ...click, setupSha256: null }))
    })
    expect(validate(ledger, { expectedInstalled: false, expectedSetupPath: undefined })).toMatchObject({
      installation: { installed: false, setup: null },
      clicks: [{ setupSha256: null }]
    })
  })

  it('mutation-proves the route guard, then restores the valid route', () => {
    const ledger = makeLedger()
    ledger.capture = { route: 'cdp-only', tool: 'puppeteer', source: 'source-preview', window: 'browser' }
    expect(() => validate(ledger)).toThrow(/cheap-lowlevel-headless|CDP-only/)
    ledger.capture = {
      route: CHEAP_HEADLESS_ROUTE,
      tool: CHEAP_HEADLESS_TOOL,
      source: 'built-artifact',
      window: 'named-headless-desktop'
    }
    expect(validate(ledger).status).toBe('verified')
  })

  it.each([
    ['stale source', (ledger) => { ledger.source.commit = 'f'.repeat(40) }, /source.commit|expectedCommit/],
    ['mismatched executable digest', (ledger) => { ledger.executable.sha256 = 'a'.repeat(64) }, /executable.sha256/],
    ['mismatched click digest', (ledger) => { ledger.clicks[0].executableSha256 = 'b'.repeat(64) }, /click open-editor.executableSha256/],
    ['mismatched setup digest', (ledger) => { ledger.clicks[0].setupSha256 = 'c'.repeat(64) }, /click open-editor.setupSha256/],
    ['missing narrow row', (ledger) => { ledger.clippingMatrix = ledger.clippingMatrix.slice(1) }, /narrow-320/],
    ['privacy refusal', (ledger) => { ledger.clicks[0].privacy.verdict = 'unknown' }, /privacy.verdict/],
    ['action-only observation', (ledger) => { ledger.clicks[0].observedState.consequence = 'click dispatched' }, /consequence/]
  ])('refuses %s without writing anything', (_name, mutate, expected) => {
    const ledger = makeLedger()
    mutate(ledger)
    expect(() => validate(ledger)).toThrow(expected)
  })
})

describe('cheap headless launch receipt', () => {
  it('accepts only a successful hidden launch with a hashed executable', () => {
    const receipt = createCheapHeadlessLaunchReceipt({
      sourceCommit: REAL_COMMIT,
      executablePath,
      executableSha256,
      launchResult: {
        ok: true,
        pid: 1234,
        desktop: 'nt-winprofiles-fixture-20260829',
        focus_stealing: false,
        terminal_window: false
      },
      recordedAtMs: 1_756_000_000_000
    })
    expect(receipt.route).toBe(CHEAP_HEADLESS_ROUTE)
    expect(receipt.launch.pid).toBe(1234)
    expect(receipt.executable.sha256).toBe(executableSha256)
  })
})

describe('interaction evidence promotion transaction', () => {
  it('validates everything before copying six captures and writing one manifest', () => {
    const evidenceFile = path.join(evidenceDir, 'ledger.json')
    fs.writeFileSync(evidenceFile, JSON.stringify(makeLedger(), null, 2))
    const outFile = path.join(fixture, 'promoted', 'interaction-ledger.json')
    const shotsDir = path.join(fixture, 'promoted', 'shots')
    const result = promoteInteractionLedger({
      evidenceFile,
      outFile,
      shotsDir,
      repoRoot: REPO_ROOT,
      expectedCommit: REAL_COMMIT,
      expectedExecutablePath: executablePath,
      expectedExecutableSha256: executableSha256,
      expectedSetupPath: setupPath,
      expectedInstalled: true
    })
    expect(result.wrote).toBe(true)
    expect(result.captures).toBe(6)
    expect(fs.readdirSync(shotsDir).sort()).toHaveLength(6)
    expect(JSON.parse(fs.readFileSync(outFile, 'utf8')).clicks[0].screenshot.path).toBe('click-open-editor.png')
  })

  it('refuses an invalid ledger before creating either destination', () => {
    const evidenceFile = path.join(evidenceDir, 'ledger.json')
    const ledger = makeLedger()
    ledger.capture.route = 'cdp-only'
    fs.writeFileSync(evidenceFile, JSON.stringify(ledger, null, 2))
    const outFile = path.join(fixture, 'promoted', 'interaction-ledger.json')
    const shotsDir = path.join(fixture, 'promoted', 'shots')
    expect(() => promoteInteractionLedger({
      evidenceFile,
      outFile,
      shotsDir,
      repoRoot: REPO_ROOT,
      expectedCommit: REAL_COMMIT,
      expectedExecutablePath: executablePath,
      expectedExecutableSha256: executableSha256,
      expectedSetupPath: setupPath,
      expectedInstalled: true
    })).toThrow(InteractionLedgerRefusal)
    expect(fs.existsSync(outFile)).toBe(false)
    expect(fs.existsSync(shotsDir)).toBe(false)
  })
})
