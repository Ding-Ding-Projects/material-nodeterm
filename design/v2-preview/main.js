// A plain Electron shell that renders one v2 design prototype at its own 1440x900 frame, so the
// design and the running app can be captured under identical conditions and set side by side.
//
// Deliberately minimal: no preload, no node integration, nothing but a window pointed at a file.
// The prototypes are third-party design references — this shell renders them, it never trusts
// them. `support.js` beside them is prototype runtime and is never loaded by the app itself.
const { app, BrowserWindow, nativeTheme } = require('electron')
const { parseScreen, referenceFile, canLoadReferenceUrl, windowOptions } = require('./launch-config')

// Which prototype to show. `npm run design:v2 -- Board` picks another; the default is the screen
// that carries the whole shell (app bar, rail, FAB, nodes), which is what a comparison is usually
// about.
let screen
try {
  screen = parseScreen(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  app.exit(2)
}
const file = screen && referenceFile(screen)
app.commandLine.appendSwitch('force-device-scale-factor', '1')
nativeTheme.themeSource = 'dark'

app.whenReady().then(() => {
  const win = new BrowserWindow(windowOptions(screen))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !canLoadReferenceUrl(details.url, file) })
  })
  win.webContents.once('did-finish-load', () => {
    void win.webContents.executeJavaScript("document.documentElement.dataset.designReferenceReady = 'true'; document.documentElement.dataset.theme = 'dark'; document.documentElement.style.setProperty('color-scheme', 'dark'); const style=document.createElement('style'); style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}'; document.head.appendChild(style);")
  })
  void win.loadFile(file)
})

app.on('window-all-closed', () => app.quit())
