import {
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  codexAccountHome,
  codexHomeForAccount,
  codexSessionEnv,
  ensureSharedCodexDaemon,
  commitCodexRolloutExposure,
  planCodexRolloutExposure,
  legacyCodexAccountHome,
  migrateLegacyCodexAccountHome,
  codexTmuxEnvArgs,
  codexSocketForAccount,
  remoteCodexHome,
  remoteCodexSocket,
  remoteCodexTmuxEnvArgs
} from './codex-accounts-core'

describe('managed Codex account paths', () => {
  it('isolates two accounts under distinct homes and shared-server sockets', () => {
    const userData = '/isolated/nodeterm'
    expect(codexAccountHome(userData, 'account-a')).not.toBe(
      legacyCodexAccountHome(userData, 'account-a')
    )
    expect(codexHomeForAccount(userData, 'account-a')).not.toBe(
      codexHomeForAccount(userData, 'account-b')
    )
    expect(codexSocketForAccount(userData, 'account-a')).not.toBe(
      codexSocketForAccount(userData, 'account-b')
    )
  })

  it.each(['', '../escape', 'space name', '/absolute'])('rejects unsafe account id %s', (id) => {
    expect(() => codexAccountHome('/isolated/nodeterm', id)).toThrow('Invalid Codex account id')
  })

  it('overwrites inherited account scope for system and managed sessions', () => {
    const accountHome = codexAccountHome('/isolated/nodeterm', 'account-a')
    expect(codexSessionEnv('/isolated/nodeterm')).toMatchObject({
      NODETERM_CODEX_ACCOUNT_ID: ''
    })
    expect(codexSessionEnv('/isolated/nodeterm', 'account-a')).toEqual({
      CODEX_HOME: accountHome,
      NODETERM_CODEX_ACCOUNT_ID: 'account-a'
    })
    expect(codexTmuxEnvArgs('/isolated/nodeterm', 'account-a')).toEqual([
      '-e',
      `CODEX_HOME=${accountHome}`,
      '-e',
      'NODETERM_CODEX_ACCOUNT_ID=account-a'
    ])
  })

  it('keeps the managed daemon socket below macOS SUN_LEN', () => {
    const userData = '/Users/example/Library/Application Support/node-terminal'
    const accountId = 'be28d3d4-c18c-430c-a257-ae550d3dd7ed'
    expect(Buffer.byteLength(codexSocketForAccount(userData, accountId))).toBeLessThan(104)
  })

  it('isolates remote accounts under short host-local homes', () => {
    const remoteHome = '/home/corvin'
    const first = remoteCodexHome(remoteHome, 'account-a')
    const second = remoteCodexHome(remoteHome, 'account-b')
    expect(first).not.toBe(second)
    expect(remoteCodexHome(remoteHome)).toBe('/home/corvin/.codex')
    expect(remoteCodexSocket(remoteHome, 'account-a')).toBe(
      `${first}/app-server-control/app-server-control.sock`
    )
    expect(remoteCodexTmuxEnvArgs(remoteHome, 'account-a')).toEqual([
      '-e',
      `CODEX_HOME=${first}`,
      '-e',
      'NODETERM_CODEX_ACCOUNT_ID=account-a'
    ])
  })

  it('rejects unsafe remote account paths', () => {
    expect(() => remoteCodexHome('relative', 'account-a')).toThrow('Remote home must be absolute')
    expect(() => remoteCodexHome('/home/corvin', '../escape')).toThrow('Invalid Codex account id')
  })

  it('moves an existing long managed home to its deterministic short home', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-home-'))
    const userData = path.join(fixture, 'Library', 'Application Support', 'node-terminal')
    const shortRoot = path.join(fixture, 'cx')
    const legacy = legacyCodexAccountHome(userData, 'account-a')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(path.join(legacy, 'auth.json'), 'fixture')

    const target = migrateLegacyCodexAccountHome(userData, 'account-a', shortRoot)

    expect(target).toBe(codexAccountHome(userData, 'account-a', shortRoot))
    expect(readFileSync(path.join(target, 'auth.json'), 'utf8')).toBe('fixture')
    expect(() => readFileSync(path.join(legacy, 'auth.json'))).toThrow()
    rmSync(fixture, { recursive: true, force: true })
  })
})

describe('shared Codex daemon readiness', () => {
  it('reuses a reachable daemon without starting another process', async () => {
    const start = vi.fn(async () => {})

    await ensureSharedCodexDaemon(async () => true, start)

    expect(start).not.toHaveBeenCalled()
  })

  it('starts exactly once when the account daemon is unavailable', async () => {
    const start = vi.fn(async () => {})

    await ensureSharedCodexDaemon(async () => false, start)

    expect(start).toHaveBeenCalledTimes(1)
  })
})

describe('cross-account Codex rollout visibility', () => {
  it('commits A to B to C as one inode and survives removal of the original account', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-rollout-'))
    const sourceHome = path.join(fixture, 'source')
    const targetHome = path.join(fixture, 'target')
    const thirdHome = path.join(fixture, 'third')
    const threadId = 'thread-a'
    const source = path.join(
      sourceHome,
      'sessions',
      '2026',
      '08',
      '10',
      `rollout-${threadId}.jsonl`
    )
    mkdirSync(path.dirname(source), { recursive: true })
    mkdirSync(targetHome)
    mkdirSync(thirdHome)
    writeFileSync(source, 'before\n')

    const toTarget = planCodexRolloutExposure(sourceHome, targetHome, source, threadId)
    expect(existsSync(toTarget.targetPath)).toBe(false)
    commitCodexRolloutExposure(toTarget)
    const target = toTarget.targetPath
    expect(statSync(target).ino).toBe(statSync(source).ino)
    expect(readdirSync(path.dirname(target)).some((name) => name.endsWith('.nodeterm-link'))).toBe(
      false
    )
    writeFileSync(target, 'after\n', { flag: 'a' })
    expect(readFileSync(source, 'utf8')).toBe('before\nafter\n')
    const toThird = planCodexRolloutExposure(targetHome, thirdHome, target, threadId)
    commitCodexRolloutExposure(toThird)
    rmSync(sourceHome, { recursive: true, force: true })
    expect(readFileSync(target, 'utf8')).toBe('before\nafter\n')
    expect(readFileSync(toThird.targetPath, 'utf8')).toBe('before\nafter\n')
    rmSync(fixture, { recursive: true, force: true })
  })

  it('rejects paths outside the source account and conflicting target rollouts', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-rollout-reject-'))
    const sourceHome = path.join(fixture, 'source')
    const targetHome = path.join(fixture, 'target')
    const threadId = 'thread-a'
    const outside = path.join(fixture, `rollout-${threadId}.jsonl`)
    writeFileSync(outside, 'outside')
    mkdirSync(path.join(sourceHome, 'sessions'), { recursive: true })
    expect(() => planCodexRolloutExposure(sourceHome, targetHome, outside, threadId)).toThrow(
      'outside its account home'
    )

    const malicious = path.join(sourceHome, 'sessions', `rollout-malicious-${threadId}.jsonl`)
    symlinkSync(outside, malicious)
    expect(() => planCodexRolloutExposure(sourceHome, targetHome, malicious, threadId)).toThrow(
      'regular file'
    )

    const source = path.join(sourceHome, 'sessions', `rollout-${threadId}.jsonl`)
    const target = path.join(targetHome, 'sessions', `rollout-${threadId}.jsonl`)
    mkdirSync(path.dirname(source), { recursive: true })
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(source, 'source')
    writeFileSync(target, 'different')
    const plan = planCodexRolloutExposure(sourceHome, targetHome, source, threadId)
    expect(() => commitCodexRolloutExposure(plan)).toThrow('different rollout')
    expect(readFileSync(target, 'utf8')).toBe('different')
    rmSync(fixture, { recursive: true, force: true })
  })

  it('refuses a target sessions symlink without writing through it', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-rollout-target-link-'))
    const sourceHome = path.join(fixture, 'source')
    const targetHome = path.join(fixture, 'target')
    const outside = path.join(fixture, 'outside')
    const threadId = 'thread-a'
    const source = path.join(sourceHome, 'sessions', `rollout-${threadId}.jsonl`)
    mkdirSync(path.dirname(source), { recursive: true })
    mkdirSync(targetHome)
    mkdirSync(outside)
    writeFileSync(source, 'source')
    symlinkSync(outside, path.join(targetHome, 'sessions'))
    const plan = planCodexRolloutExposure(sourceHome, targetHome, source, threadId)
    expect(() => commitCodexRolloutExposure(plan)).toThrow('unsafe directory')
    expect(existsSync(path.join(outside, `rollout-${threadId}.jsonl`))).toBe(false)
    rmSync(fixture, { recursive: true, force: true })
  })

  it('removes its temporary link when the source inode changes before link creation', () => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), 'nodeterm-codex-rollout-source-race-'))
    const sourceHome = path.join(fixture, 'source')
    const targetHome = path.join(fixture, 'target')
    const threadId = 'thread-a'
    const source = path.join(sourceHome, 'sessions', `rollout-${threadId}.jsonl`)
    const replacement = path.join(sourceHome, 'sessions', 'replacement.jsonl')
    mkdirSync(path.dirname(source), { recursive: true })
    mkdirSync(targetHome)
    writeFileSync(source, 'verified')
    writeFileSync(replacement, 'replacement')
    const plan = planCodexRolloutExposure(sourceHome, targetHome, source, threadId)
    let calls = 0
    expect(() =>
      commitCodexRolloutExposure(plan, (from, to) => {
        calls += 1
        if (calls === 1) renameSync(replacement, source)
        linkSync(from, to)
      })
    ).toThrow('Temporary Codex rollout did not preserve')
    const targetDir = path.dirname(plan.targetPath)
    expect(existsSync(plan.targetPath)).toBe(false)
    expect(readdirSync(targetDir).some((name) => name.endsWith('.nodeterm-link'))).toBe(false)
    rmSync(fixture, { recursive: true, force: true })
  })
})
