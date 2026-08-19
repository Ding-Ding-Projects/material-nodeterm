// A plain Electron shell that renders one v2 design prototype at its own 1440x900 frame, so the
// design and the running app can be captured under identical conditions and set side by side.
//
// Deliberately minimal: no preload, no node integration, nothing but a window pointed at a file.
// The prototypes are third-party design references — this shell renders them, it never trusts
// them. `support.js` beside them is prototype runtime and is never loaded by the app itself.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

// Which prototype to show. `npm run design:v2 -- Board` picks another; the default is the screen
// that carries the whole shell (app bar, rail, FAB, nodes), which is what a comparison is usually
// about.
const screen = process.argv.slice(2).find((a) => !a.startsWith('-')) || 'Canvas'
const file = path.join(__dirname, '..', 'v2', `MD3 ${screen}.dc.html`)

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    show: true,
    backgroundColor: '#0A090D',
    title: `MD3 ${screen} — design reference`,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  void win.loadFile(file)
})

app.on('window-all-closed', () => app.quit())
