// The base64 attachment write splices a decode into `remoteAtomicWrite`'s own temp in place of its
// stdin `cat`, so it is generated shell no compiler checks: run it under a real POSIX shell against
// a temp tree, the way the other remote writers are tested.
import { spawnSync } from 'child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { sshWriteBase64Args } from './ssh-fs'
import { testTmpDir } from '../core/test-tmp'

const conn = { host: 'h.example.com', user: 'u' }

function run(command: string, stdin: string): number {
  return spawnSync('/bin/sh', ['-c', command], { input: stdin, encoding: 'utf8' }).status ?? -1
}

describe.skipIf(process.platform === 'win32')('sshWriteBase64Args (real /bin/sh)', () => {
  it('decodes into the target when the decoded size matches', () => {
    const root = testTmpDir('nt-b64-')
    const target = path.join(root, 'attachments', 'a', 'pic.bin')
    const body = Buffer.from([0, 1, 2, 250, 251, 252, 10, 13])
    const cmd = sshWriteBase64Args(conn, '/cp', target, body.length).at(-1)!
    expect(run(cmd, body.toString('base64'))).toBe(0)
    expect(readFileSync(target)).toEqual(body)
    expect(readdirSync(path.dirname(target)).filter((n) => n.includes('.nodeterm-'))).toEqual([])
  })

  it('a short body never replaces the previous file and leaves no temp behind', () => {
    const root = testTmpDir('nt-b64-')
    const dir = path.join(root, 'attachments', 'a')
    mkdirSync(dir, { recursive: true })
    const target = path.join(dir, 'pic.bin')
    writeFileSync(target, 'previous')
    const body = Buffer.from('only part of it')
    const cmd = sshWriteBase64Args(conn, '/cp', target, body.length + 10).at(-1)!
    expect(run(cmd, body.toString('base64'))).not.toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('previous')
    expect(readdirSync(dir).filter((n) => n.includes('.nodeterm-'))).toEqual([])
  })

  it('the generic stdin cat is gone from the command (the decode replaced it)', () => {
    const cmd = sshWriteBase64Args(conn, '/cp', '/srv/p/attachments/a/x.bin', 3).at(-1)!
    expect(cmd).not.toMatch(/\bcat > /)
    expect(cmd).toContain('base64 -d')
  })
})
