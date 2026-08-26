// Proves the re-export shim actually re-exports the real thing, not a stale copy. See spec.ts in
// this directory: the canonical implementation lives in src/shared/nsis/ now.
import { describe, expect, it } from 'vitest'
import { renderNsis } from './render'
import { NsisSpecError } from './escape'
import { NSIS_INSTALL_ROOTS } from './spec'
import { renderNsis as sharedRenderNsis } from '../../shared/nsis/render'

describe('src/core/nsis re-export shim', () => {
  it('is literally the same function as the shared canonical renderer', () => {
    expect(renderNsis).toBe(sharedRenderNsis)
  })

  it('still renders a real script through the core import path', () => {
    const script = renderNsis({
      appName: 'Widget Studio',
      version: '1.2.3',
      publisher: 'Widgets Inc.',
      outFile: 'WidgetStudioSetup.exe',
      installRoot: 'programFiles64',
      items: [{ sourcePath: 'dist/app.exe' }],
      mainExecutable: 'app.exe',
      installScope: 'perMachine',
      compression: 'lzma'
    })
    expect(script).toContain('Name "Widget Studio"')
  })

  it('still refuses through the core import path', () => {
    expect(() =>
      renderNsis({
        appName: '',
        version: '1.0.0',
        publisher: '',
        outFile: 'x.exe',
        installRoot: 'programFiles64',
        items: [],
        installScope: 'perUser',
        compression: 'zlib'
      })
    ).toThrow(NsisSpecError)
  })

  it('re-exports the closed install-root vocabulary', () => {
    expect(NSIS_INSTALL_ROOTS).toContain('programFiles64')
  })
})
