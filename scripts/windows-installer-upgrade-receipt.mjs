#!/usr/bin/env node

/**
 * Validate the durable receipt emitted by the Windows installed-version upgrade harness.
 *
 * The harness itself runs through the approved low-level headless route on an isolated desktop. This
 * verifier is intentionally platform-neutral: it checks the recorded baseline and upgrade facts
 * without treating a plan, an unpacked build, or a missing lifecycle observation as success.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const COMMIT = /^[0-9a-f]{40}$/u
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

function fail(message) {
  throw new Error(message)
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || /[\0\r\n]/u.test(value)) fail(`${label} must be a non-empty string`)
  return value
}

function requiredCommit(value, label) {
  const result = requiredText(value, label).toLowerCase()
  if (!COMMIT.test(result)) fail(`${label} must be a full 40-character commit SHA`)
  return result
}

function phase(value, label, expectedVersion, expectedCommit) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  if (value.version !== expectedVersion || !VERSION.test(value.version)) {
    fail(`${label}.version must be exactly ${expectedVersion}`)
  }
  const sourceCommit = requiredCommit(value.sourceCommit, `${label}.sourceCommit`)
  if (expectedCommit !== undefined && sourceCommit !== requiredCommit(expectedCommit, 'expected commit')) {
    fail(`${label}.sourceCommit does not match the expected hosted commit`)
  }
  if (value.installObserved !== true) fail(`${label}.installObserved must be true`)
  if (value.stableIdentityObserved !== true) fail(`${label}.stableIdentityObserved must be true`)
  return { version: value.version, sourceCommit, installObserved: true, stableIdentityObserved: true }
}

/** Validate one exact 0.4.152 baseline to 1.0.0 upgrade receipt. */
export function validateUpgradeReceipt(value, expected = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('upgrade receipt must be an object')
  if (value.schemaVersion !== 1) fail('upgrade receipt schemaVersion must be 1')
  if (value.status !== 'verified') fail('upgrade receipt status must be verified')
  const packageId = requiredText(value.packageId, 'upgrade receipt packageId')
  const productName = requiredText(value.productName, 'upgrade receipt productName')
  if (expected.packageId !== undefined && packageId !== expected.packageId) fail('upgrade receipt packageId mismatch')
  if (expected.productName !== undefined && productName !== expected.productName) fail('upgrade receipt productName mismatch')
  const baseline = phase(value.baseline, 'upgrade receipt baseline', '0.4.152', expected.baselineCommit)
  const upgraded = phase(value.upgraded, 'upgrade receipt upgraded', '1.0.0', expected.upgradedCommit)
  if (baseline.sourceCommit === upgraded.sourceCommit) fail('baseline and upgraded receipts must use different hosted commits')

  const lifecycle = value.lifecycle
  if (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)) fail('upgrade receipt lifecycle must be an object')
  for (const key of ['baselineClosed', 'upgradeLaunched', 'upgradeClosed', 'relaunchObserved', 'sessionReattached']) {
    if (lifecycle[key] !== true) fail(`upgrade receipt lifecycle.${key} must be true`)
  }
  const migration = value.stateMigration
  if (!migration || typeof migration !== 'object' || Array.isArray(migration)) fail('upgrade receipt stateMigration must be an object')
  if (migration.observed !== true) fail('upgrade receipt stateMigration.observed must be true')
  if (migration.stableIdentity !== true) fail('upgrade receipt stateMigration.stableIdentity must be true')
  if (migration.settingsPreserved !== true) fail('upgrade receipt stateMigration.settingsPreserved must be true')
  if (migration.sessionsReattached !== true) fail('upgrade receipt stateMigration.sessionsReattached must be true')
  return {
    schemaVersion: 1,
    status: 'verified',
    packageId,
    productName,
    baseline,
    upgraded,
    lifecycle: Object.fromEntries(Object.keys(lifecycle).map((key) => [key, lifecycle[key]])),
    stateMigration: Object.fromEntries(Object.keys(migration).map((key) => [key, migration[key]])),
  }
}

async function main(argv) {
  if (argv.length < 1 || argv.length > 3) {
    fail('usage: windows-installer-upgrade-receipt.mjs verify <receipt.json> [baseline-commit] [upgraded-commit]')
  }
  const value = JSON.parse(await readFile(path.resolve(argv[0]), 'utf8'))
  const result = validateUpgradeReceipt(value, { baselineCommit: argv[1], upgradedCommit: argv[2] })
  process.stdout.write(`verified installed upgrade receipt ${result.baseline.version} to ${result.upgraded.version}\n`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`windows-installer-upgrade-receipt: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
