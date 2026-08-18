// Standalone Electron shell for comparing the design prototype against the running app.
//
// Deliberately NOT wired into the product's own Electron main process: this is a design tool, it
// must never ship inside nodeterm, and keeping it a separate entry point means it cannot
// accidentally acquire product IPC, the preload bridge, or a window the user could mistake for
// the app. Launch it with `npm run design:compare`.
//
// `webviewTag` is on because the two panes load unrelated origins (a local design file and the
// dev server) and each needs its own isolated frame — an <iframe> would let the design prototype's
// scripts reach into this window, and the prototype is a full interactive app, not a static mock.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1800,
    height: 1050,
    title: 'nodeterm — design compare',
    backgroundColor: '#111318', // the design's own dark surface, so launch has no white flash
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenuBarVisibility(false)
  void win.loadFile(path.join(__dirname, 'index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// No macOS carve-out: quitting on last window closed is the Windows/Linux convention, and this
// repository is Windows-only (see docs/windows-support.md).
app.on('window-all-closed', () => app.quit())
