#!/usr/bin/env node

'use strict'

const fs = require('node:fs')
const path = require('node:path')

const SUPPORTED_NODE_RANGE = '^22.22.2 || ^24.15.0 || >=26.0.0'

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

  const requested = argv.length === 2 && argv[0] === '--check' ? argv[1] : process.versions.node
  if ((argv.length !== 0 && argv.length !== 2) || (argv.length === 2 && argv[0] !== '--check')) {
    console.error('usage: check-node-version.cjs [--check <version>]')
    return 2
  }
  if (!isSupportedNodeVersion(requested)) {
    console.error(`Node ${JSON.stringify(requested)} does not satisfy ${SUPPORTED_NODE_RANGE}`)
    return 1
  }

  const expected = process.env.NODETERM_EXPECTED_NODE_VERSION
  if (expected && String(requested).replace(/^v/, '') !== String(expected).replace(/^v/, '')) {
    console.error(`Node version mismatch: expected ${expected}, got ${requested}`)
    return 1
  }

  console.log(`v${String(requested).replace(/^v/, '')}`)
  return 0
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))

module.exports = { SUPPORTED_NODE_RANGE, isSupportedNodeVersion, parseVersion }
