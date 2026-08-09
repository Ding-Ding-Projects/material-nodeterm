import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AGENT_CONFIG, resumeCommand } from './config'

const execFileAsync = promisify(execFile)

let fixtureDir = ''

beforeAll(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-identity-'))
  const fakeCodex = path.join(fixtureDir, 'codex')
  writeFileSync(
    fakeCodex,
    `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.CAPTURE_FILE, JSON.stringify(process.argv.slice(2)))
`,
    'utf8'
  )
  chmodSync(fakeCodex, 0o755)
})

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true })
})

function nodeEnv(nodeId?: string, endpoint?: string): NodeJS.ProcessEnv {
  return {
    PATH: `${fixtureDir}:${process.env.PATH ?? ''}`,
    NODETERM_NODE_ID: nodeId,
    NODETERM_HOOK_ENDPOINT: endpoint,
    NODETERM_CANVAS_CONTROL: '1'
  }
}

async function capture(command: string, name: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const captureFile = path.join(fixtureDir, `${name}.json`)
  await execFileAsync('/bin/sh', ['-c', command], {
    env: { ...env, CAPTURE_FILE: captureFile }
  })
  return JSON.parse(readFileSync(captureFile, 'utf8')) as string[]
}

function configValue(argv: string[], key: string): string | undefined {
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] !== '-c') continue
    const [candidate, ...value] = argv[i + 1].split('=')
    if (candidate === key) return value.join('=')
  }
  return undefined
}

describe('shared Codex app-server node identity', () => {
  it('keeps two concurrent node sessions isolated through launch and resume', async () => {
    const endpointA = path.join(fixtureDir, 'node a endpoint.env')
    const endpointB = path.join(fixtureDir, 'node b endpoint.env')
    const resume = resumeCommand('codex', 'session-b')
    expect(resume).not.toBeNull()

    const [argvA, argvB] = await Promise.all([
      capture(`${AGENT_CONFIG.codex.launchCmd} 'prompt-a'`, 'node-a', nodeEnv('term-a', endpointA)),
      capture(resume!, 'node-b', nodeEnv('term-b', endpointB))
    ])

    expect(argvA).toContain('--remote')
    expect(argvA).toContain('unix://')
    expect(argvA.at(-1)).toBe('prompt-a')
    expect(argvB.slice(-2)).toEqual(['resume', 'session-b'])

    expect(configValue(argvA, 'shell_environment_policy.set.NODETERM_NODE_ID')).toBe('term-a')
    expect(configValue(argvA, 'shell_environment_policy.set.NODETERM_HOOK_ENDPOINT')).toBe(endpointA)
    expect(configValue(argvA, 'shell_environment_policy.set.NODETERM_CANVAS_CONTROL')).toBe('"1"')

    expect(configValue(argvB, 'shell_environment_policy.set.NODETERM_NODE_ID')).toBe('term-b')
    expect(configValue(argvB, 'shell_environment_policy.set.NODETERM_HOOK_ENDPOINT')).toBe(endpointB)
    expect(configValue(argvB, 'shell_environment_policy.set.NODETERM_CANVAS_CONTROL')).toBe('"1"')
    expect(argvA).not.toContain(`shell_environment_policy.set.NODETERM_NODE_ID=term-b`)
    expect(argvB).not.toContain(`shell_environment_policy.set.NODETERM_NODE_ID=term-a`)
  })

  it.each([
    ['missing node id', nodeEnv(undefined, '/tmp/endpoint.env')],
    ['invalid node id', nodeEnv('term/bad', '/tmp/endpoint.env')],
    ['missing endpoint', nodeEnv('term-a', undefined)]
  ])('fails closed for %s without invoking Codex', async (_label, env) => {
    const captureFile = path.join(fixtureDir, `rejected-${_label.replaceAll(' ', '-')}.json`)

    await expect(
      execFileAsync('/bin/sh', ['-c', AGENT_CONFIG.codex.launchCmd], {
        env: { ...env, CAPTURE_FILE: captureFile }
      })
    ).rejects.toMatchObject({ code: 64 })
    expect(existsSync(captureFile)).toBe(false)
  })
})
