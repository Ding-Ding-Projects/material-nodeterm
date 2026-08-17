import { execFile } from 'child_process'
import path from 'path'

/**
 * Executor for the hook server's `/git/remote-op` route: runs a network git operation LOCALLY,
 * in this (GUI) process, on behalf of the mobile companion.
 *
 * Why it exists: the phone drives source control over an SSH exec channel, and on macOS that
 * channel cannot open the login Keychain — `git-credential-osxkeychain` fails with
 * errSecInteractionNotAllowed (-25308), git falls back to a /dev/tty prompt that an exec channel
 * doesn't have, and every push/pull/fetch against an https remote dies. The same commands run
 * fine inside the desktop app's GUI session, so the phone asks the app (via the loopback hook
 * server, bearer-token gated) to run them here.
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

// Same env recipe as git-service.ts: GUI apps on macOS don't inherit the shell PATH, so a
// credential helper installed by Homebrew wouldn't be found; GIT_TERMINAL_PROMPT=0 makes a
// credential MISS fail fast instead of hanging on a prompt (no TTY here either); LC_ALL=C pins
// git's messages to English — the phone keys its push retry on the exact fatal wording.
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin${process.env.PATH ? `:${process.env.PATH}` : ''}`,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C'
  }
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
