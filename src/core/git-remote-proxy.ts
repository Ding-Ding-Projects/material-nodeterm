import { execFile } from 'child_process'
import os from 'os'
import path from 'path'

/**
 * Executor for the hook server's `/git/remote-op` route: runs a network git operation LOCALLY,
 * in this (GUI) process, on behalf of the mobile companion.
 *
 * Why it exists: the phone drives source control over an SSH exec channel, but that channel may
 * not inherit the interactive user's credential-helper environment. Git can then fall back to a
 * terminal prompt that an exec channel does not have. The same commands run inside the desktop
 * app's user session, so the phone asks the app, through the loopback hook server, to run them.
 *
 * Security: the request names an op from a FIXED whitelist — never argv — plus a cwd and an
 * optional branch. The branch is validated before it is placed in argv (it could otherwise read
 * as an option flag), and git runs via execFile (no shell). The caller is already trusted at the
 * hook-token level (the token file is 0600, so only the same user can read it), but the
 * whitelist keeps this route a git-network-op relay rather than a command runner.
 */

export type GitRemoteOp = 'fetch' | 'pull' | 'push' | 'push-set-upstream' | 'force-push'

export interface GitRemoteOpRequest {
  cwd?: string
  op?: string
  branch?: string
}

export interface GitRemoteOpResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
}

/** Network git can stall on a wedged remote; kill well before the phone's own curl deadline. */
export const GIT_REMOTE_OP_TIMEOUT_MS = 120_000

/**
 * Branch-name guard, the same rules the phone enforces before interpolating a ref (RemoteGit.
 * isValidRef): a ref is an ARGUMENT, so a leading dash must be refused here — quoting does
 * nothing about `push -u origin --force`. Permissive where git is (unicode, `(`, `#` are legal).
 */
export function isSafeBranch(name: string): boolean {
  const n = name.trim()
  if (
    !n ||
    n.startsWith('-') ||
    n.startsWith('.') ||
    n.endsWith('.') ||
    n.startsWith('/') ||
    n.endsWith('/') ||
    n.includes('..') ||
    n.includes('//') ||
    n.includes('@{') ||
    n.endsWith('.lock')
  ) {
    return false
  }
  // ~ ^ : ? * [ ] \ are revision syntax or globs; whitespace/control would break argv anyway.
  return !/[~^:?*[\]\\\s\p{Cc}]/u.test(n)
}

/** The whitelist: op → fixed argv. Anything else (including a bad branch) → null. */
export function argsForRemoteOp(op: string, branch?: string): string[] | null {
  switch (op) {
    case 'fetch':
      return ['fetch']
    case 'pull':
      return ['pull']
    case 'push':
      return ['push']
    case 'force-push':
      // --force-with-lease, never bare --force: the lease refuses when the remote moved.
      return ['push', '--force-with-lease']
    case 'push-set-upstream':
      return branch && isSafeBranch(branch) ? ['push', '-u', 'origin', branch.trim()] : null
    default:
      return null
  }
}

// Same environment recipe as git-service.ts. Windows desktop sessions receive the standard Git
// locations even when Explorer supplied a narrow PATH; Linux Server Edition receives the standard
// system directories. GIT_TERMINAL_PROMPT=0 makes a credential miss return instead of hanging on a
// prompt. LC_ALL=C pins git's messages to English because the phone keys one retry on exact text.
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
  if (process.platform === 'win32') {
    const home = os.homedir()
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
    const inheritedKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'Path'
    const inherited = process.env[inheritedKey] || ''
    env[inheritedKey] = [
      path.join(programFiles, 'Git', 'cmd'),
      path.join(programFiles, 'GitHub CLI'),
      path.join(localAppData, 'Programs', 'GitHub CLI'),
      inherited
    ].filter(Boolean).join(path.delimiter)
  } else if (process.platform === 'linux') {
    env.PATH = ['/usr/local/bin', '/usr/bin', '/bin', process.env.PATH || ''].filter(Boolean).join(path.delimiter)
  }
  return env
}

/** Validate + run. Invalid requests return ok:false/exitCode:-1 without spawning anything. */
export async function runGitRemoteOp(
  req: GitRemoteOpRequest,
  opts?: { gitBin?: string }
): Promise<GitRemoteOpResult> {
  const args = argsForRemoteOp(req.op ?? '', req.branch)
  const cwd = req.cwd ?? ''
  if (!args || !path.isAbsolute(cwd)) {
    return { ok: false, exitCode: -1, stdout: '', stderr: 'invalid git remote-op request' }
  }
  return new Promise((resolve) => {
    execFile(
      opts?.gitBin ?? 'git',
      ['-C', cwd, ...args],
      { env: gitEnv(), timeout: GIT_REMOTE_OP_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? ((error as { code?: number | string }).code ?? -1) : 0
        resolve({
          ok: !error,
          exitCode: typeof code === 'number' ? code : -1,
          stdout: stdout ?? '',
          // A spawn-level failure (git missing, timeout kill) has no stderr; surface the
          // error message so the phone never renders an empty reason.
          stderr: (stderr || (error ? String((error as Error).message ?? error) : '')).trim()
        })
      }
    )
  })
}
