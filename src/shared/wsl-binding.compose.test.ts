/**
 * The two halves of the WSL feature, composed.
 *
 * They were built as separate lanes: `src/shared/wsl-binding.ts` decides whether the canvas may
 * OFFER a destructive action, and `src/core/wsl/` decides whether one may actually RUN. Each has
 * its own suite proving its own refusal, and neither says anything about the other. That gap is
 * the failure this codebase keeps rediscovering under its own name -- a feature wired at one end,
 * consumed at neither -- so the composition gets its own test rather than an assumption.
 *
 * The threat is concrete and is the one the user named: `.nodeterm/project.json` is git-shared,
 * so cloning a repository hands this machine a canvas somebody else authored. A frame in it can
 * claim to be bound to any distribution name at all, including one that really exists here and
 * belongs to the person rather than to the app.
 */
import { describe, it, expect } from 'vitest'
import { sanitizeGroupWsl, canManageWslDistro } from './wsl-binding'
import { inMemoryWslOwnershipStore } from '../core/wsl/ownership'
import { sleepWslDistribution } from '../core/wsl/lifecycle'
import { fakeWslRuntime, STATUS_OK } from '../core/wsl/__fixtures__'

/** Real distributions on the machine this was written on. Named literally, because a test that
 *  invents a placeholder name proves only that the placeholder is refused. */
const REAL_USER_DISTROS = ['docker-desktop', 'ding-pbx-console', 'ding-pbx-test']

/** A group frame exactly as it would arrive from a cloned repository's shared project file. */
function forgedFrame(distroName: string): unknown {
  return { bindingId: '6c1f4a4e-2b7c-4f3e-9a10-1d2b3c4d5e6f', distroName }
}

describe('a hostile shared canvas cannot reach a real distribution', () => {
  for (const distro of REAL_USER_DISTROS) {
    it(`refuses "${distro}" at both the canvas gate and the core action`, async () => {
      // The binding is perfectly well-formed. Shape validation is not a defence here and is not
      // meant to be -- a real name passes it, which is the whole point of the second check.
      const binding = sanitizeGroupWsl(forgedFrame(distro))
      expect(binding).toEqual({ bindingId: expect.any(String), distroName: distro })

      // Enumeration finds it, because it genuinely is on this machine.
      const enumerated = new Set(REAL_USER_DISTROS)
      const ownership = inMemoryWslOwnershipStore([]) // the app created nothing

      // Canvas gate: the affordance is never offered.
      expect(canManageWslDistro(binding, enumerated, () => false)).toBe(false)

      // Core gate: and even if it were offered -- a stale ownership snapshot in the renderer, a
      // future call site that forgets the gate, an IPC message forged past the UI entirely --
      // the action itself still refuses, and issues no argv at all.
      const runtime = fakeWslRuntime()
      const result = await sleepWslDistribution(runtime, ownership, distro)
      expect(result.ok).toBe(false)
      expect(result).toMatchObject({ reason: 'not-owned-by-app' })
      expect(runtime.calls).toEqual([])
    })
  }

  it('a distribution the app really created is manageable, so the refusal is not vacuous', async () => {
    const ours = 'nodeterm-my-project'
    const binding = sanitizeGroupWsl(forgedFrame(ours))
    const enumerated = new Set([...REAL_USER_DISTROS, ours])
    const ownership = inMemoryWslOwnershipStore([ours])

    expect(canManageWslDistro(binding, enumerated, (name) => name === ours)).toBe(true)

    const runtime = fakeWslRuntime({
      responses: {
        '--status': STATUS_OK,
        [`--terminate ${ours}`]: { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), exitCode: 0 }
      }
    })
    await expect(sleepWslDistribution(runtime, ownership, ours)).resolves.toEqual({ ok: true })
    expect(runtime.calls).toContainEqual(['--terminate', ours])
  })

  it('the canvas gate refuses a binding whose distribution is no longer registered', () => {
    const binding = sanitizeGroupWsl(forgedFrame('nodeterm-deleted-yesterday'))
    // Owned according to a ledger nobody pruned, but gone from the machine. Enumeration is what
    // makes the difference, which is why it is asked for fresh rather than cached.
    expect(canManageWslDistro(binding, new Set(REAL_USER_DISTROS), () => true)).toBe(false)
  })
})
