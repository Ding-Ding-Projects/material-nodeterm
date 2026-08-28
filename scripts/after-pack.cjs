const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const asar = require('@electron/asar')

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
}
