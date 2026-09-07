import { describe, expect, it } from 'vitest'
import { JSDOM, requestInterceptor, VirtualConsole } from 'jsdom'
import config from '../design/v2-preview/launch-config.js'
import offline from '../design/v2-preview/offline-assets.js'
import readiness from '../design/v2-preview/readiness.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
const require = createRequire(import.meta.url)

describe('design v2 offline reference renderer', () => {
  it('accepts exactly the ten inventoried screens and rejects extra arguments', () => {
    expect(config.SCREENS).toHaveLength(10)
    expect(config.parseScreen([])).toBe('Canvas')
    for (const screen of config.SCREENS) expect(config.parseScreen([screen])).toBe(screen)
    for (const args of [['--screen'], ['../Canvas'], ['Unknown'], ['Canvas', 'Board']]) expect(() => config.parseScreen(args)).toThrow()
    expect(config.windowOptions('Canvas')).toMatchObject({ width: 1440, height: 940, useContentSize: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } })
  })
  it('snapshots exact reference and pinned assets, excluding sibling files and unknown hosts', async () => {
    const assets = offline.createAssetStore(config.referenceFile('Canvas'))
    const handlers = {}; const callbacks = {}; const failures = []
    offline.installAssetRoutes({ protocol: { handle: (scheme, fn) => handlers[scheme] = fn }, webRequest: {
      onBeforeRequest: (fn) => callbacks.before = fn, onErrorOccurred: (fn) => callbacks.error = fn
    } }, assets, (message) => failures.push(message))
    for (const [url, asset] of assets) {
      let reply
      callbacks.before({ url, method: 'GET' }, (r) => { reply = r })
      expect(reply).toEqual({ cancel: false })
      const result = await handlers[new URL(url).protocol.slice(0, -1)]({ url, method: 'GET' })
      expect(Buffer.from(await result.arrayBuffer())).toEqual(asset.bytes)
    }
    for (const url of ['https://example.test/a.js', 'https://unpkg.com/react@latest/index.js', pathToFileURL(config.referenceFile('Board')).href, 'file:///C:/Windows/win.ini', 'file:///%']) {
      let reply
      callbacks.before({ url, method: 'GET' }, (r) => { reply = r })
      expect(reply).toEqual({ cancel: true })
      expect(handlers.https({ url, method: 'GET' }).status).toBe(403)
    }
    const [allowed] = assets.keys()
    expect(handlers.file({ url: allowed, method: 'POST' }).status).toBe(403)
    callbacks.error({})
    expect(failures.at(-1)).toBe('reference asset request failed')
  })
  it('rejects redirected ancestors and out-of-root paths, and snapshots stable bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-assets-'))
    const inside = path.join(root, 'inside'); const outside = path.join(root, 'outside')
    fs.mkdirSync(inside); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'asset.css'), 'foreign')
    try {
      fs.symlinkSync(outside, path.join(inside, 'redirect'), 'junction')
      expect(() => offline.readSafeBytes(path.join(inside, 'redirect', 'asset.css'), inside)).toThrow(/linked|redirected/)
      expect(() => offline.readSafeBytes(path.join(outside, 'asset.css'), inside)).toThrow(/outside/)
      fs.writeFileSync(path.join(inside, 'asset.css'), 'first')
      const snapshot = offline.readSafeBytes(path.join(inside, 'asset.css'), inside)
      fs.writeFileSync(path.join(inside, 'asset.css'), 'second')
      expect(snapshot.toString()).toBe('first')
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
  it('rejects a corrupt pinned runtime before a renderer is created', () => {
    const source = fs.readFileSync(path.resolve('design/v2-preview/offline-assets.js'), 'utf8')
    const fakeFs = { ...fs, readFileSync: (file, ...args) => {
      const bytes = fs.readFileSync(file, ...args)
      return String(file).endsWith('react-18.3.1.production.min.js') ? Buffer.alloc(bytes.length) : bytes
    } }
    const context = { require: (id) => id === 'node:fs' ? fakeFs : id === './launch-config' ? config : require(id), __dirname: path.resolve('design/v2-preview'), module: { exports: {} }, Response, Buffer }
    vm.runInNewContext(source, context)
    expect(() => context.module.exports.createAssetStore(config.referenceFile('Canvas'))).toThrow(/integrity/)
  })

  for (const screen of config.SCREENS) it(`boots the untouched ${screen} reference with real local React and support.js`, async () => {
    const file = config.referenceFile(screen); const assets = offline.createAssetStore(file); const blocked = []
    const resources = { interceptors: [requestInterceptor((request) => {
      const asset = assets.get(request.url)
      if (!asset) { blocked.push(request.url); return new Response('', { status: 403 }) }
      return new Response(asset.bytes, { headers: { 'Content-Type': asset.contentType } })
    })] }
    const errors = []
    const virtualConsole = new VirtualConsole()
    virtualConsole.on('error', (...args) => errors.push(args.join(' ')))
    virtualConsole.on('jsdomError', (error) => { if (error.type !== 'css-parsing') errors.push(error.message) })
    const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
      url: `${pathToFileURL(file).href}?theme=dark`, runScripts: 'dangerously', resources, virtualConsole,
      beforeParse(window) {
        window.fetch = async (url) => {
          const asset = assets.get(String(url)); if (!asset) { blocked.push(url); throw new Error('blocked') }
          return { ok: true, text: async () => asset.bytes.toString() }
        }
        window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
        window.ResizeObserver = class { observe() {} disconnect() {} }
      }
    })
    try {
      const start = Date.now()
      while (!dom.window.document.querySelector('#dc-root > .sc-host') && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 20))
      const doc = dom.window.document
      expect(errors).toEqual([])
      expect(blocked).toEqual([])
      expect(doc.querySelector('x-dc')).toBeNull()
      expect(doc.querySelector('.sc-logic-error,.sc-has-error')).toBeNull()
      const host = doc.querySelector('#dc-root > .sc-host')
      expect(host?.childElementCount).toBeGreaterThan(0)
      expect(host?.textContent.length).toBeGreaterThan(100)
      expect(doc.documentElement.dataset.theme).toBe('dark')
      expect(doc.head.textContent).toContain('background:#2e2c26')
    } finally { dom.window.close() }
  }, 10000)
})

function readyFixture() {
  const dom = new JSDOM('<html data-theme="dark"><head><link rel="stylesheet"><link rel="stylesheet"><link rel="stylesheet"></head><body><div id="dc-root"><div class="sc-host"><main>Rendered reference</main></div></div></body></html>', { runScripts: 'outside-only' })
  const doc = dom.window.document
  const faces = ['Outfit', 'Roboto Mono', 'Material Symbols Rounded'].map((family) => ({ family, status: 'loaded' }))
  faces.status = 'loaded'; faces.load = async () => [faces[0]]
  Object.defineProperty(doc, 'fonts', { value: faces })
  for (const link of doc.querySelectorAll('link')) Object.defineProperty(link, 'sheet', { value: {}, configurable: true })
  doc.querySelector('.sc-host').getBoundingClientRect = () => ({ width: 1440, height: 900 })
  return { dom, doc, faces, probe: () => dom.window.eval(readiness.readinessScript) }
}

describe('semantic reference readiness', () => {
  it('waits for actual fonts and freezes animations before accepting the root', async () => {
    const f = readyFixture()
    try {
      expect(f.probe()).toEqual({ state: 'pending' })
      await new Promise((r) => setTimeout(r, 0))
      expect(f.probe()).toEqual({ state: 'ready' })
      expect(f.doc.getElementById('design-reference-freeze').textContent).toContain('animation:none')
    } finally { f.dom.window.close() }
  })
  for (const [name, mutate, state] of [
    ['missing root', (f) => f.doc.getElementById('dc-root').remove(), 'pending'],
    ['raw template', (f) => f.doc.body.appendChild(f.doc.createElement('x-dc')), 'pending'],
    ['logic error', (f) => f.doc.body.innerHTML += '<div class="sc-logic-error">broken</div>', 'failed'],
    ['unloaded sheet', (f) => Object.defineProperty(f.doc.querySelector('link'), 'sheet', { value: null }), 'pending'],
    ['font failure', (f) => { f.faces[0].status = 'error' }, 'failed'],
    ['missing family', (f) => f.faces.pop(), 'pending'],
    ['wrong theme', (f) => { f.doc.documentElement.dataset.theme = 'light' }, 'pending']
  ]) it(`does not accept ${name}`, async () => {
    const f = readyFixture()
    try { f.probe(); await new Promise((r) => setTimeout(r, 0)); mutate(f); expect(f.probe().state).toBe(state) }
    finally { f.dom.window.close() }
  })
  it('waits across delayed boot and fails bounded missing, rejected, and blocked boot', async () => {
    let time = 0; let calls = 0
    const options = { failures: [], now: () => time, sleep: async (ms) => { time += ms }, timeoutMs: 500, intervalMs: 50 }
    await readiness.waitForReference({ ...options, probe: async () => ({ state: ++calls < 4 ? 'pending' : 'ready' }) })
    expect(calls).toBe(6)
    time = 0
    await expect(readiness.waitForReference({ ...options, probe: async () => ({ state: 'pending' }) })).rejects.toThrow(/deadline/)
    time = 0
    await expect(readiness.waitForReference({ ...options, failures: ['blocked asset'], probe: async () => ({ state: 'ready' }) })).rejects.toThrow('blocked asset')
    await expect(readiness.waitForReference({ ...options, probe: async () => { throw new Error('renderer gone') } })).rejects.toThrow('renderer gone')
  })
})
