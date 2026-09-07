const path = require('node:path')
const SCREENS = Object.freeze(['Canvas', 'Board', 'Files', 'Settings', 'Overlays', 'Regex Builder', 'Welcome', 'Kids Mode', 'Tools', 'History'])
const DEFAULT_SCREEN = 'Canvas'
const REFERENCE_ROOT = path.resolve(__dirname, '..', 'v2')
function parseScreen(argv) {
  if (argv.length === 0) return DEFAULT_SCREEN
  if (argv.length !== 1 || argv[0].startsWith('-') || !SCREENS.includes(argv[0])) throw new Error(`usage: design:v2 [${SCREENS.join('|')}]`)
  return argv[0]
}
function referenceFile(screen) {
  if (!SCREENS.includes(screen)) throw new Error('unknown design reference screen')
  return path.join(REFERENCE_ROOT, `MD3 ${screen}.dc.html`)
}
function windowOptions(screen) {
  return {
    width: 1440, height: 940, useContentSize: true, show: true,
    backgroundColor: '#0A090D', title: `MD3 ${screen} - design reference`,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false, additionalArguments: ['--force-device-scale-factor=1'] }
  }
}
module.exports = { SCREENS, DEFAULT_SCREEN, REFERENCE_ROOT, parseScreen, referenceFile, windowOptions }
