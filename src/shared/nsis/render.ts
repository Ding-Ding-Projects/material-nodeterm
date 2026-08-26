// Pure renderer: NsisInstallerSpec -> a complete .nsi script, as a string.
//
// No filesystem access, no child_process, no Electron import (this file lives in src/core, which
// src/core/no-electron.test.ts enforces never imports `electron` or `../main/*`). The caller is
// responsible for writing the returned string to disk and for actually running makensis.
//
// Three kinds of string reach the output, and each takes a different helper — mixing them up is
// exactly the bug this file had during development (see git history / the commit message):
//   - Pure untrusted text (appName, publisher, a user-typed folder name) -> nsisString(): every
//     character escaped, including `$`, so it can never reference a variable or close the string.
//   - Pure trusted literal NSIS syntax with NO user text at all (e.g. "$INSTDIR\Uninstall.exe",
//     which this module writes itself) -> nsisRawString(): wrapped in quotes, NOT escaped, so
//     `$INSTDIR` really does expand at install time.
//   - A mix — a trusted `$VAR` prefix followed by untrusted text, like
//     "$INSTDIR\<user's destSubPath>" -> nsisQuoted(): the $VAR part stays raw, the user part is
//     escaped, in ONE string literal. Running the whole mixed value through nsisString() would
//     escape the live $INSTDIR reference into the four literal characters "$INSTDIR", which is
//     the bug; running it through nsisRawString() would leave the user's text unescaped, which is
//     the security hole.
// Every closed-vocabulary value (install root, compression, scope) is re-validated against its
// real set rather than trusted from the TypeScript type, exactly as escape.ts documents.

import {
  assertNsisInstallScope,
  assertSafeRelativePath,
  isValidNsisVersion,
  nsisCompressionDirective,
  nsisInstallRootVar,
  nsisQuoted,
  nsisString,
  padVersionToFour,
  NsisSpecError,
  type NsisQuotedPart
} from './escape'
import type { NsisInstallerSpec, NsisInstallItem } from './spec'

/** A fully trusted literal — built entirely by this module, no user text inside it — wrapped in
 *  NSIS string-literal quotes with no character escaping applied. Never pass anything derived
 *  from a spec field to this function; use nsisString() or nsisQuoted() for that. */
function nsisRawString(raw: string): string {
  return `"${raw}"`
}

function toWindowsPath(relativePath: string): string {
  return relativePath.replace(/\//g, '\\')
}

function joinInstallSubPath(destSubPath: string | undefined, fieldName: string): string {
  if (!destSubPath) return ''
  const safe = assertSafeRelativePath(destSubPath, fieldName)
  return toWindowsPath(safe)
}

/** `$INSTDIR` (or another raw root) plus an optional escaped user sub-path, as one quoted
 *  literal. `subPath` is untrusted text (a folder the user typed or a validated relative path)
 *  and is always the `text` part; `rootRaw` must come from this module's own code, never a spec
 *  field. */
function rootedQuoted(rootRaw: string, subPath: string): string {
  const parts: NsisQuotedPart[] = [{ raw: rootRaw }]
  if (subPath) parts.push({ raw: '\\' }, { text: subPath })
  return nsisQuoted(parts)
}

function renderInstallItem(item: NsisInstallItem, index: number): string[] {
  const sourcePath = assertSafeRelativePath(item.sourcePath, `items[${index}].sourcePath`)
  if (sourcePath.length === 0) {
    throw new NsisSpecError(`items[${index}].sourcePath must not be empty`)
  }
  const destSub = joinInstallSubPath(item.destSubPath, `items[${index}].destSubPath`)
  const lines: string[] = []
  lines.push(`SetOutPath ${rootedQuoted('$INSTDIR', destSub)}`)
  const winSource = toWindowsPath(sourcePath)
  if (item.isDirectory) {
    // `/r` recurses. NSIS's File directive with a trailing `\*.*` pulls the directory's
    // CONTENTS into outDir, matching how a single-file entry places a file directly under
    // destSubPath rather than nesting an extra folder level. This value has no live NSIS
    // variable in it — it is a plain filesystem path relative to the project the spec was built
    // for — so the ordinary all-escaped nsisString() is correct here, unlike the $INSTDIR-rooted
    // install-time paths above.
    lines.push(`File /r ${nsisString(`${winSource}\\*.*`)}`)
  } else {
    lines.push(`File ${nsisString(winSource)}`)
  }
  return lines
}

function shortcutTargetExe(spec: NsisInstallerSpec): string {
  if (!spec.mainExecutable) {
    throw new NsisSpecError('mainExecutable is required when a shortcut is enabled')
  }
  const safe = assertSafeRelativePath(spec.mainExecutable, 'mainExecutable')
  return rootedQuoted('$INSTDIR', toWindowsPath(safe))
}

/** Render a complete .nsi script for the given spec. Throws NsisSpecError (never a silently
 *  substituted/clipped value) on anything the security boundary in escape.ts refuses. */
export function renderNsis(spec: NsisInstallerSpec): string {
  if (!spec.appName || spec.appName.trim().length === 0) {
    throw new NsisSpecError('appName must not be empty')
  }
  if (!isValidNsisVersion(spec.version)) {
    throw new NsisSpecError(
      `version must be 1-4 dot-separated integers each 0-65535; got ${JSON.stringify(spec.version)}`
    )
  }
  if (!/^[^\\/]+\.exe$/i.test(spec.outFile)) {
    throw new NsisSpecError(
      `outFile must be a bare filename ending in .exe with no path separators; got ${JSON.stringify(spec.outFile)}`
    )
  }

  const scope = assertNsisInstallScope(spec.installScope)
  const version4 = padVersionToFour(spec.version)
  const installSubPath = joinInstallSubPath(spec.installSubPath ?? spec.appName, 'installSubPath')
  const installRootVar = nsisInstallRootVar(spec.installRoot)
  const generateUninstaller = spec.generateUninstaller ?? true

  const lines: string[] = []

  lines.push(`; Generated by nodeterm's NSIS core. Do not hand-edit; regenerate from the spec.`)
  lines.push(`Unicode true`)
  lines.push(`Name ${nsisString(spec.appName)}`)
  lines.push(`OutFile ${nsisString(spec.outFile)}`)
  lines.push(`InstallDir ${rootedQuoted(installRootVar, installSubPath)}`)
  lines.push(`RequestExecutionLevel ${scope === 'perMachine' ? 'admin' : 'user'}`)
  lines.push(nsisCompressionDirective(spec.compression))
  lines.push('')

  lines.push(`VIProductVersion "${version4}"`)
  lines.push(`VIAddVersionKey "ProductName" ${nsisString(spec.appName)}`)
  lines.push(`VIAddVersionKey "CompanyName" ${nsisString(spec.publisher)}`)
  lines.push(`VIAddVersionKey "FileVersion" ${nsisString(spec.version)}`)
  lines.push(`VIAddVersionKey "ProductVersion" ${nsisString(spec.version)}`)
  lines.push('')

  if (spec.iconFile) {
    const iconPath = assertSafeRelativePath(spec.iconFile, 'iconFile')
    lines.push(`Icon ${nsisString(toWindowsPath(iconPath))}`)
    lines.push(`UninstallIcon ${nsisString(toWindowsPath(iconPath))}`)
    lines.push('')
  }

  if (spec.licenseFile) {
    const licensePath = assertSafeRelativePath(spec.licenseFile, 'licenseFile')
    lines.push(`!include "MUI2.nsh"`)
    lines.push(`!insertmacro MUI_PAGE_LICENSE ${nsisString(toWindowsPath(licensePath))}`)
    lines.push(`!insertmacro MUI_PAGE_DIRECTORY`)
    lines.push(`!insertmacro MUI_PAGE_INSTFILES`)
    lines.push(`!insertmacro MUI_UNPAGE_CONFIRM`)
    lines.push(`!insertmacro MUI_UNPAGE_INSTFILES`)
    lines.push(`!insertmacro MUI_LANGUAGE "English"`)
    lines.push('')
  }

  lines.push(`Section "Install"`)
  lines.push(`  SetShellVarContext ${scope === 'perMachine' ? 'all' : 'current'}`)
  for (const [index, item] of spec.items.entries()) {
    for (const line of renderInstallItem(item, index)) {
      lines.push(`  ${line}`)
    }
  }

  if (spec.startMenuShortcut?.enabled) {
    const exe = shortcutTargetExe(spec)
    const folder = spec.startMenuShortcut.folderName ?? spec.appName
    lines.push(`  CreateDirectory ${rootedQuoted('$SMPROGRAMS', folder)}`)
    lines.push(
      `  CreateShortcut ${rootedQuoted('$SMPROGRAMS', `${folder}\\${spec.appName}.lnk`)} ${exe}`
    )
  }
  if (spec.desktopShortcut?.enabled) {
    const exe = shortcutTargetExe(spec)
    lines.push(`  CreateShortcut ${rootedQuoted('$DESKTOP', `${spec.appName}.lnk`)} ${exe}`)
  }

  if (generateUninstaller) {
    lines.push(`  WriteUninstaller ${nsisRawString('$INSTDIR\\Uninstall.exe')}`)
    const uninstallKey = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${spec.appName}`
    lines.push(`  WriteRegStr HKLM ${nsisString(uninstallKey)} "DisplayName" ${nsisString(spec.appName)}`)
    lines.push(
      `  WriteRegStr HKLM ${nsisString(uninstallKey)} "UninstallString" ${nsisRawString('$INSTDIR\\Uninstall.exe')}`
    )
    lines.push(`  WriteRegStr HKLM ${nsisString(uninstallKey)} "Publisher" ${nsisString(spec.publisher)}`)
    lines.push(`  WriteRegStr HKLM ${nsisString(uninstallKey)} "DisplayVersion" ${nsisString(spec.version)}`)
  }

  lines.push(`SectionEnd`)
  lines.push('')

  if (generateUninstaller) {
    lines.push(`Section "Uninstall"`)
    lines.push(`  SetShellVarContext ${scope === 'perMachine' ? 'all' : 'current'}`)
    lines.push(`  RMDir /r ${nsisRawString('$INSTDIR')}`)
    if (spec.startMenuShortcut?.enabled) {
      const folder = spec.startMenuShortcut.folderName ?? spec.appName
      lines.push(`  Delete ${rootedQuoted('$SMPROGRAMS', `${folder}\\${spec.appName}.lnk`)}`)
      lines.push(`  RMDir ${rootedQuoted('$SMPROGRAMS', folder)}`)
    }
    if (spec.desktopShortcut?.enabled) {
      lines.push(`  Delete ${rootedQuoted('$DESKTOP', `${spec.appName}.lnk`)}`)
    }
    const uninstallKey = `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${spec.appName}`
    lines.push(`  DeleteRegKey HKLM ${nsisString(uninstallKey)}`)
    lines.push(`SectionEnd`)
    lines.push('')
  }

  return lines.join('\r\n') + '\r\n'
}
