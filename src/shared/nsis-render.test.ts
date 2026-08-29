import { describe, expect, it } from 'vitest'
import { defaultNsisLocalPaths, defaultNsisSpec } from './nsis-form-types'
import { renderNsisPreview } from './nsis-render'

describe('renderNsisPreview', () => {
  it('never shows an empty box: the untouched defaults render a full placeholder script', () => {
    // An empty appName would make the canonical renderer refuse outright, so this adapter
    // falls back to the same "Your App" placeholder the pre-unification preview used *before*
    // handing anything to the canonical renderer -- the untouched defaults still produce a real,
    // readable script rather than either a blank box or a refusal about a field nobody touched
    // yet. A genuine refusal (see the next test) is a different, deliberate outcome.
    const preview = renderNsisPreview(defaultNsisSpec(), defaultNsisLocalPaths())
    expect(preview).not.toContain("Can't render a full NSIS script yet")
    expect(preview).toContain('Name "Your App"')
    expect(preview).toContain('OutFile "App-Setup.exe"')
    expect(preview).toContain('RequestExecutionLevel user')
    expect(preview).toContain('SetCompressor lzma')
  })

  it('refuses -- with the real reason, not a silently accepted script -- when the picked source paths are absolute', () => {
    // NsisLocalPaths carries absolute machine paths by design (see nsis-form-types.ts). The
    // canonical renderer's security boundary refuses an absolute item path rather than trying to
    // guess a safe relative one, and this adapter must surface that refusal rather than hide it.
    const spec = { ...defaultNsisSpec(), appName: 'Acme Tool', publisher: 'Acme Corp' }
    const local = { sourcePaths: ['C:\\build\\out\\Acme Tool'] }
    const preview = renderNsisPreview(spec, local)
    expect(preview).toContain("Can't render a full NSIS script yet")
    expect(preview).toContain('items[0].sourcePath must be a relative path')
  })

  it('renders a real script through the canonical renderer once every field is safe', () => {
    const spec = {
      ...defaultNsisSpec(),
      appName: 'Acme Tool',
      version: '2.3.1',
      publisher: 'Acme Corp',
      installRoot: 'program-files-64' as const,
      compression: 'bzip2' as const,
      perMachine: true,
    }
    // Relative paths, unlike the machine-absolute ones NsisLocalPaths normally carries -- this is
    // the "everything the security boundary can make safe" happy path.
    const local = {
      sourcePaths: ['dist\\Acme Tool'],
      licensePath: 'LICENSE.txt',
      iconPath: 'app.ico',
    }
    const script = renderNsisPreview(spec, local)
    expect(script).not.toContain("Can't render")
    expect(script).toContain('Name "Acme Tool"')
    expect(script).toContain('InstallDir "$PROGRAMFILES64\\Acme Tool"')
    expect(script).toContain('RequestExecutionLevel admin')
    expect(script).toContain('SetCompressor bzip2')
    expect(script).toContain('File /r "dist\\Acme Tool\\*.*"')
    expect(script).toContain('WriteUninstaller')
    expect(script).toContain('CreateShortcut "$DESKTOP\\Acme Tool.lnk" "$INSTDIR\\Acme Tool.exe"')
  })

  it('maps the per-user-Program-Files UI root onto localAppData + a Programs sub-path', () => {
    const spec = { ...defaultNsisSpec(), appName: 'Acme', installRoot: 'local-app-data' as const }
    const script = renderNsisPreview(spec, defaultNsisLocalPaths())
    expect(script).toContain('InstallDir "$LOCALAPPDATA\\Acme"')

    const perUser = { ...defaultNsisSpec(), appName: 'Acme', installRoot: 'per-user-program-files' as const }
    const perUserScript = renderNsisPreview(perUser, defaultNsisLocalPaths())
    expect(perUserScript).toContain('InstallDir "$LOCALAPPDATA\\Programs\\Acme"')
  })

  it('honors an explicit output filename over the derived one', () => {
    const spec = { ...defaultNsisSpec(), appName: 'Acme', outputFileName: 'custom-name.exe' }
    const script = renderNsisPreview(spec, defaultNsisLocalPaths())
    expect(script).toContain('OutFile "custom-name.exe"')
  })

  it('omits the uninstaller section when the user turned it off', () => {
    const spec = { ...defaultNsisSpec(), appName: 'Acme', includeUninstaller: false }
    const script = renderNsisPreview(spec, defaultNsisLocalPaths())
    expect(script).not.toContain('WriteUninstaller')
    expect(script).not.toContain('Section "Uninstall"')
  })

  it('quotes a double quote inside a text field rather than breaking the script', () => {
    const spec = { ...defaultNsisSpec(), appName: 'Weird "App" Name' }
    const script = renderNsisPreview(spec, defaultNsisLocalPaths())
    expect(script).toContain('Name "Weird $\\"App$\\" Name"')
  })
})
