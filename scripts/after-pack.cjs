const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')

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
}
