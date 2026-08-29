// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AlarmClockNode from './AlarmClockNode'
import TimerNode from './TimerNode'
import CalendarNode from './CalendarNode'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { mapOwnedSentence, copy, fact } from '../lib/personalVocabulary/ownedCopy'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  NodeResizer: () => null,
  Position: { Left: 'left' },
  useReactFlow: () => ({ updateNodeData: vi.fn(), deleteElements: vi.fn() })
}))

vi.mock('../state/destructiveGate', () => ({ openDestructiveGate: vi.fn() }))

vi.mock('../session/session', () => {
  const session = {
    api: {
      calendar: {
        accounts: () => Promise.resolve([]),
        calendars: () => Promise.resolve([]),
        events: () => Promise.resolve({ state: 'fresh', events: [] }),
        refresh: () => Promise.resolve({ state: 'fresh', events: [] }),
        connectCalDav: () => Promise.reject(new Error('provider refused the connection')),
        beginOAuth: () => Promise.resolve({ state: 'unavailable', reason: 'provider unavailable', authorizationUrl: null }),
        disconnectAccount: () => Promise.resolve(false),
        create: () => Promise.reject(new Error('write refused')),
        update: () => Promise.resolve(null),
        remove: () => Promise.resolve(false),
        importIcs: () => Promise.resolve({ events: [] })
      },
      dialog: { selectFile: () => Promise.resolve(null) },
      fs: { read: () => Promise.resolve('') },
      export: { saveText: () => Promise.resolve(true) },
      shell: { openExternal: () => Promise.resolve(true) }
    }
  }
  return { useSession: () => session }
})

let host: HTMLDivElement
let root: Root

const renderNode = (element: React.JSX.Element): void => {
  act(() => root.render(element))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useSchoolMode.setState({ enabled: false, hydrated: true })
  usePersonalVocabulary.setState({
    entries: {
      Schedule: 'Plan',
      'Start alarm': 'Begin alarm',
      'Alarm recurrence': 'Cycle',
      Calendar: 'Planner',
      'Search events': 'Find events',
      Agenda: 'Today',
      Duration: 'Length',
      Start: 'Go',
      'Timer title': 'Clock label'
    },
    status: 'loaded',
    entryCount: 10,
    loadedAt: Date.now(),
    lastError: null
  })
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    alarm: undefined,
    timer: { schedule: vi.fn(() => Promise.resolve(undefined)), transition: vi.fn() }
  }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('time nodes personal-vocabulary boundaries', () => {
  it('maps alarm controls while retaining the user alarm title and schedule facts', () => {
    renderNode(<AlarmClockNode {...({ id: 'alarm-1', selected: false, data: {
      title: 'Focus alarm', color: '#0a84ff', alarmEnabled: false, alarmTimeZone: 'America/Toronto',
      alarmSchedule: { recurrence: 'once', date: '2099-01-01', time: '09:00' }, alarmHistory: []
    } } as unknown as Parameters<typeof AlarmClockNode>[0])} />)
    expect(host.textContent).toContain('Plan')
    expect(host.textContent).toContain('Begin alarm')
    expect(host.textContent).toContain('Focus alarm')
    expect(host.querySelector('[aria-label="Cycle"]')).not.toBeNull()
    expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe('2099-01-01')
  })

  it('maps timer labels but keeps the timer title and rendered duration exact', () => {
    renderNode(<TimerNode {...({ id: 'timer-1', selected: false, data: {
      title: 'Deep work', color: '#0a84ff', group: null, timerMode: 'countdown', durationMs: 125000,
      remainingMs: 125000, elapsedMs: 0, running: false, paused: false, repeatCount: 2,
      repeatRemaining: 2, sequence: [], sequenceIndex: 0, lapsMs: [], occurrenceState: 'scheduled',
      alarmEnabled: false, alarmTone: 'chime', missedCount: 0
    } } as unknown as Parameters<typeof TimerNode>[0])} />)
    expect(host.textContent).toContain('Length')
    expect(host.textContent).toContain('Go')
    expect(host.querySelector<HTMLInputElement>('.timer-node__title')?.value).toBe('Deep work')
    expect(host.querySelector('.timer-node__display')?.textContent).toBe('2:05')
    expect(host.querySelector('input[aria-label="Clock label"]')).not.toBeNull()
  })

  it('maps calendar framing while preserving provider values and event facts', async () => {
    localStorage.setItem('nodeterm.calendar.cache-calendar-1', JSON.stringify([{
      id: 'event-1', calendarId: 'local', title: 'Planning 100%', start: '2099-01-01T09:00:00.000Z',
      end: '2099-01-01T10:00:00.000Z', timezone: 'UTC', allDay: false, location: 'Room 42',
      description: null, recurrence: 'RRULE:FREQ=WEEKLY', updatedAt: 1
    }]))
    renderNode(<CalendarNode {...({ id: 'calendar-1', selected: false, data: {
      title: 'Team calendar', color: '#0a84ff', calendarConfig: {
        provider: 'local', accountId: null, calendarId: null, timezone: 'UTC', view: 'agenda',
        showWeekends: true, cacheEnabled: true
      }
    } } as unknown as Parameters<typeof CalendarNode>[0])} />)
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(host.querySelector('.calendar-node__title')?.textContent).toBe('Team calendar')
    expect(host.textContent).toContain('Find events')
    expect(host.querySelector('[role="tab"]')?.textContent).toBe('Today')
    expect(host.querySelector('option')?.textContent).toBe('Local calendar')
  })

  it('restores original authored copy immediately in School mode without changing fact segments', () => {
    const map = (text: string) => text.replace('Schedule', 'Plan')
    expect(mapOwnedSentence(map, [copy('Schedule '), fact('America/Toronto')])).toBe('Plan America/Toronto')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true }))
    renderNode(<AlarmClockNode {...({ id: 'alarm-school', selected: false, data: {
      title: 'School bell', color: '#0a84ff', alarmEnabled: false, alarmTimeZone: 'UTC',
      alarmSchedule: { recurrence: 'once', date: '2099-01-01', time: '09:00' }, alarmHistory: []
    } } as unknown as Parameters<typeof AlarmClockNode>[0])} />)
    expect(host.textContent).toContain('Schedule')
    expect(host.textContent).not.toContain('Plan')
    expect(host.textContent).toContain('School bell')
  })
})
