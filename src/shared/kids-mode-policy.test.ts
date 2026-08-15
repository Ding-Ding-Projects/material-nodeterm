import { describe, expect, it } from 'vitest'

import { ALL_PERMISSION_MODES } from './agents/config'
import {
  KIDS_ALLOWED_PERMISSION_MODES,
  KIDS_DISCLOSURE,
  KIDS_REFUSED_PERMISSION_MODES,
  gateKidsPermissionMode,
  requiresDestructiveGate,
  unclassifiedPermissionModes
} from './kids-mode-policy'

describe('the honesty of what kids mode claims', () => {
  it('states outright that it does not sandbox the terminal', () => {
    // The whole reason this feature is defensible is that it does not overstate itself. A parent
    // who reads "safe for children" and walks away has been misled by us.
    expect(KIDS_DISCLOSURE).toMatch(/does NOT sandbox/i)
    expect(KIDS_DISCLOSURE).toMatch(/anything your account can do/i)
  })
})

describe('permission modes', () => {
  it('refuses bypassPermissions — the mode whose purpose is acting without asking', () => {
    const r = gateKidsPermissionMode('bypassPermissions', true)
    expect(r.mode).toBe('manual')
    expect(r.changed).toBe(true)
    expect(r.why).toMatch(/without asking/i)
  })

  it('refuses acceptEdits, because file writes would happen unattended', () => {
    const r = gateKidsPermissionMode('acceptEdits', true)
    expect(r.mode).toBe('manual')
    expect(r.changed).toBe(true)
  })

  it('degrades a refused mode to manual, NOT to the next-loosest option', () => {
    // The safe direction when a value is rejected is the most conservative one. Degrading
    // "bypass everything" to "auto" would still widen what happens with nobody watching.
    expect(gateKidsPermissionMode('bypassPermissions', true).mode).toBe('manual')
    expect(gateKidsPermissionMode('acceptEdits', true).mode).toBe('manual')
  })

  it('allows the modes that ask, or that only propose', () => {
    for (const m of KIDS_ALLOWED_PERMISSION_MODES) {
      const r = gateKidsPermissionMode(m, true)
      expect(r.mode, `${m} should pass through`).toBe(m)
      expect(r.changed).toBe(false)
    }
  })

  it('re-validates an unrecognised value rather than trusting the type', () => {
    // Modes arrive from hand-editable, git-shared JSON and end up on a command line. The
    // TypeScript type is compile-time only, so the check has to exist at the decision point.
    for (const junk of ['', 'constructor', '__proto__', 'BYPASSPERMISSIONS', 'plan; rm -rf /']) {
      const r = gateKidsPermissionMode(junk, true)
      expect(r.mode, `${JSON.stringify(junk)} must degrade safely`).toBe('manual')
      expect(r.changed).toBe(true)
    }
  })

  it('refuses auto — the promise on the toggle depends on it', () => {
    // `auto` is the app-wide DEFAULT and auto-approves most tool calls, so while it was allowed
    // the settings copy ("agents cannot start in a mode that acts without asking") was false. It
    // was also incoherent: acceptEdits, which is NARROWER, was refused while auto was not.
    const r = gateKidsPermissionMode('auto', true)
    expect(r.mode).toBe('manual')
    expect(r.changed).toBe(true)
    expect(r.why).toMatch(/auto-approves/i)
  })

  it('allows nothing that acts without asking', () => {
    // The invariant behind the toggle's wording. If a mode is ever added that auto-approves, this
    // fails rather than the promise quietly becoming untrue.
    const ACTS_WITHOUT_ASKING = ['auto', 'acceptEdits', 'bypassPermissions']
    for (const m of ACTS_WITHOUT_ASKING) {
      expect(KIDS_ALLOWED_PERMISSION_MODES, `${m} must not be allowed`).not.toContain(m)
    }
  })

  it('changes nothing at all when kids mode is off', () => {
    for (const m of ALL_PERMISSION_MODES) {
      const r = gateKidsPermissionMode(m, false)
      expect(r.mode, `${m} untouched with the mode off`).toBe(m)
      expect(r.changed).toBe(false)
    }
  })

  it('has an explicit opinion about EVERY mode the app knows about', () => {
    // The guard against a silent gap: a permission mode added later would otherwise fall into the
    // refused branch with a generic message and nobody would notice kids mode had formed an
    // opinion about a mode no one had considered.
    expect(unclassifiedPermissionModes()).toEqual([])
  })

  it('gives a real reason for every refusal, not a bare rejection', () => {
    for (const [mode, why] of Object.entries(KIDS_REFUSED_PERMISSION_MODES)) {
      expect(why.length, `${mode} needs a reason worth showing`).toBeGreaterThan(20)
    }
  })

  it('never allows and refuses the same mode', () => {
    for (const m of KIDS_ALLOWED_PERMISSION_MODES) {
      expect(m in KIDS_REFUSED_PERMISSION_MODES, `${m} cannot be both`).toBe(false)
    }
  })
})

describe('the destructive gate', () => {
  const ACTIONS = [
    'delete-project',
    'delete-node',
    'discard-changes',
    'remove-worktree',
    'revoke-device',
    'clear-history'
  ] as const

  it('is mandatory for every guarded action while kids mode is on', () => {
    for (const a of ACTIONS) {
      const r = requiresDestructiveGate(a, true)
      expect(r.required, `${a} must be gated`).toBe(true)
      expect(r.reason).toBeTruthy()
    }
  })

  it('says why it appeared — the difference between learning and clicking through', () => {
    expect(requiresDestructiveGate('delete-project', true).reason).toMatch(/asks before/i)
  })

  it('leaves the existing behaviour alone when the mode is off', () => {
    for (const a of ACTIONS) {
      expect(requiresDestructiveGate(a, false).required).toBe(false)
    }
  })
})
