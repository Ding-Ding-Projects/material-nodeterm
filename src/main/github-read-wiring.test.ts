import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildCanvasControlInstructions, buildCanvasSkillBody, parseControlRequest } from './canvas-control-core'
import { serverEditionControlHandler, CONTROL_UNSUPPORTED_ERROR } from '../server/control-unsupported'
import { UNTRUSTED_TEXT_NOTE } from '../core/github/control-read'

/**
 * SOURCE-LEVEL pins for the `issues` / `prs` control verbs (core/github/control-read.ts). Every
 * piece below is well-typed whether or not it is wired — a handler placed after the renderer
 * forward, a verb missing from the grammar — so the verbs could pass `npm run typecheck` and every
 * unit test and ship inert (or forwarded to a canvas that answers "unknown verb"). The behaviour is
 * proven in `core/github/control-read.test.ts` and `core/github/service.pulls.test.ts`.
 */
const read = (rel: string): string =>
  readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const main = read('./index.ts')

describe('desktop main', () => {
  const handler = main.slice(main.indexOf('hookServer.setControlHandler('))
  const at = handler.indexOf('if (GITHUB_READ_VERBS.has(verb)) {')
  const block = handler.slice(at, at + 1800)

  it('answers issues / prs in MAIN, after the --project grant gate and before any forward', () => {
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(handler.indexOf('} else if (PROJECT_TARGETABLE_VERBS.has(verb)'))
    expect(at).toBeLessThan(handler.indexOf("'window unavailable'"))
    expect(at).toBeLessThan(handler.indexOf('IPC.agentControl'))
  })

  it('reads the cache (controlSnapshot), the caller\'s own project and live agent state', () => {
    expect(block).toContain('callerProjectId = projectIdOfNode(nodeId)')
    expect(block).toContain('grantsOtherProjects: false')
    expect(block).toContain('reads only your own project')
    expect(block).toContain('github.service.controlSnapshot(id)')
    // One workspace load per call: the project rides the snapshot.
    expect(block).not.toContain('githubProject(')
    // Main's own verified guard, behind the route's requiresVerified.
    expect(block).toContain('if (!verified) return { ok: false, error: GITHUB_READ_CONTROL_REFUSAL')
    expect(block).toContain('agentState: (id) => nodeState(id)')
  })
})

describe('grammar and agent-facing text', () => {
  it('parseControlRequest registers both verbs and runs the same gate', () => {
    expect(parseControlRequest('issues', {})).toEqual({ verb: 'issues', args: {} })
    expect(parseControlRequest('prs', { state: 'all' })).toEqual({ verb: 'prs', args: { state: 'all' } })
    expect(parseControlRequest('issues', { state: 'nope' })).toEqual({ error: expect.stringMatching(/--state/) })
    expect(parseControlRequest('prs', { label: 'bug' })).toEqual({ error: expect.stringMatching(/only --state and --limit/) })
    expect(parseControlRequest('issues', { project: 'other' })).toEqual({ error: expect.stringMatching(/--project/) })
  })

  it('both agent-facing bodies document the verbs and the untrusted-text sentence', () => {
    for (const body of [buildCanvasSkillBody('/x/nodeterm.sh'), buildCanvasControlInstructions('/x/nodeterm.sh')]) {
      expect(body).toContain('`issues [--state open|closed|all]')
      expect(body).toContain('`prs [--state open|merged|closed|all]')
      expect(body).toContain(UNTRUSTED_TEXT_NOTE)
      expect(body).toContain('`issues` and `prs` only read')
    }
  })
})

describe('Server Edition', () => {
  it('refuses both verbs by name, like every control verb on that edition', async () => {
    for (const verb of ['issues', 'prs']) {
      await expect(serverEditionControlHandler({ verb })).resolves.toMatchObject({
        ok: false,
        error: CONTROL_UNSUPPORTED_ERROR
      })
    }
  })
})
