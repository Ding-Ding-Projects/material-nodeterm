import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CalendarService } from './service'
import { DEFAULT_CALENDAR_NODE_CONFIG, type CalendarNodeConfig } from '../../shared/calendar'
import type { CorePlatform } from '../platform'

const config: CalendarNodeConfig = { ...DEFAULT_CALENDAR_NODE_CONFIG, calendarId: 'local' }
const event = (title: string, hour: number, calendarId = 'local') => ({
  calendarId,
  title,
  start: `2026-08-26T${String(hour).padStart(2, '0')}:00:00.000Z`,
  end: `2026-08-26T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  timezone: 'UTC',
  allDay: false,
  location: null,
  description: null,
  recurrence: null
})
const platformFor = (userDataDir: string): CorePlatform => ({
  userDataDir,
  appVersion: 'test',
  isPackaged: false,
  handle: () => undefined,
  on: () => undefined,
  handleWithSender: () => undefined,
  onWithSender: () => undefined,
  sendTo: () => undefined,
  broadcast: () => undefined,
  clientIds: () => [],
  openExternal: async () => undefined
})

describe('calendar service source binding and cache', () => {
  const roots: string[] = []
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

  it('rejects malformed event ranges before touching local storage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'calendar-')); roots.push(root)
    const service = new CalendarService(platformFor(root))
    await expect(service.create({ nodeId: 'node-1', event: { ...event('Nope', 10), end: '2026-08-26T09:00:00.000Z' } })).rejects.toThrow('invalid')
  })

  it('serializes concurrent local read-modify-write mutations', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'calendar-')); roots.push(root)
    const service = new CalendarService(platformFor(root))
    await Promise.all([1, 2, 3].map((index) => service.create({ nodeId: 'node-concurrent', event: event(`Event ${index}`, 9 + index) })))
    expect((await service.events('node-concurrent', config)).events).toHaveLength(3)
  })

  it('preserves a source-qualified cache and distinguishes corrupt reads from missing reads', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'calendar-')); roots.push(root)
    const service = new CalendarService(platformFor(root))
    const created = await service.create({ nodeId: 'node-2', event: event('Local', 10) })
    expect((await service.events('node-2', config)).events[0]?.id).toBe(created.id)
    await writeFile(path.join(root, 'calendar-nodes', 'node-2.json'), '{broken', 'utf8')
    await expect(service.events('node-2', config)).rejects.toThrow()
    await expect(service.events('node-missing', config)).resolves.toMatchObject({ state: 'empty', events: [] })
    expect(await readFile(path.join(root, 'calendar-nodes', 'node-2.json'), 'utf8')).toContain('broken')
  })

  it('keeps remote provider rows disabled and never synthesizes a writable source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'calendar-')); roots.push(root)
    const service = new CalendarService(platformFor(root))
    const remote = { ...config, provider: 'google' as const, calendarId: null, accountId: 'account-1' }
    await expect(service.beginOAuth('google')).resolves.toMatchObject({ state: 'unsupported', authorizationUrl: null })
    await expect(service.calendars(remote.accountId, remote.provider)).resolves.toEqual([])
    await expect(service.status('node-3', remote)).resolves.toMatchObject({ state: 'unconfigured', source: null, cache: { events: [] } })
  })
})
