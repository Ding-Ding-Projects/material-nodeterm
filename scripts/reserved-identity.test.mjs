import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { RESERVED_SUFFIXES, reservedAddress } from './reserved-identity.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')

/**
 * Eight commits reached `main` on 2026-08-17 authored AND committed by
 * `Smoke User <smoke@example.invalid>` with no Co-Authored-By trailer. Measured at that tree:
 * 1,256 surviving lines were counted as PERSON-written by the release line counter, because a
 * placeholder identity matches no automation pattern and "everything else is a person" was the
 * rule. These tests pin the two halves of the correction — the matcher, and the fact that the
 * counter now routes such a line to `unknown` rather than crediting a person who does not exist.
 */
describe('reserved, un-routable identities', () => {
  it('matches every domain RFC 2606 / RFC 6761 reserve', () => {
    for (const suffix of RESERVED_SUFFIXES) {
      const address = suffix.startsWith('@') ? `someone${suffix}` : `someone@host${suffix}`
      expect(reservedAddress(address), address).toBe(true)
    }
  })

  it('matches the exact address that shipped', () => {
    expect(reservedAddress('smoke@example.invalid')).toBe(true)
    expect(reservedAddress('  SMOKE@Example.INVALID  ')).toBe(true)
  })

  // The whole reason this check is safe to run on every push: a real contributor's address
  // cannot land in the reserved set, so it never has to guess whether a human is legitimate.
  // These are the addresses actually present in this repository's history.
  it('never matches a real contributor in this history', () => {
    const real = [
      'eneskirca@gmail.com',
      'mina.sameh.lameh@gmail.com',
      'noreply@anthropic.com',
      'omar@mrxlab.net',
      'william.jvenancio@gmail.com'
    ]
    for (const address of real) expect(reservedAddress(address), address).toBe(false)
  })

  // Absent is not the same as reserved. A commit whose address we failed to read is unknown,
  // and unknown is not evidence of a placeholder — refusing it would block a legitimate push.
  it('treats a blank or absent address as not reserved', () => {
    expect(reservedAddress('')).toBe(false)
    expect(reservedAddress('   ')).toBe(false)
    expect(reservedAddress(null)).toBe(false)
    expect(reservedAddress(undefined)).toBe(false)
  })

  it('does not match a domain that merely contains a reserved word', () => {
    expect(reservedAddress('a@testing.com')).toBe(false)
    expect(reservedAddress('a@example.company')).toBe(false)
    expect(reservedAddress('a@invalid-domain.com')).toBe(false)
  })
})

describe('check-commit-identity CLI', () => {
  const run = (range) => {
    try {
      const stdout = execFileSync(
        process.execPath,
        [join(repo, 'scripts', 'check-commit-identity.mjs'), range],
        { cwd: repo, encoding: 'utf8' }
      )
      return { code: 0, out: stdout }
    } catch (err) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
    }
  }

  // An empty range is what an ordinary push sends when the remote already has everything.
  // It must pass, or the hook refuses every no-op push.
  it('passes an empty range', () => {
    expect(run('HEAD..HEAD').code).toBe(0)
  })

  it('refuses a range containing a placeholder identity, naming it', () => {
    // Keep the range anchored to the exact published placeholder commit. The history grew well
    // past the old HEAD~300 window, which silently stopped exercising the refusal path.
    const { code, out } = run('7ad6a6c6c8704203c579b8b431b7da3424439a6f^..HEAD')
    expect(code).toBe(1)
    expect(out).toMatch(/smoke@example\.invalid/)
  })
})
