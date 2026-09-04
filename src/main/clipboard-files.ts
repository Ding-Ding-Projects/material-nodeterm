import { spawn } from 'node:child_process'
import { isAbsolute, join } from 'node:path'

const MAX_CLIPBOARD_FILES = 64
const MAX_STDERR_BYTES = 8 * 1024

export interface FileClipboardDependencies {
  platform: string
  isFile(path: string): boolean
  writeFileDropList(paths: readonly string[]): Promise<void> | void
}

const WINDOWS_FILE_DROP_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  '$json=[Console]::In.ReadToEnd()',
  '$items=ConvertFrom-Json -InputObject $json',
  '$list=[Collections.Specialized.StringCollection]::new()',
  'foreach($item in @($items)){[void]$list.Add([string]$item)}',
  '[Windows.Forms.Clipboard]::SetFileDropList($list)'
].join(';')

/**
 * Write a real File Explorer file-drop list through the inbox STA PowerShell host. Paths travel as
 * JSON over standard input and never become command arguments or interpolated script text.
 */
export function setWindowsFileDropList(
  paths: readonly string[],
  powershell = join(
    process.env.WINDIR || String.raw`C:\Windows`,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershell,
      ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_FILE_DROP_SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
    )
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.slice(0, MAX_STDERR_BYTES - stderr.length)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `PowerShell file clipboard exited ${code ?? 'without a code'}`))
    })
    child.stdin.end(JSON.stringify(paths), 'utf8')
  })
}

/**
 * Put existing local regular files on the Windows clipboard as real file references. Inputs cross
 * an IPC trust boundary, so paths are capped, absolute-only, de-duplicated, and rechecked in main.
 * The operation is all-or-nothing so a multi-selection is never silently truncated.
 */
export async function writeFilesToClipboard(
  input: unknown,
  dependencies: FileClipboardDependencies
): Promise<boolean> {
  if (dependencies.platform !== 'win32' || !Array.isArray(input)) return false

  const paths: string[] = []
  const seen = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string' || !isAbsolute(value)) return false
    if (seen.has(value)) continue
    if (paths.length >= MAX_CLIPBOARD_FILES) return false
    try {
      if (!dependencies.isFile(value)) return false
    } catch {
      return false
    }
    seen.add(value)
    paths.push(value)
  }
  if (!paths.length) return false

  try {
    await dependencies.writeFileDropList(paths)
    return true
  } catch {
    return false
  }
}
