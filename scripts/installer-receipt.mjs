#!/usr/bin/env node

/**
 * Validate an installer acceptance receipt without trusting the acceptance runner's claims.
 *
 * A receipt is evidence about a concrete packaged Setup.exe, not about a source tree or
 * win-unpacked directory. The validator resolves the file, recomputes its digest, and binds it
 * to the source commit and Squirrel package identity supplied by the caller. It is deliberately
 * independent from the UI driver so a broken driver cannot promote its own report.
 */
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const FULL_SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const PACKAGE_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/u

function fail(message) {
  throw new Error(message)
}

function text(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || /[\0\r\n]/u.test(value)) {
    fail(`${label} must be a non-empty string without NUL or newline`)
  }
  return value
}

function commit(value, label) {
  const result = text(value, label).toLowerCase()
  if (!FULL_SHA.test(result)) fail(`${label} must be a full 40-character commit SHA`)
  return result
}

function identity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('installer receipt identity must be an object')
  const version = text(value.version, 'installer receipt version')
  if (!SEMVER.test(version)) fail(`installer receipt version must be stable SemVer, got ${JSON.stringify(version)}`)
  const packageId = text(value.packageId, 'installer receipt package id')
  if (!PACKAGE_ID.test(packageId)) fail(`installer receipt package id is invalid: ${JSON.stringify(packageId)}`)
  const productName = text(value.productName, 'installer receipt product name')
  if (/[<>:"/\\|?*]/u.test(productName) || productName.endsWith('.') || productName.endsWith(' ')) {
    fail(`installer receipt product name is not a safe filename component: ${JSON.stringify(productName)}`)
  }
  return { version, packageId, productName }
}

function absoluteFile(value, label) {
  const file = text(value, label)
  if (!path.isAbsolute(file)) fail(`${label} must be an absolute path`)
  return path.resolve(file)
}

function inside(parent, child) {
  const root = path.resolve(parent).toLocaleLowerCase('en-US')
  const target = path.resolve(child).toLocaleLowerCase('en-US')
  return target === root || target.startsWith(`${root}${path.sep}`)
}

/**
 * Validate a receipt and recompute its installer SHA-256.
 *
 * `expected` is intentionally explicit. A receipt that only repeats its own version, source SHA,
 * and package identity is self-authenticating and therefore worthless as release evidence.
 */
export async function validateInstallerReceipt(receipt, expected = {}) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) fail('installer receipt must be an object')
  if (receipt.schemaVersion !== 1) fail('installer receipt schemaVersion must be 1')
  if (receipt.status !== 'verified') fail('installer receipt status must be verified')
  const actualIdentity = identity(receipt)
  const expectedIdentity = identity({
    version: expected.version ?? actualIdentity.version,
    packageId: expected.packageId ?? actualIdentity.packageId,
    productName: expected.productName ?? actualIdentity.productName,
  })
  for (const field of ['version', 'packageId', 'productName']) {
    if (actualIdentity[field] !== expectedIdentity[field]) {
      fail(`installer receipt ${field} mismatch: expected ${expectedIdentity[field]}, got ${actualIdentity[field]}`)
    }
  }

  const source = receipt.source
  if (!source || typeof source !== 'object' || Array.isArray(source)) fail('installer receipt source must be an object')
  const sourceSha = commit(source.commit, 'installer receipt source.commit')
  const expectedCommit = expected.commit === undefined ? sourceSha : commit(expected.commit, 'expected commit')
  if (sourceSha !== expectedCommit) fail(`installer receipt source commit mismatch: expected ${expectedCommit}, got ${sourceSha}`)

  const installer = absoluteFile(receipt.installer, 'installer receipt installer')
  const unpackedRoot = expected.unpackedRoot ?? path.join(path.dirname(path.dirname(installer)), 'win-unpacked')
  if (inside(unpackedRoot, installer)) {
    fail('installer receipt must reference the Squirrel Setup.exe, not dist/win-unpacked')
  }
  const squirrelRoot = expected.squirrelRoot
    ? absoluteFile(expected.squirrelRoot, 'expected Squirrel output directory')
    : path.dirname(installer)
  if (!inside(squirrelRoot, installer)) fail('installer receipt installer must be inside the Squirrel output directory')
  const expectedName = `${actualIdentity.productName}-Setup-${actualIdentity.version}.exe`
  if (path.basename(installer) !== expectedName) {
    fail(`installer receipt Setup name mismatch: expected ${expectedName}, got ${path.basename(installer)}`)
  }
  const details = await stat(installer).catch((error) => fail(`installer receipt Setup is unreadable: ${error.message}`))
  if (!details.isFile() || details.size <= 0) fail('installer receipt Setup must be a non-empty regular file')
  const actualSha256 = await hashFile(installer)
  const claimedSha256 = text(receipt.sha256, 'installer receipt sha256').toLowerCase()
  if (!SHA256.test(claimedSha256)) fail('installer receipt sha256 must be exactly 64 hexadecimal characters')
  if (actualSha256 !== claimedSha256) fail(`installer receipt SHA-256 mismatch: expected ${claimedSha256}, got ${actualSha256}`)

  const assets = receipt.assets
  if (!Array.isArray(assets) || assets.length !== 3) fail('installer receipt assets must contain exactly three Squirrel assets')
  const expectedAssetNames = new Set([
    'RELEASES',
    expectedName,
    `${actualIdentity.packageId}-${actualIdentity.version}-full.nupkg`,
  ])
  const actualAssetNames = new Set()
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) fail('installer receipt asset must be an object')
    const name = text(asset.name, 'installer receipt asset name')
    if (actualAssetNames.has(name)) fail(`installer receipt contains duplicate asset ${name}`)
    actualAssetNames.add(name)
    if (!expectedAssetNames.has(name)) fail(`installer receipt contains unexpected asset ${name}`)
    const assetSha256 = text(asset.sha256, `installer receipt asset ${name} sha256`).toLowerCase()
    if (!SHA256.test(assetSha256)) {
      fail(`installer receipt asset ${name} sha256 must be exactly 64 hexadecimal characters`)
    }
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) fail(`installer receipt asset ${name} size is invalid`)
    const assetFile = path.resolve(squirrelRoot, name)
    if (!inside(squirrelRoot, assetFile) || path.basename(assetFile) !== name) {
      fail(`installer receipt asset ${name} must remain inside the Squirrel output directory`)
    }
    const assetDetails = await stat(assetFile).catch((error) => fail(`installer receipt asset ${name} is unreadable: ${error.message}`))
    if (!assetDetails.isFile() || assetDetails.size !== asset.size) {
      fail(`installer receipt asset ${name} size mismatch: expected ${asset.size}, got ${assetDetails.size}`)
    }
    const actualAssetSha256 = await hashFile(assetFile)
    if (actualAssetSha256 !== assetSha256) {
      fail(`installer receipt asset ${name} SHA-256 mismatch: expected ${assetSha256}, got ${actualAssetSha256}`)
    }
  }
  for (const name of expectedAssetNames) if (!actualAssetNames.has(name)) fail(`installer receipt is missing asset ${name}`)

  return {
    schemaVersion: 1,
    status: 'verified',
    ...actualIdentity,
    source: { ...source, commit: sourceSha },
    installer,
    sha256: actualSha256,
    assets: assets.map((asset) => ({ name: asset.name, size: asset.size, sha256: asset.sha256.toLowerCase() })),
  }
}

async function hashFile(file) {
  const hash = createHash('sha256')
  const bytes = await readFile(file)
  hash.update(bytes)
  return hash.digest('hex')
}

async function main(argv) {
  if (argv.length !== 2) fail('usage: installer-receipt.mjs verify <receipt.json> <expected-commit>')
  const [file, expectedCommit] = argv
  const receipt = JSON.parse(await readFile(path.resolve(file), 'utf8'))
  const result = await validateInstallerReceipt(receipt, { commit: expectedCommit })
  process.stdout.write(`verified installer receipt ${result.productName} ${result.version} at ${result.source.commit}\n`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`installer-receipt: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
