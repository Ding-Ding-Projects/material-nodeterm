// Kids mode must route a destructive action through the two-key super gate rather than a
// one-button confirm.
//
// A source-level test, like `control-destructive.test.ts` beside it, and for the same reason:
// Canvas.tsx is ~9,500 lines with a very large mount surface, so rendering it to assert one
// callback's branch costs more than it proves. What matters here is that the branch EXISTS and
// reaches the real gate — the policy's own behaviour is covered in
// `src/shared/kids-mode-policy.test.ts`, and the wiring of the permission half in
// `state/permissionMode.kids.test.ts`.
//
// The needles are deliberately shaped so that deleting the wiring breaks them, rather than merely
// renaming something: a bare `requiresDestructiveGate` substring would survive being commented
// out, which is exactly how three guards in this repo turned out to be toothless.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(__dirname, 'Canvas.tsx'), 'utf8')

describe('kids mode reaches the destructive gate', () => {
  it('imports the policy from shared, not a local copy', () => {
    expect(SRC).toMatch(/import \{[^}]*requiresDestructiveGate[^}]*\} from '@shared\/kids-mode-policy'/)
  })

  it('reads the mode from the store rather than a prop or a stale local', () => {
    // The record is shared across windows and apps, so a surface holding its own copy would apply
    // the restriction in one window and not the next.
    expect(SRC).toMatch(/useKidsMode\.getState\(\)\.enabled/)
  })

  it('CALLS the gate check — not merely imports it', () => {
    // Line-anchored-ish: the call with its real argument, so commenting the line out fails this.
    expect(SRC).toMatch(/requiresDestructiveGate\(\s*'delete-node',\s*useKidsMode\.getState\(\)\.enabled\s*\)/)
  })

  it('routes a required gate to the real super-confirmation, not another plain confirm', () => {
    // `openDestructiveGate` is the two-key + slider gate. Reaching for `setConfirm` here instead
    // would look like it worked and would be the one-button dialog kids mode exists to replace.
    const branch = SRC.slice(SRC.indexOf('deleteNodeFromKanban'))
    const upToReturn = branch.slice(0, branch.indexOf('setConfirm({'))
    expect(upToReturn, 'the required-gate branch must open the super gate').toContain('openDestructiveGate({')
  })

  it('leaves the plain confirm in place for when the mode is off', () => {
    // Kids mode OFF must be byte-identical to before: silently tightening a confirmation for
    // every existing user is a product decision, not a wiring fix.
    const branch = SRC.slice(SRC.indexOf('deleteNodeFromKanban'))
    expect(branch).toContain('Its terminal session will end.')
  })
})

describe('kids mode hardens worktree removal', () => {
  // The most destructive thing reachable in one keystroke before this: for a worktree nodeterm
  // created, the dialog showed NO disk-deletion checkbox (deletion was implicit) and Enter could
  // confirm it. A security review found it while the docs claimed this path was already gated.
  it('consults the policy for remove-worktree', () => {
    expect(SRC).toMatch(/requiresDestructiveGate\(\s*'remove-worktree',\s*kidsModeOn\s*\)/)
  })

  it('reads the mode at RENDER, not when the dialog opened', () => {
    // The record is shared and another process can flip it. A dialog left open across that change
    // must honour the new state, so the flag comes from the store hook rather than a captured
    // value.
    expect(SRC).toMatch(/const kidsModeOn = useKidsMode\(\(s\) => s\.enabled\)/)
  })

  it('lets no keystroke confirm a removal while the mode is on', () => {
    expect(SRC).toMatch(/enterConfirms=\{!removeTarget\.requestedBy && !kidsGateRequired\}/)
  })

  it('always offers the disk-deletion choice, instead of deleting implicitly', () => {
    // `canDelete && !kidsGateRequired` — so under kids mode the checkbox appears even for a
    // worktree we created, and (per the existing state default) starts unticked.
    expect(SRC).toMatch(/removeTarget\.canDelete && !kidsGateRequired/)
  })
})
