const fs = require('fs')
const path = require('path')
const asar = require('@electron/asar')

exports.default = async function verifyCodexRelayPackaging(context) {
  // The archive layout below is macOS-specific. The global electron-builder hook also runs for
  // Squirrel.Windows, whose resources live in a different tree; treating that output as a `.app`
  // makes a valid Windows package fail before this hook can verify anything meaningful.
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const resources = path.join(context.appOutDir, appName, 'Contents', 'Resources')
  const relay = path.join(resources, 'codex-relay.js')
  const archive = path.join(resources, 'app.asar')
  if (!fs.statSync(relay).isFile()) {
    throw new Error('Packaged Codex relay executable is missing')
  }
  const files = asar.listPackage(archive)
  if (!files.includes('/out/main/codex-relay.js')) {
    throw new Error('Packaged main process Codex relay module is missing')
  }
}
