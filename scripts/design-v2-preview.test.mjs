import { describe, expect, it } from 'vitest'
import config from '../design/v2-preview/launch-config.js'

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
})
