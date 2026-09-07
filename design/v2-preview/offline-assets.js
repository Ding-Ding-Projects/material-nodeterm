const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { REFERENCE_ROOT, SCREENS } = require('./launch-config')
const VENDOR_ROOT = path.join(__dirname, 'vendor')
const LOCAL_FILES = ['support.js', 'md3/tokens.css', 'md3/assets/claude.svg', 'md3/assets/codex-color.svg', 'md3/assets/gemini-color.svg', 'md3/assets/opencode.svg']

function readSafeBytes(file, root) {
  const absolute = path.resolve(file)
  const base = path.resolve(root)
  const relative = path.relative(base, absolute)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('asset outside permitted root')
  // Reject linked files, junctions, and redirected ancestors, including the root itself.
  for (let current = absolute; ; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink() || path.resolve(fs.realpathSync.native(current)).toLowerCase() !== current.toLowerCase()) {
      throw new Error('linked or redirected reference asset')
    }
    if (path.dirname(current) === current) break
  }
  const before = fs.statSync(absolute)
  if (!before.isFile() || before.size > 8 * 1024 * 1024) throw new Error('invalid reference asset size or type')
  const bytes = fs.readFileSync(absolute)
  const after = fs.statSync(absolute)
  if (before.ino !== after.ino || before.size !== bytes.length || before.mtimeMs !== after.mtimeMs || fs.realpathSync.native(absolute).toLowerCase() !== absolute.toLowerCase()) {
    throw new Error('reference asset changed during snapshot')
  }
  return bytes
}

function createAssetStore(selectedFile) {
  const selected = path.resolve(selectedFile)
  if (!SCREENS.some((name) => selected === path.join(REFERENCE_ROOT, `MD3 ${name}.dc.html`))) throw new Error('reference is not inventoried')
  const assets = new Map()
  for (const relative of [path.basename(selected), ...LOCAL_FILES]) {
    const file = path.join(REFERENCE_ROOT, relative)
    const contentType = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'image/svg+xml'
    const asset = { bytes: readSafeBytes(file, REFERENCE_ROOT), contentType }
    const url = pathToFileURL(file).href
    assets.set(url, asset)
    if (file === selected) assets.set(`${url}?theme=dark`, asset)
  }
  const manifest = JSON.parse(readSafeBytes(path.join(VENDOR_ROOT, 'manifest.json'), VENDOR_ROOT))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length !== 17) throw new Error('invalid vendor manifest')
  for (const entry of manifest.assets) {
    if (!/^https:\/\/(unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(entry.url) || assets.has(entry.url) || path.basename(entry.file) !== entry.file) throw new Error('invalid vendor entry')
    const bytes = readSafeBytes(path.join(VENDOR_ROOT, entry.file), VENDOR_ROOT)
    if (bytes.length !== entry.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`vendor integrity failed: ${entry.file}`)
    assets.set(entry.url, { bytes, contentType: entry.contentType })
  }
  return assets
}

function installAssetRoutes(isolated, assets, failed) {
  const handler = (request) => {
    const asset = request.method === 'GET' ? assets.get(request.url) : null
    if (!asset) { failed('non-inventoried asset blocked'); return new Response('', { status: 403 }) }
    return new Response(asset.bytes, { headers: {
      'Content-Type': asset.contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' file: https://unpkg.com; style-src 'unsafe-inline' file: https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src file:; connect-src file:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
    } })
  }
  // These are local protocol responses, never fetches or redirects to the named hosts.
  isolated.protocol.handle('https', handler)
  isolated.protocol.handle('http', handler)
  isolated.protocol.handle('file', handler)
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.method === 'GET' && assets.has(details.url)
    callback({ cancel: !allowed })
    if (!allowed) failed('non-inventoried request blocked')
  })
  isolated.webRequest.onErrorOccurred(() => failed('reference asset request failed'))
}
module.exports = { readSafeBytes, createAssetStore, installAssetRoutes }
