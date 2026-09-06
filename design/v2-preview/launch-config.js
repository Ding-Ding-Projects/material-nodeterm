const path = require('node:path')
const { fileURLToPath } = require('node:url')

const SCREENS = Object.freeze(['Canvas', 'Board', 'Files', 'Settings', 'Overlays', 'Regex Builder', 'Welcome', 'Kids Mode', 'Tools', 'History'])
const DEFAULT_SCREEN = 'Canvas'
const REFERENCE_ROOT = path.resolve(__dirname, '..', 'v2')

function parseScreen(argv) {
  if (argv.length === 0) return DEFAULT_SCREEN
  if (argv.length !== 1 || argv[0].startsWith('-') || !SCREENS.includes(argv[0])) {
    throw new Error(`usage: design:v2 [${SCREENS.join('|')}]`)
  }
  return argv[0]
}

function referenceFile(screen) {
  if (!SCREENS.includes(screen)) throw new Error('unknown design reference screen')
  return path.join(__dirname, '..', 'v2', `MD3 ${screen}.dc.html`)
}

function canLoadReferenceUrl(url, selectedFile) {
  let parsed
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol !== 'file:') return false
  let candidate
  try { candidate = path.resolve(fileURLToPath(parsed)) } catch { return false }
  const root = path.dirname(path.resolve(selectedFile))
  const md3 = path.join(root, 'md3') + path.sep
  return candidate === path.resolve(selectedFile) || candidate === path.join(root, 'support.js') ||
    (candidate.startsWith(md3) && /[.](css|svg)$/i.test(candidate))
}

function windowOptions(screen) {
  return {
    width: 1440, height: 940, useContentSize: true, show: true,
    backgroundColor: '#0A090D', title: `MD3 ${screen} — design reference`,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, additionalArguments: ['--force-device-scale-factor=1'] }
  }
}

module.exports = { SCREENS, DEFAULT_SCREEN, parseScreen, referenceFile, canLoadReferenceUrl, windowOptions }
