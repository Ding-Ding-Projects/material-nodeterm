import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CALENDAR_NODE_CONFIG,
  parseIcs,
  validateCalendarConfig
} from './calendar'

const ics = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:America/Toronto\r\n${body}\r\nEND:VCALENDAR\r\n`
const event = (body: string) => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT\r\n`

describe('calendar source contracts', () => {
  it('normalizes unsafe provider and timezone values without widening node intent', () => {
    expect(validateCalendarConfig(DEFAULT_CALENDAR_NODE_CONFIG)).toEqual(DEFAULT_CALENDAR_NODE_CONFIG)
    expect(validateCalendarConfig({ ...DEFAULT_CALENDAR_NODE_CONFIG, provider: 'not-a-provider', extra: true })).toMatchObject({ provider: 'local' })
    expect(validateCalendarConfig({ ...DEFAULT_CALENDAR_NODE_CONFIG, timezone: 'Not/Iana' })).toMatchObject({ timezone: 'local' })
  })

  it('accepts valid events, deduplicates UID, and reports malformed records individually', () => {
    const parsed = parseIcs(ics(event('UID:one\r\nDTSTART:20260826T100000\r\nDTEND:20260826T110000\r\nSUMMARY:One') + event('UID:one\r\nDTSTART:20260826T120000\r\nDTEND:20260826T130000\r\nSUMMARY:Duplicate')))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.title).toBe('One')
  })

  it('expands bounded weekly recurrence and applies EXDATE', () => {
    const parsed = parseIcs(ics(event('UID:weekly\r\nDTSTART;TZID=America/Toronto:20260824T100000\r\nDTEND;TZID=America/Toronto:20260824T110000\r\nSUMMARY:Weekly')))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.timezone).toBe('America/Toronto')
  })

  it('supports all-day end dates and bounded duration', () => {
    const parsed = parseIcs(ics(event('UID:day\r\nDTSTART;VALUE=DATE:20260826\r\nDTEND;VALUE=DATE:20260827\r\nSUMMARY:Day')))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.allDay).toBe(true)
    expect(parsed[0]?.end).toBe('2026-08-27T00:00:00')
  })

  it('keeps RDATE additions and refuses unsupported recurrence instead of guessing', () => {
    const parsed = parseIcs(ics(event('UID:rdate\r\nDTSTART:20260826T100000Z\r\nDTEND:20260826T110000Z\r\nSUMMARY:R dates')))
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.id).toBe('rdate')
  })

  it('expands recurring wall times across a daylight-saving transition', () => {
    const parsed = parseIcs(ics(event('UID:dst\r\nDTSTART;TZID=America/Toronto:20261031T013000\r\nDTEND;TZID=America/Toronto:20261031T023000\r\nSUMMARY:DST')))
    expect(parsed[0]?.timezone).toBe('America/Toronto')
  })

  it('uses an IANA location declared by a VTIMEZONE component', () => {
    const parsed = parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:alias\r\nDTSTART;TZID=America/Toronto:20260826T100000\r\nDTEND;TZID=America/Toronto:20260826T110000\r\nSUMMARY:Alias\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')
    expect(parsed[0]?.timezone).toBe('America/Toronto')
  })
})
