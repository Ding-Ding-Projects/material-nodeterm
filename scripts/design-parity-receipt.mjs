#!/usr/bin/env node

/**
 * Validate the hand-written design-reference parity inventory and its runtime receipts.
 *
 * The inventory is intentionally independent from the receipt manifest. It can therefore prove
 * that a required screen was named even while a runtime capture is still pending. A pending
 * receipt is honest evidence of an outstanding runtime step, not evidence that the two renderers
 * match. A verified receipt is accepted only after its files are present and their digests match.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const INVENTORY_FILE = path.join(ROOT, 'design/v2/design-parity-inventory.json')
const RECEIPT_FILE = path.join(ROOT, 'docs/assets/design-parity/receipt-manifest.json')
const FULL_SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const EXPECTED_REFERENCE_DIR = 'design/v2'
const EXPECTED_MATERIAL_AUDIT = 'docs/features/appearance/material-3-audit.md'
const EXPECTED_DESIGN_APP = 'design/v2-preview/main.js'
const EXPECTED_METHOD = 'approved Lowlevel headless route against the design-reference Electron app and the real built desktop application'

const EXPECTED_SCREENS = Object.freeze([
  ['md3-canvas', 'Canvas', 'design/v2/MD3 Canvas.dc.html'],
  ['md3-board', 'Board', 'design/v2/MD3 Board.dc.html'],
  ['md3-files', 'Files', 'design/v2/MD3 Files.dc.html'],
  ['md3-settings', 'Settings', 'design/v2/MD3 Settings.dc.html'],
  ['md3-overlays', 'Overlays', 'design/v2/MD3 Overlays.dc.html'],
  ['md3-regex-builder', 'Regex Builder', 'design/v2/MD3 Regex Builder.dc.html'],
  ['md3-welcome', 'Welcome', 'design/v2/MD3 Welcome.dc.html'],
  ['md3-kids-mode', 'Kids Mode', 'design/v2/MD3 Kids Mode.dc.html'],
  ['md3-tools', 'Tools', 'design/v2/MD3 Tools.dc.html'],
  ['md3-history', 'History', 'design/v2/MD3 History.dc.html'],
])

function assertion(condition, message) {
  if (!condition) throw new Error(message)
}

function object(value, label) {
  assertion(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value
}

function nonEmpty(value, label) {
  assertion(typeof value === 'string' && value.trim() !== '', `${label} must be a non-empty string`)
  assertion(!/[\0\r\n]/u.test(value), `${label} must not contain NUL or newline`)
  return value
}

function exact(value, expected, label) {
  assertion(value === expected, `${label} must be exactly ${JSON.stringify(expected)}`)
  return value
}

function safeRelative(value, label, suffix) {
  const candidate = nonEmpty(value, label).replaceAll('\\', '/')
  assertion(!path.posix.isAbsolute(candidate), `${label} must be relative`)
  assertion(!candidate.split('/').includes('..'), `${label} must not escape the repository`)
  assertion(candidate.startsWith('docs/assets/design-parity/'), `${label} must be under docs/assets/design-parity/`)
  if (suffix) assertion(candidate.endsWith(suffix), `${label} must end with ${suffix}`)
  return candidate
}

function expectedById(id) {
  return EXPECTED_SCREENS.find(([expectedId]) => expectedId === id)
}

function readJson(file, label) {
  assertion(existsSync(file), `${label} is missing: ${path.relative(ROOT, file).replaceAll('\\', '/')}`)
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function readRepoText(relPath, label) {
  const file = path.resolve(ROOT, relPath)
  assertion(file.startsWith(`${ROOT}${path.sep}`), `${label} escapes the repository`)
  assertion(existsSync(file), `${label} is missing: ${relPath}`)
  return readFileSync(file, 'utf8')
}

function validateTuple(row, label) {
  nonEmpty(row.state, `${label}.state`)
  exact(row.theme, 'dark', `${label}.theme`)
  const viewport = object(row.viewport, `${label}.viewport`)
  for (const field of ['width', 'height']) {
    assertion(Number.isSafeInteger(viewport[field]) && viewport[field] > 0, `${label}.viewport.${field} must be a positive integer`)
  }
  assertion(viewport.deviceScaleFactor === 1, `${label}.viewport.deviceScaleFactor must be exactly 1`)
  assertion(row.scale === 1, `${label}.scale must be exactly 1`)
}

function validateInventoryDocument(inventory, { repoRoot = ROOT } = {}) {
  object(inventory, 'design parity inventory')
  exact(inventory.schemaVersion, 1, 'design parity inventory schemaVersion')
  const scope = object(inventory.scope, 'design parity inventory scope')
  exact(scope.surface, 'Windows desktop application', 'design parity inventory scope.surface')
  exact(scope.designReferenceApp, EXPECTED_DESIGN_APP, 'design parity inventory scope.designReferenceApp')
  exact(scope.designReferenceCommand, 'npm run design:v2 -- <screen>', 'design parity inventory scope.designReferenceCommand')
  exact(scope.builtApp, 'out/ desktop application', 'design parity inventory scope.builtApp')
  exact(scope.captureMethod, 'approved Lowlevel headless route', 'design parity inventory scope.captureMethod')
  exact(scope.runtimeEvidenceRequired, true, 'design parity inventory scope.runtimeEvidenceRequired')
  exact(scope.expectedReferenceCount, EXPECTED_SCREENS.length, 'design parity inventory scope.expectedReferenceCount')

  const screens = inventory.screens
  assertion(Array.isArray(screens), 'design parity inventory screens must be an array')
  exact(screens.length, EXPECTED_SCREENS.length, 'design parity inventory screen count')

  const expectedFiles = new Set(EXPECTED_SCREENS.map(([, , file]) => file))
  const actualReferenceFiles = new Set(
    readdirSync(path.join(repoRoot, EXPECTED_REFERENCE_DIR), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.dc.html'))
      .map((entry) => `${EXPECTED_REFERENCE_DIR}/${entry.name}`),
  )
  assertion(actualReferenceFiles.size === expectedFiles.size, 'design/v2 reference count differs from the hand-written ten-screen list')
  for (const file of expectedFiles) assertion(actualReferenceFiles.has(file), `required design reference is missing: ${file}`)
  for (const file of actualReferenceFiles) assertion(expectedFiles.has(file), `unlisted design reference is present: ${file}`)

  const seenIds = new Set()
  const seenFiles = new Set()
  const byId = new Map()
  for (const [index, rowValue] of screens.entries()) {
    const label = `design parity screen ${index + 1}`
    const row = object(rowValue, label)
    const id = nonEmpty(row.id, `${label}.id`)
    assertion(!seenIds.has(id), `${label}.id is duplicated: ${id}`)
    seenIds.add(id)
    const expected = expectedById(id)
    assertion(expected, `${label}.id is not one of the exact required screen ids: ${id}`)
    exact(row.referenceFile, expected[2], `${label}.referenceFile`)
    assertion(!seenFiles.has(row.referenceFile), `${label}.referenceFile is duplicated: ${row.referenceFile}`)
    seenFiles.add(row.referenceFile)
    const referencePath = path.resolve(repoRoot, row.referenceFile)
    assertion(existsSync(referencePath), `${label}.referenceFile is missing: ${row.referenceFile}`)

    const designRoute = object(row.designReferenceRoute, `${label}.designReferenceRoute`)
    exact(designRoute.screen, expected[1], `${label}.designReferenceRoute.screen`)
    exact(designRoute.command, `npm run design:v2 -- ${expected[1].includes(' ') ? JSON.stringify(expected[1]) : expected[1]}`, `${label}.designReferenceRoute.command`)

    const builtRoute = object(row.builtAppRoute, `${label}.builtAppRoute`)
    exact(builtRoute.id, `desktop.${id.slice(4)}`, `${label}.builtAppRoute.id`)
    nonEmpty(builtRoute.navigation, `${label}.builtAppRoute.navigation`)

    validateTuple(row, label)

    const captures = object(row.rawCaptures, `${label}.rawCaptures`)
    const referenceCapture = safeRelative(captures.reference, `${label}.rawCaptures.reference`, '.png')
    const builtCapture = safeRelative(captures.built, `${label}.rawCaptures.built`, '.png')
    assertion(referenceCapture !== builtCapture, `${label}.rawCaptures.reference and built must be different files`)
    const comparison = safeRelative(row.labelledComparison, `${label}.labelledComparison`, '.png')
    const visualDiff = safeRelative(row.visualDiffEvidence, `${label}.visualDiffEvidence`, '.json')
    for (const file of [referenceCapture, builtCapture, comparison, visualDiff]) {
      assertion(file.includes(`/${id}/`), `${label} evidence path must be scoped to ${id}`)
    }

    const materialAudit = object(row.materialAudit, `${label}.materialAudit`)
    exact(materialAudit.document, EXPECTED_MATERIAL_AUDIT, `${label}.materialAudit.document`)
    const auditText = readRepoText(materialAudit.document, `${label}.materialAudit.document`)
    assertion(Array.isArray(materialAudit.ids) && materialAudit.ids.length > 0, `${label}.materialAudit.ids must be a non-empty array`)
    const uniqueAuditIds = new Set(materialAudit.ids)
    exact(uniqueAuditIds.size, materialAudit.ids.length, `${label}.materialAudit.ids must not contain duplicates`)
    for (const auditId of materialAudit.ids) {
      const idText = nonEmpty(auditId, `${label}.materialAudit.ids entry`)
      assertion(auditText.includes(`\`${idText}\``), `${label}.materialAudit.ids is not present as an exact audit identifier: ${idText}`)
    }

    const deviation = object(row.intentionalDeviation, `${label}.intentionalDeviation`)
    exact(deviation.status, 'none', `${label}.intentionalDeviation.status`)
    exact(deviation.approval, 'not-required', `${label}.intentionalDeviation.approval`)
    nonEmpty(deviation.reason, `${label}.intentionalDeviation.reason`)
    exact(row.receiptId, id, `${label}.receiptId`)
  }

  for (const [id] of EXPECTED_SCREENS) assertion(seenIds.has(id), `required screen id is absent: ${id}`)
  return { screens: screens.length, ids: [...seenIds] }
}

function hashFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function validateVerifiedArtifact(artifact, expectedPath, label, repoRoot) {
  const value = object(artifact, label)
  const relative = safeRelative(value.path, `${label}.path`, path.extname(expectedPath))
  exact(relative, expectedPath, `${label}.path`)
  const file = path.resolve(repoRoot, relative)
  const details = statSync(file, { throwIfNoEntry: false })
  assertion(details?.isFile(), `${label}.path is not a regular file: ${relative}`)
  assertion(Number.isSafeInteger(value.bytes) && value.bytes > 0, `${label}.bytes must be a positive integer`)
  exact(value.bytes, details.size, `${label}.bytes`)
  const digest = nonEmpty(value.sha256, `${label}.sha256`).toLowerCase()
  assertion(SHA256.test(digest), `${label}.sha256 must be 64 hexadecimal characters`)
  exact(digest, hashFile(file), `${label}.sha256`)
  return { path: relative, bytes: details.size, sha256: digest }
}

function validateDesignParityReceiptManifest(manifest, inventory, { repoRoot = ROOT } = {}) {
  object(manifest, 'design parity receipt manifest')
  exact(manifest.schemaVersion, 1, 'design parity receipt manifest schemaVersion')
  assertion(['pending-runtime', 'partial-runtime', 'verified'].includes(manifest.status), 'design parity receipt manifest status is invalid')
  exact(manifest.method, EXPECTED_METHOD, 'design parity receipt manifest method')
  assertion(Array.isArray(manifest.receipts), 'design parity receipt manifest receipts must be an array')
  exact(manifest.receipts.length, EXPECTED_SCREENS.length, 'design parity receipt count')
  const expectedByReceipt = new Map(inventory.screens.map((row) => [row.receiptId, row]))
  const seen = new Set()
  let verifiedCount = 0
  for (const [index, value] of manifest.receipts.entries()) {
    const label = `design parity receipt ${index + 1}`
    const receipt = object(value, label)
    const id = nonEmpty(receipt.id, `${label}.id`)
    assertion(!seen.has(id), `${label}.id is duplicated: ${id}`)
    seen.add(id)
    const row = expectedByReceipt.get(id)
    assertion(row, `${label}.id is not linked to an inventory row: ${id}`)
    assertion(receipt.status === 'pending-runtime' || receipt.status === 'verified', `${label}.status is invalid`)
    const evidenceFlags = ['referenceCaptured', 'builtCaptured', 'comparisonGenerated', 'visualDiffGenerated']
    for (const field of evidenceFlags) exact(typeof receipt[field], 'boolean', `${label}.${field} type`)
    if (receipt.status === 'pending-runtime') {
      exact(receipt.sourceCommit, null, `${label}.sourceCommit`)
      exact(receipt.capturedAt, null, `${label}.capturedAt`)
      for (const field of evidenceFlags) exact(receipt[field], false, `${label}.${field}`)
      assertion(!Object.hasOwn(receipt, 'artifacts'), `${label} pending receipt must not claim artifact files`)
      continue
    }

    verifiedCount += 1
    const sourceCommit = nonEmpty(receipt.sourceCommit, `${label}.sourceCommit`).toLowerCase()
    assertion(FULL_SHA.test(sourceCommit), `${label}.sourceCommit must be a full 40-character SHA`)
    const capturedAt = nonEmpty(receipt.capturedAt, `${label}.capturedAt`)
    assertion(ISO_DATE.test(capturedAt) && !Number.isNaN(Date.parse(capturedAt)), `${label}.capturedAt must be a UTC ISO-8601 timestamp`)
    for (const field of evidenceFlags) exact(receipt[field], true, `${label}.${field}`)
    const artifacts = object(receipt.artifacts, `${label}.artifacts`)
    validateVerifiedArtifact(artifacts.reference, row.rawCaptures.reference, `${label}.artifacts.reference`, repoRoot)
    validateVerifiedArtifact(artifacts.built, row.rawCaptures.built, `${label}.artifacts.built`, repoRoot)
    validateVerifiedArtifact(artifacts.comparison, row.labelledComparison, `${label}.artifacts.comparison`, repoRoot)
    validateVerifiedArtifact(artifacts.visualDiff, row.visualDiffEvidence, `${label}.artifacts.visualDiff`, repoRoot)
    exact(artifacts.tuple, JSON.stringify({ state: row.state, theme: row.theme, viewport: row.viewport, scale: row.scale }), `${label}.artifacts.tuple`)
  }

  exact(seen.size, EXPECTED_SCREENS.length, 'design parity receipt ids')
  if (manifest.status === 'pending-runtime') exact(verifiedCount, 0, 'pending-runtime receipt manifest verified count')
  if (manifest.status === 'partial-runtime') assertion(verifiedCount > 0 && verifiedCount < EXPECTED_SCREENS.length, 'partial-runtime receipt manifest must have both pending and verified receipts')
  if (manifest.status === 'verified') exact(verifiedCount, EXPECTED_SCREENS.length, 'verified receipt manifest verified count')
  return { receipts: manifest.receipts.length, verified: verifiedCount, pending: manifest.receipts.length - verifiedCount }
}

export function loadDesignParityInventory() {
  return readJson(INVENTORY_FILE, 'design parity inventory')
}

export function loadDesignParityReceiptManifest() {
  return readJson(RECEIPT_FILE, 'design parity receipt manifest')
}

export function validateDesignParityInventory(inventory, options = {}) {
  return validateInventoryDocument(inventory, options)
}

export function validateDesignParityReceipts(manifest, inventory, options = {}) {
  return validateDesignParityReceiptManifest(manifest, inventory, options)
}

/**
 * Deliberately remove one exact contract boundary at a time. The canonical files are never
 * changed. This is the executable red-then-green proof for the hand-written inventory and receipt
 * guard, and it protects against a check that only inspects whatever rows happen to remain.
 */
export function runDesignParitySelfTest() {
  const inventory = loadDesignParityInventory()
  const manifest = loadDesignParityReceiptManifest()
  validateInventoryDocument(inventory)
  validateDesignParityReceiptManifest(manifest, inventory)
  const mutations = [
    ['screen id', (copy) => { copy.screens[0].id = 'md3-canvas-renamed' }],
    ['reference file', (copy) => { delete copy.screens[0].referenceFile }],
    ['design reference route', (copy) => { delete copy.screens[0].designReferenceRoute.command }],
    ['built app route', (copy) => { delete copy.screens[0].builtAppRoute.id }],
    ['deterministic state', (copy) => { delete copy.screens[0].state }],
    ['theme tuple', (copy) => { delete copy.screens[0].theme }],
    ['viewport tuple', (copy) => { delete copy.screens[0].viewport.width }],
    ['scale tuple', (copy) => { delete copy.screens[0].scale }],
    ['reference capture path', (copy) => { delete copy.screens[0].rawCaptures.reference }],
    ['built capture path', (copy) => { delete copy.screens[0].rawCaptures.built }],
    ['labelled comparison path', (copy) => { delete copy.screens[0].labelledComparison }],
    ['machine diff path', (copy) => { delete copy.screens[0].visualDiffEvidence }],
    ['Material audit', (copy) => { delete copy.screens[0].materialAudit.document }],
    ['intentional-deviation approval', (copy) => { delete copy.screens[0].intentionalDeviation.approval }],
    ['receipt row', (copy) => { delete copy.receipts[0].id }],
    ['pending receipt proof', (copy) => { delete copy.receipts[0].referenceCaptured }],
  ]
  for (const [label, mutate] of mutations) {
    const copy = label === 'receipt row' || label === 'pending receipt proof'
      ? structuredClone(manifest)
      : structuredClone(inventory)
    mutate(copy)
    let failed = false
    try {
      if (label === 'receipt row' || label === 'pending receipt proof') validateDesignParityReceiptManifest(copy, inventory)
      else validateInventoryDocument(copy)
    } catch {
      failed = true
    }
    assertion(failed, `self-test mutation did not turn the guard red: ${label}`)
  }
  validateInventoryDocument(inventory)
  validateDesignParityReceiptManifest(manifest, inventory)
  return { mutations: mutations.length, restored: true }
}

function main(argv) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--self-test')) {
    throw new Error('usage: node scripts/design-parity-receipt.mjs [--self-test]')
  }
  if (argv[0] === '--self-test') {
    const result = runDesignParitySelfTest()
    console.log(`design parity self-test: red then green for ${result.mutations} exact mutations`)
    return
  }
  const inventory = loadDesignParityInventory()
  const inventoryResult = validateInventoryDocument(inventory)
  const receiptResult = validateDesignParityReceiptManifest(loadDesignParityReceiptManifest(), inventory)
  console.log(`design parity inventory: ${inventoryResult.screens} exact screens`)
  console.log(`design parity receipts: ${receiptResult.verified} verified, ${receiptResult.pending} pending-runtime`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`design-parity: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
