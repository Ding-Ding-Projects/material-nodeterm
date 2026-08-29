// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlannerSection } from './PlannerSection'
import { useDestructiveGate } from '../../../state/destructiveGate'
import { usePersonalVocabulary } from '../../../state/personalVocabulary'
import { useSchoolMode } from '../../../state/schoolMode'

const SCHEDULE = {
  id: 'planner-fact-1',
  title: 'Quarterly review · Q3',
  enabled: true,
  timeZone: 'America/Toronto',
  startLocal: '2026-08-28T19:00',
  recurrence: { kind: 'once' as const },
  notification: { title: 'Review reminder', body: 'Review the quarterly plan.' }
}

describe('PlannerSection vocabulary boundaries', () => {
  beforeEach(() => {
    useSchoolMode.setState({ enabled: false, hydrated: true })
    usePersonalVocabulary.setState({
      entries: {
        Planner: 'Day planner',
        Delete: 'Remove',
        'Delete planner schedule “{scheduleTitle}”': 'Remove planner schedule “{scheduleTitle}”'
      },
      status: 'loaded',
      entryCount: 3,
      loadedAt: Date.now(),
      lastError: null
    })
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      planner: {
        load: vi.fn(async () => ({ ok: true, file: { version: 1, schedules: [SCHEDULE] } })),
        history: vi.fn(async () => []),
        onOccurrence: vi.fn(() => () => undefined),
        save: vi.fn(async () => ({ ok: true })),
        export: vi.fn(async () => ({ filename: 'planner.json', content: '{}' }))
      },
      export: { saveText: vi.fn() }
    }
  })

  afterEach(() => {
    cleanup()
    useDestructiveGate.setState({ request: null })
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
    vi.restoreAllMocks()
  })

  it('maps planner headings and status copy while keeping schedule values factual', async () => {
    render(<PlannerSection isActive />)
    await waitFor(() => expect(screen.getByDisplayValue(SCHEDULE.title)).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Day planner' })).toBeTruthy()
    expect(screen.getByLabelText('Search planner schedules')).toBeTruthy()
    expect(screen.getByDisplayValue(SCHEDULE.title)).toBeTruthy()
    expect(screen.getByLabelText(`Enable ${SCHEDULE.title}`)).toBeTruthy()
  })

  it('passes schedule.title as an exact fact to every destructive-gate field', async () => {
    render(<PlannerSection isActive />)
    await waitFor(() => expect(screen.getByDisplayValue(SCHEDULE.title)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: `Remove ${SCHEDULE.title}` }))
    const request = useDestructiveGate.getState().request
    expect(request).toBeTruthy()
    expect(request?.title).toBe('Delete planner schedule “{scheduleTitle}”')
    expect(request?.titleParams).toEqual({ scheduleTitle: SCHEDULE.title })
    expect(request?.descriptionParams).toEqual({ scheduleTitle: SCHEDULE.title })
    expect(request?.description).toContain('{scheduleTitle}')
    expect(request?.affected).toEqual([SCHEDULE.title])
  })
})
