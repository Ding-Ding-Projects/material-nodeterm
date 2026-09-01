import { describe, expect, it } from 'vitest'
import { taskbarBadgePlan } from './windows-taskbar-badge'

describe('taskbarBadgePlan', () => {
  it('clears for absent, invalid, and non-positive counts', () => {
    expect(taskbarBadgePlan(undefined)).toBeNull()
    expect(taskbarBadgePlan(Number.NaN)).toBeNull()
    expect(taskbarBadgePlan(0)).toBeNull()
    expect(taskbarBadgePlan(-1)).toBeNull()
  })

  it('produces an accessible single-count overlay', () => {
    const plan = taskbarBadgePlan(1)
    expect(plan?.description).toBe('1 unread agent update')
    expect(plan?.dataUrl).toMatch(/^data:image\/svg\+xml/)
    expect(decodeURIComponent(plan!.dataUrl)).toContain('>1</text>')
  })

  it('bounds large values without lying in the accessibility description', () => {
    const plan = taskbarBadgePlan(1200)
    expect(plan?.description).toBe('999 unread agent updates')
    expect(decodeURIComponent(plan!.dataUrl)).toContain('>99+</text>')
  })
})
