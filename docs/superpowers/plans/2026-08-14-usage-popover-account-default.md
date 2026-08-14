# Usage Popover Account Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose the active project’s default Claude identity from its usage popover while existing sessions keep their original account.

**Architecture:** Keep the feature in the renderer. `UsageIndicator` will make existing Claude identity blocks selectable, write the active project’s existing `defaultAccountId` field through the project store, and notify Canvas through the established workspace-dirty seam. The usage service, preload bridge, shared types, non-Claude provider rows, and existing session nodes remain unchanged.

**Tech Stack:** React 18, TypeScript, Zustand, Vitest, jsdom, CSS

## Global Constraints

The choice affects new Claude sessions only.

System maps to an undefined `defaultAccountId`.

Managed local and SSH identities use their existing account IDs.

Provider rows remain read-only.

Desktop and Server Edition share the same implementation. Mobile is unchanged.

---

### Task 1: Select the active project default from Claude usage rows

**Files:**

- Create: `src/renderer/components/UsageIndicator.test.tsx`
- Modify: `src/renderer/components/UsageIndicator.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**

- Consumes: `useProjects.getState().setProjectDefaultAccount(projectId, accountId)` and `markWorkspaceDirty()`
- Produces: selectable local and remote Claude account blocks with `aria-pressed`, a check marker, and synchronous active-project default updates

- [ ] **Step 1: Write the local failing component tests**

Create a jsdom test harness that mounts the real component with a real `useProjects` store, a real `useSettings` store, a recording workspace-dirty callback, and a controlled `window.nodeTerminal.usage` API.

Use hand-built fixtures with one real limit so the pill and popover render.

```tsx
const LIMIT: UsageLimit = {
  kind: 'session',
  group: 'session',
  usedPercent: 25,
  severity: null,
  resetsAt: null,
  windowMinutes: 300,
  scopeLabel: null,
  isActive: true
}

const usage = (email: string): ClaudeUsage => ({
  limits: [LIMIT],
  session: null,
  weekly: null,
  email,
  updatedAt: 1,
  status: 'ok'
})
```

Mount a local project containing an existing Claude node with `accountId: 'old'`, plus one configured managed account `a1`. Open the popover and prove the current display-only code is missing all required behaviour.

```tsx
const rows = accountButtons()
expect(rows).toHaveLength(2)
expect(rows[0].getAttribute('aria-pressed')).toBe('true')

act(() => rows[1].click())

expect(useProjects.getState().getProject('p1')?.defaultAccountId).toBe('a1')
expect(useProjects.getState().getProject('p1')?.nodes).toEqual(originalNodes)
expect(markDirty).toHaveBeenCalledTimes(1)
expect(accountButtons()[1].getAttribute('aria-pressed')).toBe('true')
expect(accountButtons()[1].querySelector('.usage-account__default')?.textContent).toBe('✓')
```

Add a second local test that starts on `a1`, clicks the System row, and expects `defaultAccountId` to become undefined with one persistence signal.

- [ ] **Step 2: Run the local tests and verify RED**

Run:

```bash
npx vitest run src/renderer/components/UsageIndicator.test.tsx
```

Expected result is failure because `.usage-account` blocks are div elements, have no pressed state, and do not write project defaults.

- [ ] **Step 3: Add the SSH and provider failing tests**

Mount an SSH project for `enes@box`, set its connection state to available, configure managed remote account `remote1`, and return these controlled remote rows.

```tsx
const remote: RemoteAccountUsage[] = [
  { hostKey: 'enes@box', accountId: null, label: 'enes@box', usage: usage('system@box') },
  { hostKey: 'enes@box', accountId: 'remote1', label: 'Work', usage: usage('work@box') }
]
```

Open the popover, click Work, and expect `defaultAccountId` to become `remote1`. Click the host’s System row and expect it to clear. Assert each click schedules one persistence signal.

In the local fixture, also return an enabled Codex provider and assert the provider block is a div rather than a selectable button.

```tsx
expect([...host.querySelectorAll('.usage-account')]).toHaveLength(3)
expect(accountButtons()).toHaveLength(2)
expect(accountButtons().some((row) => row.textContent?.includes('Codex'))).toBe(false)
```

- [ ] **Step 4: Run all new tests and verify RED**

Run:

```bash
npx vitest run src/renderer/components/UsageIndicator.test.tsx
```

Expected result is failure on local and SSH row interaction while the provider assertion documents the read-only boundary.

- [ ] **Step 5: Implement the minimal renderer state transition**

Import the shared dirty seam.

```tsx
import { markWorkspaceDirty } from '../state/workspaceDirty'
```

Subscribe to the active default as one primitive and add the guarded selection handler.

```tsx
const defaultAccountId = useProjects((s) =>
  s.projects.find((p) => p.id === s.activeProjectId)?.defaultAccountId
)

const selectDefaultAccount = (accountId: string | undefined): void => {
  const projectId = useProjects.getState().activeProjectId
  if (!projectId) return
  useProjects.getState().setProjectDefaultAccount(projectId, accountId)
  markWorkspaceDirty()
}
```

Extend `AccountUsageBlock` with `accountId`, `selected`, and `onSelect` props. Change its root into this button while retaining the existing limit rows.

```tsx
<button
  type="button"
  className="usage-account usage-account--selectable"
  aria-pressed={selected}
  title={selected ? 'Default for new sessions' : 'Use for new sessions'}
  onClick={() => onSelect(accountId)}
>
  <div className="usage-account__label">
    <span>{label}</span>
    {selected && <span className="usage-account__default" aria-hidden>✓</span>}
  </div>
  {details}
</button>
```

Give `RemoteUsageBlock` the same props and map `row.accountId ?? undefined` before selection. Local System uses `accountId={undefined}`. Managed local accounts use `accountId={a.id}`. A row is selected when its normalized ID equals `defaultAccountId`.

- [ ] **Step 6: Add the minimal selectable-row styling**

Preserve the existing account spacing and typography while resetting button chrome and providing visible pointer and keyboard states.

```css
.usage-account--selectable {
  display: block;
  width: 100%;
  padding: 12px 0 0;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.usage-account--selectable:hover {
  background: rgba(var(--tint-rgb), 0.05);
}
.usage-account--selectable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.usage-account__label {
  display: flex;
  align-items: center;
}
.usage-account__default {
  margin-left: auto;
  color: var(--accent);
}
```

- [ ] **Step 7: Run the focused tests and verify GREEN**

Run:

```bash
npx vitest run src/renderer/components/UsageIndicator.test.tsx
```

Expected result is every new test passing with no React act warnings.

- [ ] **Step 8: Perform a mutation check**

Temporarily remove the `setProjectDefaultAccount` call and run the focused file. The local and SSH state assertions must fail. Restore the call and rerun the focused file to green.

- [ ] **Step 9: Run repository verification**

Run:

```bash
npm run typecheck
npm run build
npm test
git diff --check
git status --short
```

The full suite must run with local Unix-socket and loopback permission, as established by the clean baseline.

- [ ] **Step 10: Commit the implementation**

Stage only the component, its test, and styles.

```bash
git add src/renderer/components/UsageIndicator.tsx src/renderer/components/UsageIndicator.test.tsx src/renderer/styles.css
git commit -m "Add account selection to usage popover"
```
