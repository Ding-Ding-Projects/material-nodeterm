const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')
const crypto = require('crypto')

exports.default = async function verifyCodexRelayPackaging(context) {
  // Squirrel.Windows and Linux both lay the packaged app out flat: extraResources and app.asar
  // sit directly under `<appOutDir>/resources`. An earlier version of this hook ran only on
  // darwin (the deleted macOS target nested resources inside a `.app` bundle), which meant the
  // platforms this repo actually ships got NO packaged-relay verification at all — a build that
  // silently dropped codex-relay.js would ship a broken Codex agent bridge that no test
  // downstream of packaging could catch.
  const resources = path.join(context.appOutDir, 'resources')
  const relay = path.join(resources, 'codex-relay.js')
  const archive = path.join(resources, 'app.asar')
  if (!fs.statSync(relay).isFile()) {
    throw new Error('Packaged Codex relay executable is missing')
  }
  // asar.listPackage joins entries with the HOST separator, so on Windows the same entry reads
  // `\out\main\codex-relay.js`. Comparing against the POSIX spelling alone would fail every
  // Windows package while staying green on Linux — normalize before comparing.
  const files = asar.listPackage(archive).map((entry) => entry.split(path.sep).join('/'))
  if (!files.includes('/out/main/codex-relay.js')) {
    throw new Error('Packaged main process Codex relay module is missing')
  }
  // The active delivery target is Windows; the manifest currently carries only the Windows x64
  // QEMU bundle, so non-Windows historical package paths do not claim a missing Linux guest tool.
  if (context.electronPlatformName === 'win32') await verifyQemuResources(resources)
}

async function verifyQemuResources(resources) {
  const qemuRoot = path.join(resources, 'qemu')
  const qemuRootInfo = fs.lstatSync(qemuRoot)
  if (qemuRootInfo.isSymbolicLink() || !qemuRootInfo.isDirectory()) throw new Error('Packaged QEMU resource root is not a real directory')
  const manifestPath = path.join(qemuRoot, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error('Packaged QEMU resource manifest is missing')
  const proof = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (proof.version !== '10.1.0' || proof.sourceRevision !== 'qemu-10.1.0-w64-20250826' ||
      proof.license?.spdx !== 'GPL-2.0-or-later' || !Array.isArray(proof.notices) ||
      !proof.notices.includes('resources/qemu/README.md') || !Array.isArray(proof.files) || proof.files.length !== 2) {
    throw new Error('Packaged QEMU resource manifest is incomplete')
  }
  let total = 0
  const expectedNames = new Set(['qemu-system-x86_64.exe', 'qemu-img.exe'])
  if (new Set(proof.files.map((entry) => entry.path)).size !== 2 || proof.files.some((entry) => !expectedNames.has(entry.path))) {
    throw new Error('Packaged QEMU resource manifest does not contain the exact expected filenames')
  }
  for (const entry of proof.files) {
    if (!/^[A-Za-z0-9._-]+$/.test(entry.path) || !/^[0-9a-f]{64}$/i.test(entry.sha256)) {
      throw new Error('Packaged QEMU resource manifest contains an unsafe or invalid file record')
    }
    const target = path.join(qemuRoot, entry.path)
    const targetInfo = fs.lstatSync(target)
    if (!target.startsWith(qemuRoot + path.sep) || targetInfo.isSymbolicLink() || !targetInfo.isFile()) {
      throw new Error(`Packaged QEMU payload is missing ${entry.path}`)
    }
    const bytes = fs.readFileSync(target)
    total += bytes.length
    if (bytes.length < 64 || bytes.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`Packaged QEMU payload is not a PE executable: ${entry.path}`)
    }
    const peOffset = bytes.readUInt32LE(0x3c)
    if (peOffset + 4 > bytes.length || bytes.subarray(peOffset, peOffset + 4).toString('ascii') !== 'PE\0\0') {
      throw new Error(`Packaged QEMU payload has no PE signature: ${entry.path}`)
    }
    const actual = crypto.createHash('sha256').update(bytes).digest('hex')
    if (actual.toLowerCase() !== entry.sha256.toLowerCase()) {
      throw new Error(`Packaged QEMU payload SHA-256 mismatch: ${entry.path}`)
    }
  }
  if (total < 1024 * 1024) throw new Error('Packaged QEMU payload is implausibly small')
}
