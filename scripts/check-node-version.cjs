#!/usr/bin/env node

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const SUPPORTED_NODE_RANGE = '^22.22.2 || ^24.15.0 || >=26.0.0'

function manifestBuildNodeVersion() {
  const root = path.resolve(__dirname, '..')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'dependencies.manifest.json'), 'utf8'),
  )
  const version = String(manifest.node?.version || '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('dependencies.manifest.json must declare node.version as three decimal parts')
  }
  return version
}

function manifestPortableNode(architecture) {
  if (architecture !== 'win-x64' && architecture !== 'win-arm64') {
    throw new Error(`unsupported portable Node architecture ${JSON.stringify(architecture)}`)
  }
  const root = path.resolve(__dirname, '..')
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'dependencies.manifest.json'), 'utf8'),
  )
  const version = manifestBuildNodeVersion()
  const entry = manifest.node?.portable?.[architecture]
  const url = String(entry?.url || '')
  const sha256 = String(entry?.sha256 || '')
  const expectedUrl =
    `https://nodejs.org/dist/v${version}/node-v${version}-${architecture}.zip`
  if (url !== expectedUrl || !/^[a-fA-F0-9]{64}$/.test(sha256)) {
    throw new Error(
      'dependencies.manifest.json portable Node entry must use the exact official URL and SHA-256',
    )
  }
  return { version, url, sha256 }
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ''))
  if (!match) return null
  return match.slice(1).map(Number)
}

function isSupportedNodeVersion(value) {
  const version = parseVersion(value)
  if (!version) return false
  const [major, minor, patch] = version
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 2)
  if (major === 24) return minor > 15 || (minor === 15 && patch >= 0)
  return major >= 26
}

function main(argv) {
  const root = path.resolve(__dirname, '..')
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (packageJson.engines?.node !== SUPPORTED_NODE_RANGE) {
    console.error(
      `Node version contract drift: package.json must declare ${JSON.stringify(SUPPORTED_NODE_RANGE)}`,
    )
    return 2
  }

  const printPortable = argv.length === 2 && argv[0] === '--print-portable'
  const manifestPin = argv.length === 1 && argv[0] === '--manifest-pin'
  if (printPortable) {
    try {
      const portable = manifestPortableNode(argv[1])
      console.log(`NODE_VERSION=${portable.version}`)
      console.log(`NODE_URL=${portable.url}`)
      console.log(`NODE_SHA256=${portable.sha256}`)
      return 0
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 2
    }
  }
  const requested = argv.length === 2 && argv[0] === '--check' ? argv[1] : process.versions.node
  if (
    (argv.length !== 0 && !manifestPin && argv.length !== 2) ||
    (argv.length === 2 && argv[0] !== '--check')
  ) {
    console.error(
      'usage: check-node-version.cjs [--check <version> | --manifest-pin | --print-portable <win-x64|win-arm64>]',
    )
    return 2
  }
  if (!isSupportedNodeVersion(requested)) {
    console.error(`Node ${JSON.stringify(requested)} does not satisfy ${SUPPORTED_NODE_RANGE}`)
    return 1
  }

  let expected = process.env.NODETERM_EXPECTED_NODE_VERSION
  if (manifestPin) {
    try {
      expected = manifestBuildNodeVersion()
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      return 2
    }
  }
  if (expected && String(requested).replace(/^v/, '') !== String(expected).replace(/^v/, '')) {
    console.error(`Node version mismatch: expected ${expected}, got ${requested}`)
    return 1
  }

  console.log(`v${String(requested).replace(/^v/, '')}`)
  return 0
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))

module.exports = {
  SUPPORTED_NODE_RANGE,
  isSupportedNodeVersion,
  manifestBuildNodeVersion,
  manifestPortableNode,
  parseVersion,
}
