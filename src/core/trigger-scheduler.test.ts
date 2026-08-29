import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNodeState, Project } from '../shared/types'
import type { TriggerSpec } from '../shared/trigger'
import { TriggerArmStore } from './trigger-arm-store'
import { nextTriggerOccurrence, TriggerScheduler } from './trigger-scheduler'

const target = (id = 'term-target-1'): CanvasNodeState => ({
  id,
  kind: 'terminal',
  position: { x: 0, y: 0 },
  size: { width: 640, height: 440 },
  title: 'Terminal',
  color: '#fff',
  group: null
})

const trigger = (spec: TriggerSpec): CanvasNodeState => ({
  id: 'trigger-node-1',
  kind: 'trigger',
  position: { x: 0, y: 0 },
  size: { width: 360, height: 260 },
  title: 'Trigger',
  color: '#fff',
  group: null,
  trigger: spec
})

const project = (nodes: CanvasNodeState[]): Project => ({
  id: 'project-1',
  name: 'Project',
  color: '#fff',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes
})

describe('nextTriggerOccurrence', () => {
  it('supports interval and once schedules', () => {
    expect(nextTriggerOccurrence({ kind: 'interval', everyMinutes: 5 }, 1000)).toBe(301000)
    expect(nextTriggerOccurrence({ kind: 'once', at: '2026-08-29T12:00:00Z' }, Date.parse('2026-08-29T11:00:00Z'))).toBe(Date.parse('2026-08-29T12:00:00Z'))
  })

  it('finds a five-field cron occurrence in the configured timezone', () => {
    const after = Date.parse('2026-08-29T12:00:00Z')
    expect(nextTriggerOccurrence({ kind: 'cron', expr: '5 8 * * *' }, after, 'UTC')).toBe(Date.parse('2026-08-30T08:05:00Z'))
  })

  it('treats a bare stepped value as a range through the field maximum', () => {
    const after = Date.parse('2026-08-29T12:00:00Z')
    expect(nextTriggerOccurrence({ kind: 'cron', expr: '5/2 12 * * *' }, after, 'UTC')).toBe(
      Date.parse('2026-08-29T12:05:00Z')
    )
    expect(nextTriggerOccurrence({ kind: 'cron', expr: '5/2 12 * * *' }, Date.parse('2026-08-29T12:05:00Z'), 'UTC')).toBe(
      Date.parse('2026-08-29T12:07:00Z')
    )
  })

  it('uses cron OR semantics when both day-of-month and day-of-week are restricted', () => {
    const after = Date.parse('2026-08-30T00:00:00Z') // Sunday
    expect(nextTriggerOccurrence({ kind: 'cron', expr: '0 0 1 * 1' }, after, 'UTC')).toBe(
      Date.parse('2026-08-31T00:00:00Z') // Monday, even though it is not the first
    )
  })

  it('jumps to the next local day without skipping midnight across a DST transition', () => {
    const after = Date.parse('2026-03-08T04:01:00Z') // 23:01 on March 7 in New York
    expect(nextTriggerOccurrence({ kind: 'cron', expr: '0 0 9 3 *' }, after, 'America/New_York')).toBe(
      Date.parse('2026-03-09T04:00:00Z')
    )
  })

  it('rejects a never-matching cron expression without scanning every minute of a year', () => {
    const started = performance.now()
    const result = nextTriggerOccurrence(
      { kind: 'cron', expr: '0 0 30 2 *' },
      Date.parse('2026-01-01T00:00:00Z'),
      'UTC'
    )
    expect(result).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(250)
  })
})

describe('TriggerScheduler', () => {
  const tempDirs: string[] = []
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('requires local consent for scheduled delivery but permits explicit run now', async () => {
    let clock = Date.parse('2026-08-29T12:00:00Z')
    const armDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trigger-scheduler-'))
    tempDirs.push(armDir)
    const arms = new TriggerArmStore(armDir)
    await arms.load()
    const deliver = vi.fn(async () => ({ outcome: 'delivered' as const }))
    const p = project([trigger({ schedule: { kind: 'interval', everyMinutes: 1 }, payload: 'echo hi', target: 'term-target-1' }), target()])
    const scheduler = new TriggerScheduler({ armStore: arms, now: () => clock, getProject: () => p, deliver })
    scheduler.updateProject('project-1', p.nodes)
    expect((await scheduler.runNow('project-1', 'trigger-node-1')).outcome).toBe('delivered')
    expect(deliver).toHaveBeenCalledTimes(1)
    clock += 60_000
    await scheduler.tick()
    expect(deliver).toHaveBeenCalledTimes(1)
    await scheduler.arm('project-1', 'trigger-node-1', p.nodes[0].trigger!)
    await scheduler.tick()
    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it('serializes one in-flight run and keeps bounded history', async () => {
    let resolve: (() => void) | undefined
    const pending = new Promise<void>((done) => { resolve = done })
    const armDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trigger-scheduler-'))
    tempDirs.push(armDir)
    const arms = new TriggerArmStore(armDir)
    await arms.load()
    const p = project([trigger({ schedule: { kind: 'interval', everyMinutes: 1 }, payload: 'echo hi', target: 'term-target-1' }), target()])
    const scheduler = new TriggerScheduler({
      armStore: arms,
      getProject: () => p,
      deliver: async () => { await pending; return { outcome: 'delivered' as const } },
      maxHistory: 4
    })
    scheduler.updateProject('project-1', p.nodes)
    await scheduler.arm('project-1', 'trigger-node-1', p.nodes[0].trigger!)
    const first = scheduler.runNow('project-1', 'trigger-node-1')
    expect((await scheduler.runNow('project-1', 'trigger-node-1')).outcome).toBe('skipped-previous-run-active')
    resolve?.()
    expect((await first).outcome).toBe('delivered')
    expect(scheduler.listHistory('project-1').length).toBeLessThanOrEqual(4)
  })

  it('round-trips bounded payload-free history through the machine-local file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trigger-scheduler-history-'))
    tempDirs.push(dir)
    const historyFile = path.join(dir, 'triggers', 'history.json')
    const arms = new TriggerArmStore(dir)
    await arms.load()
    const p = project([trigger({ schedule: { kind: 'interval', everyMinutes: 1 }, payload: 'secret-like text', target: 'term-target-1' }), target()])
    const first = new TriggerScheduler({ armStore: arms, getProject: () => p, historyFile, maxHistory: 2, deliver: async () => ({ outcome: 'delivered' as const }) })
    first.updateProject('project-1', p.nodes)
    await first.runNow('project-1', 'trigger-node-1')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const raw = await fs.readFile(historyFile, 'utf8')
    expect(raw).not.toContain('secret-like text')
    const second = new TriggerScheduler({ armStore: arms, getProject: () => p, historyFile, maxHistory: 2, deliver: async () => ({ outcome: 'delivered' as const }) })
    await second.loadHistory()
    expect(second.listHistory('project-1')).toHaveLength(1)
  })
})
