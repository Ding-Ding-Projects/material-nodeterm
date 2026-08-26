import { describe, it, expect } from 'vitest'
import { renderNsis } from './render'
import { NsisSpecError } from './escape'
import type { NsisInstallerSpec } from './spec'

function baseSpec(overrides: Partial<NsisInstallerSpec> = {}): NsisInstallerSpec {
  return {
    appName: 'Widget Studio',
    version: '1.2.3',
    publisher: 'Widgets Inc.',
    outFile: 'WidgetStudioSetup.exe',
    installRoot: 'programFiles64',
    items: [{ sourcePath: 'dist/app.exe' }],
    mainExecutable: 'app.exe',
    installScope: 'perMachine',
    compression: 'lzma',
    ...overrides
  }
}

describe('renderNsis — a normal render', () => {
  it('produces a script with the expected top-level directives', () => {
    const script = renderNsis(baseSpec())
    expect(script).toContain('Name "Widget Studio"')
    expect(script).toContain('OutFile "WidgetStudioSetup.exe"')
    expect(script).toContain('InstallDir "$PROGRAMFILES64\\Widget Studio"')
    expect(script).toContain('RequestExecutionLevel admin')
    expect(script).toContain('SetCompressor lzma')
    expect(script).toContain('VIProductVersion "1.2.3.0"')
    expect(script).toContain('VIAddVersionKey "CompanyName" "Widgets Inc."')
    expect(script).toContain('Section "Install"')
    expect(script).toContain('SectionEnd')
    expect(script).toContain('File "dist\\app.exe"')
    // Uninstaller defaults to on.
    expect(script).toContain('Section "Uninstall"')
    expect(script).toContain('WriteUninstaller "$INSTDIR\\Uninstall.exe"')
  })

  it('per-user scope emits RequestExecutionLevel user and SetShellVarContext current', () => {
    const script = renderNsis(baseSpec({ installScope: 'perUser', installRoot: 'localAppData' }))
    expect(script).toContain('RequestExecutionLevel user')
    expect(script).toContain('SetShellVarContext current')
    expect(script).toContain('InstallDir "$LOCALAPPDATA\\Widget Studio"')
  })

  it('installSubPath overrides the default appName-derived leaf', () => {
    const script = renderNsis(baseSpec({ installSubPath: 'Custom\\Nested\\Path' }))
    expect(script).toContain('InstallDir "$PROGRAMFILES64\\Custom\\Nested\\Path"')
  })

  it('a directory item recurses with File /r into the item\'s contents', () => {
    const script = renderNsis(
      baseSpec({ items: [{ sourcePath: 'dist/resources', isDirectory: true, destSubPath: 'resources' }] })
    )
    expect(script).toContain('SetOutPath "$INSTDIR\\resources"')
    expect(script).toContain('File /r "dist\\resources\\*.*"')
  })

  it('generateUninstaller: false omits the whole uninstall section and registry writes', () => {
    const script = renderNsis(baseSpec({ generateUninstaller: false }))
    expect(script).not.toContain('Section "Uninstall"')
    expect(script).not.toContain('WriteUninstaller')
    expect(script).not.toContain('DeleteRegKey')
  })

  it('start menu and desktop shortcuts render CreateShortcut with the resolved exe path', () => {
    const script = renderNsis(
      baseSpec({
        startMenuShortcut: { enabled: true, folderName: 'Widget Studio' },
        desktopShortcut: { enabled: true }
      })
    )
    expect(script).toContain(
      'CreateShortcut "$SMPROGRAMS\\Widget Studio\\Widget Studio.lnk" "$INSTDIR\\app.exe"'
    )
    expect(script).toContain('CreateShortcut "$DESKTOP\\Widget Studio.lnk" "$INSTDIR\\app.exe"')
    // Uninstall removes them too.
    expect(script).toContain('Delete "$SMPROGRAMS\\Widget Studio\\Widget Studio.lnk"')
    expect(script).toContain('Delete "$DESKTOP\\Widget Studio.lnk"')
  })

  it('a license file wires in the MUI license page', () => {
    const script = renderNsis(baseSpec({ licenseFile: 'LICENSE.txt' }))
    expect(script).toContain('!include "MUI2.nsh"')
    expect(script).toContain('!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"')
  })

  it('an icon file emits both Icon and UninstallIcon', () => {
    const script = renderNsis(baseSpec({ iconFile: 'build/app.ico' }))
    expect(script).toContain('Icon "build\\app.ico"')
    expect(script).toContain('UninstallIcon "build\\app.ico"')
  })
})

describe('renderNsis — escaping cases, one per free-text field', () => {
  it('appName containing a quote cannot close the Name string early', () => {
    const script = renderNsis(baseSpec({ appName: 'Evil" \n!system "calc.exe' }))
    expect(script).toContain('Name "Evil$\\" $\\n!system $\\"calc.exe"')
    // Never produces a raw, unescaped `!system` directive line.
    expect(script).not.toMatch(/^!system/m)
  })

  it('appName containing a newline cannot inject a new script line', () => {
    const script = renderNsis(baseSpec({ appName: 'App\n!system "calc.exe"' }))
    // The whole hostile value must live inside one escaped Name "..." line.
    const nameLine = script.split('\r\n').find((l) => l.startsWith('Name '))
    expect(nameLine).toBeDefined()
    expect(nameLine).toContain('$\\n')
    expect(script).not.toMatch(/^!system/m)
  })

  it('publisher containing $ cannot reference $INSTDIR or a ${DEFINE}', () => {
    const script = renderNsis(baseSpec({ publisher: '$INSTDIR ${EVIL_DEFINE}' }))
    expect(script).toContain('VIAddVersionKey "CompanyName" "$$INSTDIR $${EVIL_DEFINE}"')
  })

  it('a trailing backslash in appName is passed through literally and still closes cleanly', () => {
    // NSIS has no general backslash-escaping (see escape.test.ts), so a lone trailing backslash
    // is not itself a hazard the way it would be in a C/shell string — it just renders as one
    // backslash, immediately followed by our own closing quote.
    const script = renderNsis(baseSpec({ appName: 'Trailing\\' }))
    const nameLine = script.split('\r\n').find((l) => l.startsWith('Name '))!
    expect(nameLine).toBe('Name "Trailing\\"')
  })

  it('${...} in appName is rendered as literal text, not expanded as an NSIS constant', () => {
    const script = renderNsis(baseSpec({ appName: '${PRODUCT_NAME}' }))
    expect(script).toContain('Name "$${PRODUCT_NAME}"')
  })

  it('every free-text field escapes independently: publisher injection does not touch appName output', () => {
    const script = renderNsis(
      baseSpec({ appName: 'Safe App', publisher: 'Evil" !system "rm -rf /' })
    )
    expect(script).toContain('Name "Safe App"')
    expect(script).toContain('VIAddVersionKey "CompanyName" "Evil$\\" !system $\\"rm -rf /"')
  })
})

describe('renderNsis — refused, not sanitised', () => {
  it('refuses an empty app name', () => {
    expect(() => renderNsis(baseSpec({ appName: '' }))).toThrow(NsisSpecError)
    expect(() => renderNsis(baseSpec({ appName: '   ' }))).toThrow(NsisSpecError)
  })

  it('refuses an invalid version string rather than truncating it to something valid', () => {
    expect(() => renderNsis(baseSpec({ version: '1.2.3-beta' }))).toThrow(NsisSpecError)
  })

  it('refuses an unknown install root (bypassing the compile-time type)', () => {
    const spec = baseSpec({ installRoot: 'systemRoot' as unknown as NsisInstallerSpec['installRoot'] })
    expect(() => renderNsis(spec)).toThrow(NsisSpecError)
  })

  it('refuses an unknown compression value', () => {
    const spec = baseSpec({ compression: 'gzip' as unknown as NsisInstallerSpec['compression'] })
    expect(() => renderNsis(spec)).toThrow(NsisSpecError)
  })

  it('refuses an unknown install scope', () => {
    const spec = baseSpec({ installScope: 'perProcess' as unknown as NsisInstallerSpec['installScope'] })
    expect(() => renderNsis(spec)).toThrow(NsisSpecError)
  })

  it('refuses a traversing source path rather than clipping the .. out', () => {
    const spec = baseSpec({ items: [{ sourcePath: '../../Windows/System32/evil.dll' }] })
    expect(() => renderNsis(spec)).toThrow(NsisSpecError)
  })

  it('refuses a traversing destSubPath', () => {
    const spec = baseSpec({
      items: [{ sourcePath: 'dist/app.exe', destSubPath: '..\\..\\Startup' }]
    })
    expect(() => renderNsis(spec)).toThrow(NsisSpecError)
  })

  it('refuses an absolute installSubPath', () => {
    const spec = baseSpec({ installSubPath: 'C:\\Windows\\System32' })
    expect(() => renderNsis(spec)).toThrow(NsisSpecError)
  })

  it('refuses a traversing licenseFile / iconFile', () => {
    expect(() => renderNsis(baseSpec({ licenseFile: '../../secrets.txt' }))).toThrow(NsisSpecError)
    expect(() => renderNsis(baseSpec({ iconFile: '..\\..\\evil.ico' }))).toThrow(NsisSpecError)
  })

  it('refuses an outFile with a path separator (must be a bare filename)', () => {
    expect(() => renderNsis(baseSpec({ outFile: '..\\..\\Setup.exe' }))).toThrow(NsisSpecError)
    expect(() => renderNsis(baseSpec({ outFile: 'sub/Setup.exe' }))).toThrow(NsisSpecError)
  })

  it('refuses an outFile that does not end in .exe', () => {
    expect(() => renderNsis(baseSpec({ outFile: 'Setup.msi' }))).toThrow(NsisSpecError)
  })

  it('refuses an empty sourcePath item', () => {
    expect(() => renderNsis(baseSpec({ items: [{ sourcePath: '' }] }))).toThrow(NsisSpecError)
  })

  it('refuses a shortcut with no mainExecutable', () => {
    const spec = baseSpec({
      mainExecutable: undefined,
      startMenuShortcut: { enabled: true }
    })
    expect(() => renderNsis(spec)).toThrow(NsisSpecError)
  })
})

describe('renderNsis — full realistic script snapshot', () => {
  it('matches the expected complete .nsi output', () => {
    const script = renderNsis(
      baseSpec({
        appName: 'Widget Studio',
        version: '2.0.4',
        publisher: 'Widgets Inc.',
        outFile: 'WidgetStudioSetup.exe',
        installRoot: 'programFiles64',
        items: [
          { sourcePath: 'dist/app.exe' },
          { sourcePath: 'dist/resources', isDirectory: true, destSubPath: 'resources' }
        ],
        licenseFile: 'LICENSE.txt',
        iconFile: 'build/app.ico',
        mainExecutable: 'app.exe',
        startMenuShortcut: { enabled: true },
        desktopShortcut: { enabled: true },
        installScope: 'perMachine',
        compression: 'lzma'
      })
    )
    expect(script).toMatchSnapshot()
  })
})
