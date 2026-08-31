// SECURITY: exercise the current paste delivery against a real bracketed-paste-aware reader.
//
// The byte-level tests cover sanitizePasteText, while tmux-paste.realtmux.test.ts covers the
// complete delivery matrix. This focused test keeps the filesystem command-execution discriminator
// from the preserved real-PTY regression, but uses the current production seam: tmux owns the
// bracket markers through paste-buffer -p and the payload arrives on stdin. The old
// bracketedInjection helper was removed because tmux 3.7 renders escape bytes carried in a paste
// buffer as printable text.
//
// The suite is intentionally soft-skipped when a suitable Unix tmux and bash are unavailable.
// A skipped host is not evidence of coverage, so the capability is measured in the test name and
// the focused report remains honest about the missing real reader.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  localPasteDelivery,
  localTmuxPasteArgs,
  pasteBufferName,
  runPasteDelivery,
  type PasteDelivery
} from './tmux-naming'
import { remotePasteDelivery } from './remote-ssh/control-master'

const ESC = '\x1b'
const START = `${ESC}[200~`
const END = `${ESC}[201~`
const SOCKET = `nt-rpty-${process.pid}`
const CONNECTION = { host: 'h.example.com', user: 'deploy', port: 2222, identityFile: '/k/id' }

function findUnixBinary(candidates: string[]): string | null {
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate
  return null
}

function findPasteAwareBash(): string | null {
  const bash = findUnixBinary(['/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash'])
  if (!bash) return null
  try {
    const version = execFileSync(bash, ['-c', 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], {
      encoding: 'utf8'
    }).trim()
    const [major, minor] = version.split('.').map(Number)
    return major > 5 || (major === 5 && minor >= 1) ? bash : null
  } catch {
    return null
  }
}

const TMUX = findUnixBinary(['/usr/bin/tmux', '/usr/local/bin/tmux', '/opt/homebrew/bin/tmux'])
const BASH = findPasteAwareBash()

let work = ''
let binDir = ''

function tmuxEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TMUX_TMPDIR: work }
}

function tmux(args: string[], input?: string): string {
  return execFileSync(TMUX as string, ['-L', SOCKET, ...args], {
    env: tmuxEnv(),
    input,
    encoding: 'utf8'
  })
}

beforeAll(() => {
  if (!TMUX || !BASH) return
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-rpty-'))
  binDir = path.join(work, 'bin')
  fs.mkdirSync(binDir)
  // The remote command builder invokes a bare `tmux -L nodeterm-rmt`. This shim forwards that
  // command to the private test socket while preserving stdin, so the SSH shell path reaches the
  // same real PTY as the local path without touching a user's tmux server.
  fs.writeFileSync(
    path.join(binDir, 'tmux'),
    `#!/bin/sh\nexport TMUX_TMPDIR=${work}\nshift 2\nexec ${TMUX} -L ${SOCKET} "$@"\n`,
    { mode: 0o755 }
  )
})

afterAll(() => {
  if (TMUX && work) {
    try {
      tmux(['kill-server'])
    } catch {
      // The server may never have started when setup was unavailable.
    }
  }
  if (work) fs.rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

function waitFor(predicate: () => boolean, what: string, timeoutMs = 10_000): void {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`)
    execFileSync('sleep', ['0.03'])
  }
}

function capture(session: string): string {
  return tmux(['capture-pane', '-p', '-t', session])
}

function bashPane(session: string): void {
  tmux([
    'new-session',
    '-d',
    '-s',
    session,
    '-x',
    '200',
    '-y',
    '40',
    '-e',
    'HISTFILE=/dev/null',
    '-c',
    work,
    `${BASH} --norc --noprofile -i`
  ])
  waitFor(() => capture(session).trim().length > 0, `${session} bash prompt`)
}

function drain(session: string, tag: string): void {
  const marker = path.join(work, `sentinel-${tag}`)
  tmux(['send-keys', '-t', session, 'C-c'])
  tmux(['send-keys', '-t', session, '-l', '--', `touch ${marker}`])
  tmux(['send-keys', '-t', session, 'Enter'])
  waitFor(() => fs.existsSync(marker), `${session} sentinel`)
}

function planFor(
  route: 'local' | 'ssh',
  session: string,
  text: string,
  enter: boolean
): PasteDelivery | null {
  return route === 'local'
    ? localPasteDelivery(SOCKET, session, text, enter)
    : remotePasteDelivery(CONNECTION, '/s.sock', session, text, enter)
}

function runnerFor(route: 'local' | 'ssh'): (args: string[], input: string) => Promise<unknown> {
  if (route === 'local') return async (args, input) => tmux(args, input)
  return async (args, input) =>
    execFileSync('/bin/sh', ['-c', args[args.length - 1]], {
      env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: work },
      input,
      encoding: 'utf8'
    })
}

async function send(route: 'local' | 'ssh', session: string, text: string, enter: boolean): Promise<boolean> {
  const plan = planFor(route, session, text, enter)
  if (!plan) return true
  return runPasteDelivery(plan, runnerFor(route))
}

const realSuite = TMUX && BASH ? describe : describe.skip
const routes: Array<'local' | 'ssh'> = ['local', 'ssh']

realSuite('real bash PTY: paste payloads cannot become commands', () => {
  for (const route of routes) {
    it(`${route}: an end marker and trailing command remain content`, async () => {
      const session = `nt-rpty-${route}-end`
      const marker = path.join(work, `executed-${route}-end`)
      bashPane(session)
      expect(await send(route, session, `hello${END}\rtouch ${marker}\r`, false)).toBe(true)
      drain(session, `${route}-end`)
      expect(fs.existsSync(marker), 'the payload executed after escaping the paste frame').toBe(false)
      expect(capture(session)).toContain('hello[201~')
    }, 30_000)

    it(`${route}: a control key in the payload is not interpreted as a key`, async () => {
      const session = `nt-rpty-${route}-ctrlu`
      const marker = path.join(work, `executed-${route}-ctrlu`)
      bashPane(session)
      expect(await send(route, session, `SAFE${END}\x15touch ${marker} #`, true)).toBe(true)
      drain(session, `${route}-ctrlu`)
      expect(fs.existsSync(marker), 'the payload control byte escaped the paste frame').toBe(false)
    }, 30_000)
  }

  it('control: the same unsanitized payload really executes its trailing command', async () => {
    const session = 'nt-rpty-control'
    const marker = path.join(work, 'executed-control')
    bashPane(session)
    const buffer = pasteBufferName()
    const plan = localTmuxPasteArgs(SOCKET, session, buffer, false)
    await expect(
      runPasteDelivery(
        { args: plan, body: `hello${END}\rtouch ${marker}\r`, cleanup: null },
        runnerFor('local')
      )
    ).resolves.toBe(true)
    waitFor(() => fs.existsSync(marker), 'the unsanitized control marker')
    expect(fs.existsSync(marker), 'the control attack no longer executes and the test is vacuous').toBe(
      true
    )
  }, 30_000)
})

// Keep the frame constants live in this file as an explicit assertion of the protocol boundary.
// The production plans carry no escape bytes in their stdin body; tmux supplies START and END.
describe('real delivery body boundary', () => {
  it('sanitized production plans carry no frame markers in their payload', () => {
    const plan = planFor('local', 'nt-rpty-boundary', `x${START}y${END}`, false)
    expect(plan?.body).toBe('x[200~y[201~')
    expect(plan?.body).not.toContain(ESC)
  })
})
