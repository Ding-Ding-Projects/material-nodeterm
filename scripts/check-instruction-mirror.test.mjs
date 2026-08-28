/**
 * check-instruction-mirror.test.mjs — proves the sanitized-mirror guard both ways:
 *
 *  - GREEN on this repository: README.md and AGENTS.md each carry the labelled mirror and no
 *    leak pattern matches (this is the assertion that keeps the mirror from rotting);
 *  - RED on fixtures that leak (a fake IP, a fake `C:\Users\<name>` path, a literal ssh target,
 *    a token shape) or that drop a required mirror section — a leak detector nobody has watched
 *    fail proves nothing, so the failing cases live here permanently rather than as a one-off
 *    manual probe.
 *
 * The fixtures exercise the real CLI (spawned `node scripts/check-instruction-mirror.mjs
 * <root>`) so the exit-code contract is proven too, not only the pure function.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { renameSync } from 'node:fs'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkInstructionMirror } from './check-instruction-mirror.mjs'
import {
  MANAGED_BEGIN,
  MANAGED_END,
  REQUIRED_PUBLIC_SECTIONS,
  extractManagedBody,
  validateManagedBody,
  writeManagedInstructionMirror
} from './sync-agent-instruction-mirror.mjs'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const checker = path.join(here, 'check-instruction-mirror.mjs')

/** A minimal mirror body carrying every required marker, with no leaks. */
const CLEAN_MIRROR = [
  '# Fixture',
  '',
  '> **This file is a mirror, not a source.** It is a sanitized summary of the shared',
  '> working conventions.',
  '',
  '- Process boundaries are enforced, not advisory.',
  '- Design for three surfaces, every time.',
  '- House rules.',
  '- Testing.',
  '- Git and commit conventions.',
  '- Security boundaries.',
  ''
].join('\n')

const CLEAN_MANAGED_BODY = REQUIRED_PUBLIC_SECTIONS.join('\n\n')

function withManagedBlock(prefix, body = CLEAN_MANAGED_BODY) {
  return `${prefix.trimEnd()}\n\n${MANAGED_BEGIN}\n${body}\n${MANAGED_END}\n`
}

let fixtures // root temp dir holding one subdirectory per fixture case

async function makeFixture(name, readme, agents, claude = agents) {
  const dir = path.join(fixtures, name)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'README.md'), readme, 'utf8')
  await writeFile(path.join(dir, 'AGENTS.md'), withManagedBlock(agents), 'utf8')
  await writeFile(path.join(dir, 'CLAUDE.md'), withManagedBlock(claude), 'utf8')
  return dir
}

async function runChecker(root) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [checker, root])
    return { code: 0, stdout, stderr }
  } catch (e) {
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

beforeAll(async () => {
  fixtures = await mkdtemp(path.join(os.tmpdir(), 'instruction-mirror-fixture-'))
})

afterAll(async () => {
  if (fixtures) await rm(fixtures, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('this repository', () => {
  it('carries the concise summary and identical full managed mirrors with no leak-pattern match', async () => {
    const { problems } = checkInstructionMirror(repoRoot)
    expect(problems).toEqual([])
    const run = await runChecker(repoRoot)
    expect(run.stderr).toBe('')
    expect(run.code).toBe(0)
    expect(run.stdout).toMatch(/OK/)
  })
})

describe('leak detection goes red', () => {
  it('an IP-address literal fails, and names the file, line and match', async () => {
    const dir = await makeFixture(
      'leak-ip',
      CLEAN_MIRROR + '\nDeploy to 192.168.50.99 when ready.\n',
      CLEAN_MIRROR
    )
    const { problems } = checkInstructionMirror(dir)
    expect(problems).toEqual([
      expect.objectContaining({ file: 'README.md', reason: expect.stringMatching(/IP address/), detail: '192.168.50.99' })
    ])
    const run = await runChecker(dir)
    expect(run.code).toBe(1)
    expect(run.stderr).toContain('192.168.50.99')
  })

  it('a Windows user-profile path naming an account fails', async () => {
    const dir = await makeFixture(
      'leak-winpath',
      CLEAN_MIRROR,
      CLEAN_MIRROR + '\nLogs land in C:\\Users\\someone\\AppData\\Local\\app.\n'
    )
    const { problems } = checkInstructionMirror(dir)
    expect(problems.some((p) => p.file === 'AGENTS.md' && /user-profile/.test(p.reason))).toBe(true)
    expect((await runChecker(dir)).code).toBe(1)
  })

  it('a literal ssh user@host target fails', async () => {
    const dir = await makeFixture('leak-ssh', CLEAN_MIRROR + '\nRun `ssh deploy@build-box-7` first.\n', CLEAN_MIRROR)
    const { problems } = checkInstructionMirror(dir)
    expect(problems.some((p) => /ssh target/.test(p.reason) && p.detail.includes('deploy@build-box-7'))).toBe(true)
  })

  it('a credential-shaped token fails', async () => {
    const dir = await makeFixture(
      'leak-token',
      CLEAN_MIRROR + '\ntoken: ghp_' + 'a'.repeat(36) + '\n',
      CLEAN_MIRROR
    )
    const { problems } = checkInstructionMirror(dir)
    expect(problems.some((p) => /token/.test(p.reason))).toBe(true)
  })

  it('placeholders are NOT leaks: %USERNAME%, loopback, and /home/you all pass', async () => {
    const dir = await makeFixture(
      'clean-placeholders',
      CLEAN_MIRROR + '\nC:\\Users\\%USERNAME% and 127.0.0.1 and /home/you are generic.\n',
      CLEAN_MIRROR
    )
    const { problems } = checkInstructionMirror(dir)
    expect(problems).toEqual([])
  })
})

describe('mirror-presence goes red', () => {
  it('a README without the labelled mirror fails, naming the missing markers', async () => {
    const dir = await makeFixture('no-mirror', '# Fixture readme with no mirror at all\n', CLEAN_MIRROR)
    const { problems } = checkInstructionMirror(dir)
    const readmeProblems = problems.filter((p) => p.file === 'README.md' && p.reason === 'mirror marker missing')
    expect(readmeProblems.length).toBeGreaterThan(0)
    expect(readmeProblems.some((p) => p.detail.includes('mirror, not a source'))).toBe(true)
    expect((await runChecker(dir)).code).toBe(1)
  })

  it('dropping ONE required section from an otherwise-labelled mirror fails', async () => {
    const missingOne = CLEAN_MIRROR.replace('- Security boundaries.\n', '')
    const dir = await makeFixture('dropped-section', missingOne, CLEAN_MIRROR)
    const { problems } = checkInstructionMirror(dir)
    expect(problems).toEqual([
      expect.objectContaining({
        file: 'README.md',
        reason: 'mirror marker missing',
        detail: expect.stringContaining('Security boundaries')
      })
    ])
  })

  it('a missing AGENTS.md fails outright', async () => {
    const dir = path.join(fixtures, 'missing-agents')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'README.md'), CLEAN_MIRROR, 'utf8')
    await writeFile(path.join(dir, 'CLAUDE.md'), withManagedBlock(CLEAN_MIRROR), 'utf8')
    const { problems } = checkInstructionMirror(dir)
    expect(problems.some((p) => p.file === 'AGENTS.md' && p.reason === 'missing file')).toBe(true)
  })
})

describe('full managed mirror', () => {
  it('fails when CLAUDE.md is missing', async () => {
    const dir = await makeFixture('missing-claude', CLEAN_MIRROR, CLEAN_MIRROR)
    await rm(path.join(dir, 'CLAUDE.md'))
    const { problems } = checkInstructionMirror(dir)
    expect(problems.some((p) => p.file === 'CLAUDE.md' && p.detail.includes('does not exist'))).toBe(true)
  })

  it('fails when the two managed bodies drift', async () => {
    const changed = CLEAN_MANAGED_BODY.replace('### Publication boundary', '### Publication boundary\n\nDifferent text')
    const dir = await makeFixture('managed-drift', CLEAN_MIRROR, CLEAN_MIRROR, CLEAN_MIRROR)
    await writeFile(path.join(dir, 'CLAUDE.md'), withManagedBlock(CLEAN_MIRROR, changed), 'utf8')
    const { problems } = checkInstructionMirror(dir)
    expect(problems.some((p) => p.detail.includes('managed body differs'))).toBe(true)
  })

  it('fails on duplicate or partial managed markers', async () => {
    const dir = await makeFixture('managed-markers', CLEAN_MIRROR, CLEAN_MIRROR)
    await writeFile(
      path.join(dir, 'CLAUDE.md'),
      withManagedBlock(CLEAN_MIRROR) + `\n${MANAGED_BEGIN}\nextra\n`,
      'utf8'
    )
    const { problems } = checkInstructionMirror(dir)
    expect(problems.some((p) => p.detail.includes('exactly one complete managed instruction block'))).toBe(true)
  })

  it('refuses sensitive input before changing either target', async () => {
    const dir = await makeFixture('managed-sensitive-write', CLEAN_MIRROR, CLEAN_MIRROR)
    const beforeAgents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8')
    const beforeClaude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')
    const sensitive = `${CLEAN_MANAGED_BODY}\n\nDeploy to 192.168.50.99.`
    expect(validateManagedBody(sensitive).some((problem) => problem.includes('IP address'))).toBe(true)
    expect(() => writeManagedInstructionMirror(dir, sensitive)).toThrow(/IP address/)
    const afterAgents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8')
    const afterClaude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')
    expect(afterAgents).toBe(beforeAgents)
    expect(afterClaude).toBe(beforeClaude)
  })

  it('refuses a private-vocabulary body before changing either target', async () => {
    const dir = await makeFixture('managed-private-write', CLEAN_MIRROR, CLEAN_MIRROR)
    const beforeAgents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8')
    const beforeClaude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')
    const privateBody = `${CLEAN_MANAGED_BODY}\n\nprivate-term`
    expect(() => writeManagedInstructionMirror(dir, privateBody, {
      privateVocabularyValidator: (body) => body.includes('private-term') ? ['private-term'] : []
    })).toThrow(/private vocabulary/)
    expect(await readFile(path.join(dir, 'AGENTS.md'), 'utf8')).toBe(beforeAgents)
    expect(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe(beforeClaude)
  })

  it('rolls back the first target when publishing the second target fails', async () => {
    const dir = await makeFixture('managed-publish-rollback', CLEAN_MIRROR, CLEAN_MIRROR)
    const beforeAgents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8')
    const beforeClaude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')
    let renames = 0
    expect(() => writeManagedInstructionMirror(dir, `${CLEAN_MANAGED_BODY}\n\nNew reviewed rule.`, {
      privateVocabularyValidator: () => [],
      publishRename: (source, destination) => {
        renames += 1
        if (renames === 2) throw Object.assign(new Error('injected second publish failure'), { code: 'EIO' })
        renameSync(source, destination)
      }
    })).toThrow(/injected second publish failure/)
    expect(await readFile(path.join(dir, 'AGENTS.md'), 'utf8')).toBe(beforeAgents)
    expect(await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe(beforeClaude)
  })

  it('preserves surrounding project guidance while synchronizing the exact body', async () => {
    const dir = await makeFixture('managed-write', CLEAN_MIRROR, `${CLEAN_MIRROR}\nAgent-only project guidance.`, `${CLEAN_MIRROR}\nClaude-only project guidance.`)
    writeManagedInstructionMirror(dir, CLEAN_MANAGED_BODY, { privateVocabularyValidator: () => [] })
    const agents = await readFile(path.join(dir, 'AGENTS.md'), 'utf8')
    const claude = await readFile(path.join(dir, 'CLAUDE.md'), 'utf8')
    expect(agents).toContain('Agent-only project guidance.')
    expect(claude).toContain('Claude-only project guidance.')
    expect(extractManagedBody(agents, 'AGENTS.md')).toBe(extractManagedBody(claude, 'CLAUDE.md'))
  })
})
