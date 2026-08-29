import { describe, expect, it } from 'vitest'
import { validateWslCreateForm, validateWslName, type WslCreateFormState } from './wslCreateForm'

const base: WslCreateFormState = {
  catalogueId: 'ubuntu-24.04',
  name: 'my-project',
  existingNames: new Set(['docker-desktop']),
  catalogueLoading: false,
  catalogueError: null,
  busy: false
}

describe('validateWslName', () => {
  it('accepts an ordinary name', () => {
    expect(validateWslName('my-project', new Set())).toBeNull()
  })
  it('refuses empty', () => {
    expect(validateWslName('', new Set())).toMatch(/required/i)
  })
  it('refuses a name colliding with an existing distro', () => {
    expect(validateWslName('docker-desktop', new Set(['docker-desktop']))).toMatch(/already exists/i)
  })
  it('refuses a name that would smuggle a flag', () => {
    expect(validateWslName('--unregister', new Set())).not.toBeNull()
  })
})

describe('validateWslCreateForm', () => {
  it('is valid once a distro is chosen and the name is clean', () => {
    expect(validateWslCreateForm(base)).toEqual({ valid: true, disabledReason: null, nameError: null })
  })

  it('names the exact unmet condition: no distro chosen', () => {
    const v = validateWslCreateForm({ ...base, catalogueId: null })
    expect(v.valid).toBe(false)
    expect(v.disabledReason).toMatch(/choose a distribution/i)
  })

  it('names the exact unmet condition: busy', () => {
    const v = validateWslCreateForm({ ...base, busy: true })
    expect(v.valid).toBe(false)
    expect(v.disabledReason).toMatch(/creating/i)
  })

  it('names the exact unmet condition: catalogue still loading', () => {
    const v = validateWslCreateForm({ ...base, catalogueLoading: true })
    expect(v.valid).toBe(false)
    expect(v.disabledReason).toMatch(/loading/i)
  })

  it('refuses a colliding name even with a valid distro chosen', () => {
    const v = validateWslCreateForm({ ...base, name: 'docker-desktop' })
    expect(v.valid).toBe(false)
    expect(v.disabledReason).toMatch(/already exists/i)
  })

  it('does not show a name error on an untouched (empty) field', () => {
    const v = validateWslCreateForm({ ...base, name: '' })
    expect(v.nameError).toBeNull()
    expect(v.valid).toBe(false)
  })

  it('shows a name error once the user has typed something invalid', () => {
    const v = validateWslCreateForm({ ...base, name: 'docker-desktop' })
    expect(v.nameError).toMatch(/already exists/i)
  })
})
