import { describe, expect, it } from 'vitest'
import config from '../design/v2-preview/launch-config.js'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

describe('design v2 preview launch config', () => {
  it('accepts exactly the ten inventoried screens', () => {
    expect(config.SCREENS).toHaveLength(10)
    for (const screen of config.SCREENS) expect(config.parseScreen([screen])).toBe(screen)
  })
  it('defaults Canvas and rejects flags, path escape, and unknown screens', () => {
    expect(config.parseScreen([])).toBe('Canvas')
    for (const value of ['--screen', '../Canvas', 'Canvas/../Board', 'Unknown']) expect(() => config.parseScreen([value])).toThrow()
  })
  it('resolves only checked-in references inside design/v2', () => {
    expect(config.referenceFile('Canvas')).toMatch(/design[\\/]v2[\\/]MD3 Canvas[.]dc[.]html$/)
    expect(() => config.referenceFile('../Canvas')).toThrow()
  })
  it('builds fixed content geometry and permits only required reference assets', () => {
    expect(config.windowOptions('Canvas')).toMatchObject({ width: 1440, height: 940, useContentSize: true })
    const selected = config.referenceFile('Canvas')
    expect(config.canLoadReferenceUrl(`file:///${selected.replace(/\\/g, '/')}`, selected)).toBe(true)
    expect(config.canLoadReferenceUrl(`file:///${selected.replace(/\\/g, '/').replace('MD3 Canvas.dc.html', 'support.js')}`, selected)).toBe(true)
    expect(config.canLoadReferenceUrl(`file:///${selected.replace(/\\/g, '/').replace('MD3 Canvas.dc.html', 'md3/tokens.css')}`, selected)).toBe(true)
    expect(config.canLoadReferenceUrl(`file:///${selected.replace(/\\/g, '/').replace('MD3 Canvas.dc.html', 'md3/assets/claude.svg')}`, selected)).toBe(true)
    expect(config.canLoadReferenceUrl(`file:///${selected.replace(/\\/g, '/').replace('MD3 Canvas.dc.html', 'other.js')}`, selected)).toBe(false)
    expect(config.canLoadReferenceUrl('https://example.test/x.js', selected)).toBe(false)
    expect(config.canLoadReferenceUrl('file:///C:/Windows/win.ini', selected)).toBe(false)
    expect(config.canLoadReferenceUrl('file:///%', selected)).toBe(false)
  })

  it('uses only the supported Electron APIs and marks readiness after load', async () => {
    const events = {}; const calls = []; let loaded
    const contents = { setWindowOpenHandler: (fn) => calls.push(['popup', fn()]), on: (n, fn) => events[n] = fn, once: (n, fn) => events[n] = fn,
      session: { webRequest: { onBeforeRequest: (fn) => calls.push(['network', fn]) } }, executeJavaScript: async () => calls.push(['ready']) }
    const electron = { app: { commandLine: { appendSwitch: (...v) => calls.push(['switch', v]) }, whenReady: () => Promise.resolve(), on: () => {}, exit: () => {} },
      BrowserWindow: function (opts) { calls.push(['window', opts]); return { webContents: contents, loadFile: async (file) => { loaded = file } } }, nativeTheme: {} }
    const source = fs.readFileSync(path.resolve('design/v2-preview/main.js'), 'utf8')
    vm.runInNewContext(source, { require: (id) => id === 'electron' ? electron : require(path.resolve('design/v2-preview', id.replace('./', ''))), process: { argv: ['node', 'main.js'] }, console, setTimeout })
    await new Promise((r) => setTimeout(r, 0))
    expect(electron.nativeTheme.themeSource).toBe('dark')
    expect(calls[0]).toEqual(['switch', ['force-device-scale-factor', '1']])
    expect(calls.find(([k]) => k === 'window')[1]).toMatchObject({ width: 1440, height: 940, useContentSize: true })
    expect(calls.find(([k]) => k === 'popup')[1]).toEqual({ action: 'deny' })
    expect(loaded).toMatch(/MD3 Canvas[.]dc[.]html$/)
    expect(calls.find(([k]) => k === 'ready')).toBeUndefined()
    await events['did-finish-load']()
    expect(calls.find(([k]) => k === 'ready')).toBeDefined()
  })
})
