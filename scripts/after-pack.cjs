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
  // WebTorrent is a bundled runtime, never a PATH/npm fallback. Check the actual app.asar rather
  // than trusting package.json: a missing package here otherwise becomes a first-run network fetch.
  const torrentPackage = '/node_modules/webtorrent/package.json'
  const torrentEntry = '/node_modules/webtorrent/index.js'
  if (!files.includes(torrentPackage) || !files.includes(torrentEntry)) {
    throw new Error('Packaged WebTorrent runtime is missing package.json or index.js')
  }
  const packageJson = JSON.parse(asar.extractFile(archive, torrentPackage.slice(1)).toString('utf8'))
  if (packageJson.version !== '2.8.1') {
    throw new Error(`Packaged WebTorrent runtime version ${String(packageJson.version)} does not match 2.8.1`)
  }
  if (packageJson.license !== 'MIT') {
    throw new Error(`Packaged WebTorrent runtime license ${String(packageJson.license)} does not match MIT`)
  }
  const lockPath = path.join(context.packager.projectDir, 'package-lock.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  const locked = lock?.packages?.['node_modules/webtorrent']
  if (locked?.version !== '2.8.1' || locked?.integrity !== 'sha512-qmuVOR5INopa1YnGmxfB5jAZiMOX3tZbnJ84A1IUJ8wR6iBkVFHN2Ugy4NEZjrFly0wKxvuIJgmhUlLmnLSqgg==') {
    throw new Error('The package lock does not prove the pinned WebTorrent version and integrity.')
  }
  for (const dependency of ['bittorrent-dht', 'bittorrent-protocol', 'parse-torrent', 'torrent-discovery']) {
    if (!files.some((entry) => entry.endsWith(`/node_modules/${dependency}/package.json`))) {
      throw new Error(`Packaged WebTorrent transitive dependency ${dependency} is missing`)
    }
  }
}
