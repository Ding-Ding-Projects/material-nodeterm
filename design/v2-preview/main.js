// Developer-only reference renderer. Reference code never receives a host bridge.
const { app, BrowserWindow, nativeTheme, session } = require('electron')
const { parseScreen, referenceFile, windowOptions } = require('./launch-config')
const { createAssetStore, installAssetRoutes } = require('./offline-assets')
const { readinessScript, waitForReference } = require('./readiness')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND')
nativeTheme.themeSource = 'dark'

async function start() {
  const screen = parseScreen(process.argv.slice(2))
  const file = referenceFile(screen)
  // Snapshot bytes before the renderer exists. A later junction swap cannot change them.
  const assets = createAssetStore(file)
  await app.whenReady()
  const isolated = session.fromPartition(`design-reference-${process.pid}`)
  const failures = []
  installAssetRoutes(isolated, assets, (reason) => failures.push(reason))
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', (event) => event.preventDefault())
  const win = new BrowserWindow({ ...windowOptions(screen), webPreferences: {
    ...windowOptions(screen).webPreferences, session: isolated
  } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.on('render-process-gone', () => app.exit(3))
  win.webContents.on('did-fail-load', (_event, code) => failures.push(`load failed (${code})`))
  const deadline = setTimeout(() => { console.error('Design reference boot timed out'); app.exit(3) }, 15000)
  try {
    await win.loadFile(file, { query: { theme: 'dark' } })
    await waitForReference({ probe: () => win.webContents.executeJavaScript(readinessScript), failures, timeoutMs: 12000 })
    await win.webContents.executeJavaScript("document.documentElement.dataset.designReferenceReady = 'true'")
    console.info(`Design reference ready: ${screen}; dark; 1440x940; scale=1; offline assets=${assets.size}`)
  } finally { clearTimeout(deadline) }
}
start().catch((error) => { console.error('Design reference failed:', error.message); app.exit(3) })
app.on('window-all-closed', () => app.quit())
