import { describe, expect, it } from 'vitest'
import { defaultNsisLocalPaths, defaultNsisSpec } from './nsis-form-types'
import { renderNsisPreview } from './nsis-render'

describe('renderNsisPreview', () => {
  it('renders a usable placeholder script from the untouched defaults', () => {
    const script = renderNsisPreview(defaultNsisSpec(), defaultNsisLocalPaths())
    // Always renders SOMETHING — never an empty box — with the missing pieces called out inline.
    expect(script).toContain('; TODO: add at least one source file or folder to package')
    expect(script).toContain('OutFile "App-Setup.exe"')
    expect(script).toContain('RequestExecutionLevel user')
    expect(script).toContain('SetCompressor /SOLID lzma')
  })

  it('renders a complete script once app name, sources and options are filled in', () => {
    const spec = {
      ...defaultNsisSpec(),
      appName: 'Acme Tool',
      version: '2.3.1',
      publisher: 'Acme Corp',
      installRoot: 'program-files-64' as const,
      compression: 'bzip2' as const,
      perMachine: true
    }
    const local = {
      sourcePaths: ['C:\\build\\out\\Acme Tool'],
      licensePath: 'C:\\src\\LICENSE.txt',
      iconPath: 'C:\\src\\app.ico'
    }
    const script = renderNsisPreview(spec, local)
    expect(script).toContain('Name "Acme Tool"')
    expect(script).toContain('OutFile "Acme-Tool-Setup.exe"')
    expect(script).toContain('InstallDir "$PROGRAMFILES64\\Acme Tool"')
    expect(script).toContain('RequestExecutionLevel admin')
    expect(script).toContain('SetCompressor bzip2')
    expect(script).toContain('LicenseData "C:\\src\\LICENSE.txt"')
    expect(script).toContain('Icon "C:\\src\\app.ico"')
    expect(script).toContain('File /r "C:\\build\\out\\Acme Tool"')
    expect(script).toContain('WriteUninstaller')
    expect(script).toContain('CreateShortCut "$DESKTOP\\Acme Tool.lnk"')
    expect(script).not.toContain('; TODO:')
  })

  it('honors an explicit output filename over the derived one', () => {
    const spec = { ...defaultNsisSpec(), appName: 'Acme', outputFileName: 'custom-name.exe' }
    const script = renderNsisPreview(spec, defaultNsisLocalPaths())
    expect(script).toContain('OutFile "custom-name.exe"')
  })

  it('omits the uninstaller section when the user turned it off', () => {
    const spec = { ...defaultNsisSpec(), appName: 'Acme', includeUninstaller: false }
    const script = renderNsisPreview(spec, { sourcePaths: ['C:\\x'] })
    expect(script).not.toContain('WriteUninstaller')
    expect(script).not.toContain('Section "Uninstall"')
  })

  it('quotes a double quote inside a text field rather than breaking the script', () => {
    const spec = { ...defaultNsisSpec(), appName: 'Weird "App" Name' }
    const script = renderNsisPreview(spec, defaultNsisLocalPaths())
    expect(script).toContain('Name "Weird $\\"App$\\" Name"')
  })
})
