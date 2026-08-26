import { describe, it, expect } from 'vitest'
import {
  needsCapabilityNotice,
  projectCapabilityGranted,
  projectCapabilityGrantedFor,
  capabilityAnswerOf,
  recordCapabilityAck
} from './project-capability-consent'

const cap = 'agentBrowserControl' as const

describe('needsCapabilityNotice', () => {
  it('off in the file ⇒ never a notice', () => {
    expect(needsCapabilityNotice({ capability: cap, enabledInFile: false, answer: undefined })).toBe(
      false
    )
  })
  it('on in the file and never answered ON THIS MACHINE ⇒ notice', () => {
    expect(needsCapabilityNotice({ capability: cap, enabledInFile: true, answer: undefined })).toBe(
      true
    )
  })
  it('on and KEPT ⇒ silent forever after', () => {
    expect(needsCapabilityNotice({ capability: cap, enabledInFile: true, answer: 'kept' })).toBe(
      false
    )
  })
  it('on and DECLINED, then the hostile true re-arrives ⇒ notice AGAIN, not silence', () => {
    // A recorded "no" must not become a standing acknowledgment: a routine `git checkout`/pull
    // restoring the hostile `true` is a NEW event to be told about.
    expect(needsCapabilityNotice({ capability: cap, enabledInFile: true, answer: 'declined' })).toBe(
      true
    )
  })
})

describe('projectCapabilityGranted — a pending or declined notice is a refusal, never a grant', () => {
  it('a switch that is on but unanswered grants nothing', () => {
    expect(
      projectCapabilityGranted({ capability: cap, enabledInFile: true, answer: undefined })
    ).toBe(false)
  })
  it('off in the file grants nothing, whatever was answered', () => {
    expect(projectCapabilityGranted({ capability: cap, enabledInFile: false, answer: 'kept' })).toBe(
      false
    )
  })
  it('a DECLINED switch grants nothing even when the file says true again', () => {
    expect(
      projectCapabilityGranted({ capability: cap, enabledInFile: true, answer: 'declined' })
    ).toBe(false)
  })
  it('on and KEPT is the ONE granting combination', () => {
    expect(projectCapabilityGranted({ capability: cap, enabledInFile: true, answer: 'kept' })).toBe(
      true
    )
  })
})

describe('capabilityAnswerOf — own properties only', () => {
  it('reads a recorded answer', () => {
    expect(capabilityAnswerOf({ capabilityAck: { agentBrowserControl: 'kept' } }, cap)).toBe('kept')
  })
  it('undefined for no ack, null, or a malformed value', () => {
    expect(capabilityAnswerOf(undefined, cap)).toBeUndefined()
    expect(capabilityAnswerOf(null, cap)).toBeUndefined()
    expect(
      capabilityAnswerOf({ capabilityAck: { agentBrowserControl: 'yes' as never } }, cap)
    ).toBeUndefined()
  })
  it('ignores a prototype-inherited ack', () => {
    const proto = { agentBrowserControl: 'kept' as const }
    const ack = Object.create(proto)
    expect(capabilityAnswerOf({ capabilityAck: ack }, cap)).toBeUndefined()
  })
})

describe('projectCapabilityGrantedFor — the one consumer-facing predicate', () => {
  it('derives both halves so a consumer cannot pick the raw file flag by mistake', () => {
    expect(projectCapabilityGrantedFor({ [cap]: true }, cap)).toBe(false) // unanswered
    expect(
      projectCapabilityGrantedFor({ [cap]: true, capabilityAck: { [cap]: 'kept' } }, cap)
    ).toBe(true)
    expect(
      projectCapabilityGrantedFor({ [cap]: true, capabilityAck: { [cap]: 'declined' } }, cap)
    ).toBe(false)
    expect(projectCapabilityGrantedFor(undefined, cap)).toBe(false)
  })
})

describe('recordCapabilityAck', () => {
  it('writes to the entry, does not mutate its input, and a later answer overwrites an earlier one', () => {
    const before = { capabilityAck: { [cap]: 'declined' as const } }
    const kept = recordCapabilityAck(before, cap, 'kept')
    expect(kept).not.toBe(before)
    expect(before.capabilityAck).toEqual({ [cap]: 'declined' })
    expect(kept.capabilityAck).toEqual({ [cap]: 'kept' })
  })

  it('a SECOND WORKTREE of the same repo notifies again', () => {
    // node ids and project.json re-materialise in a second folder (git worktree add / checkout /
    // reset --hard); the index entry id is the only authority for project identity. A second
    // folder is a second entry, hence a second notice — which is correct: it is a different
    // working copy the user has not vetted.
    const a = recordCapabilityAck({}, cap, 'kept')
    const b = {} // same repo, second worktree, fresh entry — no ack at all
    expect(
      needsCapabilityNotice({ capability: cap, enabledInFile: true, answer: capabilityAnswerOf(a, cap) })
    ).toBe(false)
    expect(
      needsCapabilityNotice({ capability: cap, enabledInFile: true, answer: capabilityAnswerOf(b, cap) })
    ).toBe(true)
  })
})
