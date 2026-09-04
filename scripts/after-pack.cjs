const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const asar = require('@electron/asar')
const crypto = require('crypto')

function applyUnsignedWindowsResources(context) {
  if (context.electronPlatformName !== 'win32') return

  const projectRoot = context.packager.projectDir
  const productName = context.packager.appInfo.productName
  const productFilename = context.packager.appInfo.productFilename
  const executableName = `${productFilename}.exe`
  const executable = path.join(context.appOutDir, executableName)
  const icon = path.join(projectRoot, 'build', 'icon.ico')
  const editor = path.join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe')
  for (const [label, file] of [
    ['packed executable', executable],
    ['Windows icon', icon],
    ['resource editor', editor]
  ]) {
    if (!fs.existsSync(file)) throw new Error(`Unsigned resource edit is missing ${label}: ${file}`)
  }

  const version = `${context.packager.appInfo.version}.0`
  execFileSync(editor, [
    executable,
    '--set-icon', icon,
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-version-string', 'ProductName', productName,
    '--set-version-string', 'FileDescription', productName,
    '--set-version-string', 'InternalName', productFilename,
    '--set-version-string', 'OriginalFilename', executableName
  ], { stdio: 'inherit', windowsHide: true })
}

exports.default = async function applyResourcesAndVerifyPackaging(context) {
  // Resource editing is deliberately separate from electron-builder's signer-coupled edit path.
  // The three signer controls remain false, while this hook applies the reviewed icon and version
  // strings before Squirrel consumes the packed application.
  applyUnsignedWindowsResources(context)

  // Squirrel.Windows lays the packaged app out flat: extraResources and app.asar sit directly
  // under `<appOutDir>/resources`. A build that silently drops codex-relay.js would ship a broken
  // Codex bridge that no check downstream of packaging could recover.
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
  // The SAME separator trap the listPackage comment above describes, in the other direction, and
  // it is why every Windows release run failed here while Linux stayed green: asar's own
  // `searchNodeFromDirectory` does `p.split(path.sep)`, so a POSIX lookup path on Windows
  // splits into ONE segment, matches no directory node, and reports the file as absent from an
  // archive that contains it. Normalizing the listing is not enough -- the path handed BACK to
  // asar has to carry host separators too.
  const torrentPackageHostPath = torrentPackage.slice(1).split('/').join(path.sep)
  const packageJson = JSON.parse(asar.extractFile(archive, torrentPackageHostPath).toString('utf8'))
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
