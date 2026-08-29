import { describe, expect, it } from 'vitest'
import { validateUpgradeReceipt } from './windows-installer-upgrade-receipt.mjs'

const baselineCommit = 'a'.repeat(40)
const upgradedCommit = 'b'.repeat(40)

function receipt() {
  return {
    schemaVersion: 1,
    status: 'verified',
    packageId: 'node-terminal',
    productName: 'nodeterm',
    baseline: { version: '0.4.152', sourceCommit: baselineCommit, installObserved: true, stableIdentityObserved: true },
    upgraded: { version: '1.0.0', sourceCommit: upgradedCommit, installObserved: true, stableIdentityObserved: true },
    lifecycle: {
      baselineClosed: true,
      upgradeLaunched: true,
      upgradeClosed: true,
      relaunchObserved: true,
      sessionReattached: true,
    },
    stateMigration: { observed: true, stableIdentity: true, settingsPreserved: true, sessionsReattached: true },
  }
}

describe('Windows installed-version upgrade receipt', () => {
  it('accepts the exact hosted 0.4.152 baseline and 1.0.0 upgrade lifecycle', () => {
    expect(validateUpgradeReceipt(receipt(), {
      baselineCommit,
      upgradedCommit,
      packageId: 'node-terminal',
      productName: 'nodeterm',
    })).toMatchObject({ baseline: { version: '0.4.152' }, upgraded: { version: '1.0.0' } })
  })

  it.each([
    ['baseline version', (value) => ({ ...value, baseline: { ...value.baseline, version: '0.4.153' } }), /baseline.version/],
    ['upgraded source', (value) => ({ ...value, upgraded: { ...value.upgraded, sourceCommit: baselineCommit } }), /different hosted commits/],
    ['close receipt', (value) => ({ ...value, lifecycle: { ...value.lifecycle, upgradeClosed: false } }), /lifecycle.upgradeClosed/],
    ['state migration', (value) => ({ ...value, stateMigration: { ...value.stateMigration, sessionsReattached: false } }), /sessionsReattached/],
  ])('rejects an incomplete %s', (_label, mutate, expected) => {
    expect(() => validateUpgradeReceipt(mutate(receipt()))).toThrow(expected)
  })
})
