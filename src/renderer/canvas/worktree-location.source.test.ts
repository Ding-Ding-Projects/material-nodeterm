import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * Structural pins for the shared-settings worktree location rule in Canvas.tsx. The behavior of the
 * rule itself is proven in `@shared/worktree-location` (and the real-git backstop in
 * `core/worktree-target.test.ts`); these pins only make sure both create paths in the component
 * judge the location BEFORE anything is created, and that an explicit path is never judged.
 */
const src = readFileSync(new URL('./Canvas.tsx', import.meta.url), 'utf8')

describe('worktree location from the git-shared settings file (source pins)', () => {
  it('the New worktree dialog refuses a shared location before it starts creating', () => {
    const start = src.indexOf('const createWorktreeAndGroup = useCallback(')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, start + 2500)
    const refusal = body.indexOf('sharedWorktreeLocationRefusal(')
    expect(refusal).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(body.indexOf('setWorktreeBusy(true)'))
    expect(refusal).toBeLessThan(body.indexOf('api.git'))
  })

  it("the open-worktree verb judges only a derived path, before the create call", () => {
    const start = src.indexOf("case 'open-worktree': {")
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, start + 9000)
    const refusal = body.indexOf('sharedWorktreeLocationRefusal(')
    expect(refusal).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(body.indexOf('.worktreeAdd('))
    expect(body).toContain('args.path?.trim() ? undefined : sharedBasePathOf(pw)')
  })
})
