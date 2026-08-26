import { describe, expect, it } from 'vitest'
import {
  canManageWslDistro,
  isSafeWslDistroName,
  revalidateWslBinding,
  sanitizeGroupWsl,
  wslProfileIdFor,
  type GroupWsl
} from './wsl-binding'

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('isSafeWslDistroName', () => {
  it('accepts an ordinary distro name', () => {
    expect(isSafeWslDistroName('Ubuntu-24.04')).toBe(true)
  })
  it('rejects empty', () => {
    expect(isSafeWslDistroName('')).toBe(false)
  })
  it('rejects outer whitespace', () => {
    expect(isSafeWslDistroName(' Ubuntu ')).toBe(false)
  })
  it('rejects a control character', () => {
    expect(isSafeWslDistroName('Ubuntu\n--exec')).toBe(false)
  })
  it('rejects a non-string', () => {
    expect(isSafeWslDistroName(123)).toBe(false)
  })
  it('rejects a name past the length cap', () => {
    expect(isSafeWslDistroName('a'.repeat(257))).toBe(false)
  })
})

describe('wslProfileIdFor', () => {
  it('builds the wsl: profile id', () => {
    expect(wslProfileIdFor('Ubuntu')).toBe('wsl:Ubuntu')
  })
})

describe('sanitizeGroupWsl — the shared/hostile-input boundary', () => {
  it('accepts a well-formed binding', () => {
    const value = { bindingId: UUID, distroName: 'Ubuntu' }
    expect(sanitizeGroupWsl(value)).toEqual(value)
  })
  it('refuses a missing bindingId', () => {
    expect(sanitizeGroupWsl({ distroName: 'Ubuntu' })).toBeUndefined()
  })
  it('refuses a non-uuid bindingId', () => {
    expect(sanitizeGroupWsl({ bindingId: 'not-a-uuid', distroName: 'Ubuntu' })).toBeUndefined()
  })
  it('refuses a hostile distro name smuggling a flag', () => {
    expect(
      sanitizeGroupWsl({ bindingId: UUID, distroName: '--terminate\nUbuntu' })
    ).toBeUndefined()
  })
  it('refuses null/undefined/array/primitives', () => {
    expect(sanitizeGroupWsl(null)).toBeUndefined()
    expect(sanitizeGroupWsl(undefined)).toBeUndefined()
    expect(sanitizeGroupWsl('Ubuntu')).toBeUndefined()
    expect(sanitizeGroupWsl(42)).toBeUndefined()
  })
  it('ignores extra unknown fields rather than adopting them', () => {
    const out = sanitizeGroupWsl({
      bindingId: UUID,
      distroName: 'Ubuntu',
      createdByApp: true, // a hostile file trying to smuggle a trusted-looking ownership flag
      ownedByApp: true
    })
    expect(out).toEqual({ bindingId: UUID, distroName: 'Ubuntu' })
    expect(out).not.toHaveProperty('createdByApp')
    expect(out).not.toHaveProperty('ownedByApp')
  })
})

describe('revalidateWslBinding — must be checked against a fresh real enumeration', () => {
  const binding: GroupWsl = { bindingId: UUID, distroName: 'Ubuntu' }

  it('keeps a binding whose distro is currently enumerated', () => {
    expect(revalidateWslBinding(binding, new Set(['Ubuntu', 'Debian']))).toEqual(binding)
  })
  it('drops a binding whose distro no longer exists on this machine', () => {
    expect(revalidateWslBinding(binding, new Set(['Debian']))).toBeUndefined()
  })
  it('drops a binding when nothing is enumerated at all', () => {
    expect(revalidateWslBinding(binding, new Set())).toBeUndefined()
  })
  it('drops undefined', () => {
    expect(revalidateWslBinding(undefined, new Set(['Ubuntu']))).toBeUndefined()
  })
})

describe('canManageWslDistro — the fail-closed gate behind sleep/wake/delete', () => {
  const binding: GroupWsl = { bindingId: UUID, distroName: 'Ubuntu' }
  const enumerated = new Set(['Ubuntu', 'docker-desktop'])

  it('allows only when enumerated AND the durable ownership record says owned', () => {
    expect(canManageWslDistro(binding, enumerated, (name) => name === 'Ubuntu')).toBe(true)
  })

  it('refuses a real, pre-existing user distribution the app did not create — the exact case a', () => {
    // real machine has (docker-desktop / ding-pbx-console / ding-pbx-test): the app must never be
    // able to sleep/wake/delete it just because a bound frame names it.
    const foreign: GroupWsl = { bindingId: UUID, distroName: 'docker-desktop' }
    expect(canManageWslDistro(foreign, enumerated, () => false)).toBe(false)
  })

  it('refuses when the distro is not currently enumerated, even if "owned" claims true', () => {
    const gone: GroupWsl = { bindingId: UUID, distroName: 'Deleted-Distro' }
    expect(canManageWslDistro(gone, enumerated, () => true)).toBe(false)
  })

  it('refuses when no binding exists', () => {
    expect(canManageWslDistro(undefined, enumerated, () => true)).toBe(false)
  })

  it('never trusts a distro name merely because it looks app-managed by prefix', () => {
    // CLAUDE.md: never infer ownership from a name. A "nodeterm-" prefixed distro is still
    // refused unless the durable lookup itself says so.
    const lookalike: GroupWsl = { bindingId: UUID, distroName: 'nodeterm-project' }
    expect(canManageWslDistro(lookalike, new Set(['nodeterm-project']), () => false)).toBe(false)
  })
})
