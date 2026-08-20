/**
 * LOW STIMULATION's notification half, as behaviour rather than as a pure function nobody calls.
 *
 * `allowsNotification()` has been correct and unit-tested since the modes shipped; what did not
 * exist was anything that CALLED it, so every notification fired unfiltered while the docs said
 * otherwise. These tests are about the funnel (`lib/adhdNotify.ts`) that closes that gap: the one
 * place a `NotificationKind` becomes an ADHD classification, and the one place the decision is
 * applied.
 *
 * The load-bearing assertion is the last describe block: a notification that needs a person is
 * never silenced, under any combination of modes. That is the property the doc claims and the line
 * that decides whether this mode saves the user noise or costs them work.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { adhdKindForNotification, notify } from './adhdNotify'
import { ADHD_MODES_OFF } from './adhdModes'
import { useNotifications, type NotificationKind } from '../state/notifications'
import { useSettings } from '../state/settings'
import { DEFAULT_SETTINGS, type AdhdModes } from '@shared/types'

const ALL_KINDS: NotificationKind[] = ['info', 'success', 'progress', 'warning', 'error']

function setModes(patch: Partial<AdhdModes>): void {
  const adhdModes = { ...ADHD_MODES_OFF, ...patch }
  useSettings.setState({
    settings: { ...DEFAULT_SETTINGS, adhdModes },
    base: { ...DEFAULT_SETTINGS, adhdModes }
  })
}

/** A notification is a live toast only while it has not been dismissed. */
function liveToasts(): { title: string; kind: NotificationKind }[] {
  return useNotifications
    .getState()
    .items.filter((n) => n.dismissedAt == null)
    .map((n) => ({ title: n.title, kind: n.kind }))
}

beforeEach(() => {
  useNotifications.setState({ items: [] })
  // Written straight into the store rather than through `update()`, which would queue a disk write
  // this suite has no business making. Nothing here touches the IPC bridge.
  setModes({})
})

describe('the classification is made once, from the kind the call site already declares', () => {
  it('reads the store back rather than making a second, different judgement', () => {
    // The notifications store ALREADY decides that warning and error persist until a person
    // dismisses them and everything else times out on its own. That is the store saying which
    // kinds need a human; this mapping agrees with it instead of inventing a rival opinion.
    expect(adhdKindForNotification('error')).toBe('needs-you')
    expect(adhdKindForNotification('warning')).toBe('needs-you')
    expect(adhdKindForNotification('success')).toBe('done')
    expect(adhdKindForNotification('info')).toBe('informational')
    expect(adhdKindForNotification('progress')).toBe('informational')
  })

  it('is total — every kind the store can push has an answer', () => {
    for (const kind of ALL_KINDS) {
      expect(['needs-you', 'done', 'informational']).toContain(adhdKindForNotification(kind))
    }
  })
})

describe('with low stimulation off, nothing changes at all', () => {
  it('every kind is a live toast', () => {
    for (const kind of ALL_KINDS) notify({ kind, title: `t-${kind}` })
    expect(liveToasts()).toHaveLength(ALL_KINDS.length)
  })

  it('the other four modes do not touch notifications', () => {
    setModes({ focus: true, timeAwareness: true, oneThing: true, momentum: true })
    notify({ kind: 'info', title: 'still here' })
    expect(liveToasts().map((n) => n.title)).toEqual(['still here'])
  })

  it('a manually dismissed notification is never marked as quieted', () => {
    // dismissedAt alone cannot distinguish the two cases, so an ordinary user dismissal must not
    // set deliveredSilently — the notification centre relies on that separation to render the
    // right marker.
    notify({ kind: 'info', title: 'dismiss me' })
    const id = useNotifications.getState().items[0].id
    useNotifications.getState().dismiss(id)
    const item = useNotifications.getState().items.find((n) => n.id === id)!
    expect(item.dismissedAt).not.toBeNull()
    expect(item.deliveredSilently).toBe(false)
  })
})

describe('with low stimulation on, the interruption goes but the information does not', () => {
  beforeEach(() => setModes({ lowStimulation: true }))

  it('quiets done and informational', () => {
    notify({ kind: 'success', title: 'finished' })
    notify({ kind: 'info', title: 'packing' })
    notify({ kind: 'progress', title: 'working' })
    expect(liveToasts()).toEqual([])
  })

  it('keeps a quieted notification in the centre, unread — it is not deleted', () => {
    notify({ kind: 'success', title: 'finished' })
    const items = useNotifications.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('finished')
    // Quieter, not hidden: the bell still counts it, so nothing is lost by turning the mode on.
    expect(items[0].read).toBe(false)
    expect(items[0].dismissedAt).not.toBeNull()
  })

  it('marks a quieted delivery distinctly from an ordinary user dismissal', () => {
    // A quieted push and a user dismissal both end up with dismissedAt != null — that alone is
    // not enough to tell them apart in the notification centre. `deliveredSilently` is the field
    // that actually distinguishes them, and it must be true here and stay true.
    notify({ kind: 'info', title: 'quieted one' })
    const item = useNotifications.getState().items[0]
    expect(item.deliveredSilently).toBe(true)
    expect(item.dismissedAt).not.toBeNull()
  })

  it('never renders a quieted notification as a toast in any intermediate state', () => {
    // Pushed already dismissed rather than pushed-then-dismissed, so there is no render in which
    // it was briefly live. Asserted by watching every store update the push produces.
    const seen: number[] = []
    const unsub = useNotifications.subscribe((s) =>
      seen.push(s.items.filter((n) => n.dismissedAt == null).length)
    )
    notify({ kind: 'info', title: 'quiet' })
    unsub()
    expect(seen).toEqual([0])
  })
})

describe('a notification that needs a person is NEVER silenced', () => {
  // The safety property the doc claims. Asserted across every combination of the five modes rather
  // than for low-stimulation alone: the failure this guards against is a future mode, or a future
  // call site, quietly widening what gets dropped.
  const EVERY_COMBINATION: AdhdModes[] = []
  for (let bits = 0; bits < 32; bits++) {
    EVERY_COMBINATION.push({
      ...ADHD_MODES_OFF,
      focus: (bits & 1) !== 0,
      lowStimulation: (bits & 2) !== 0,
      timeAwareness: (bits & 4) !== 0,
      oneThing: (bits & 8) !== 0,
      momentum: (bits & 16) !== 0
    })
  }

  it('errors and warnings survive all 32 mode combinations', () => {
    for (const modes of EVERY_COMBINATION) {
      for (const kind of ['error', 'warning'] as const) {
        useNotifications.setState({ items: [] })
        setModes(modes)
        notify({ kind, title: 'answer me' })
        expect(
          liveToasts(),
          `${kind} was silenced with modes ${JSON.stringify(modes)}`
        ).toEqual([{ kind, title: 'answer me' }])
      }
    }
  })

  it('survives even a hand-edited settings.json that claims something nonsensical', () => {
    // normalizeAdhdModes re-validates on read; a garbage value must not become an excuse to drop
    // a notification the user has to answer.
    useSettings.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        adhdModes: { lowStimulation: 'yes', momentumMinutes: 'soon' } as never
      },
      base: DEFAULT_SETTINGS
    })
    notify({ kind: 'error', title: 'answer me' })
    expect(liveToasts()).toEqual([{ kind: 'error', title: 'answer me' }])
  })
})
