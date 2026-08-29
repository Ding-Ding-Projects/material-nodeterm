import { describe, it, expect } from 'vitest'
import * as core from './project-capability-consent'
import * as shared from '../shared/project-capability-consent'

describe('core re-exports the SAME functions the renderer imports from @shared — no drift possible', () => {
  it('every export is the same function object on both paths', () => {
    expect(core.needsCapabilityNotice).toBe(shared.needsCapabilityNotice)
    expect(core.projectCapabilityGranted).toBe(shared.projectCapabilityGranted)
    expect(core.projectCapabilityGrantedFor).toBe(shared.projectCapabilityGrantedFor)
    expect(core.capabilityAnswerOf).toBe(shared.capabilityAnswerOf)
    expect(core.recordCapabilityAck).toBe(shared.recordCapabilityAck)
  })
})
