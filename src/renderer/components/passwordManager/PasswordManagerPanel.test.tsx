// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultStatus } from '@shared/password-manager'
import type { NodeTerminalApi, PasswordManagerApi, Project } from '@shared/types'
import { createSession, resetSessionsForTest } from '../../session/session'
import { useProjects } from '../../state/projects'
import { useDestructiveGate } from '../../state/destructiveGate'
import { PasswordManagerPanel } from './PasswordManagerPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function project(id: string): Project {
  return {
    id,
    name: id,
    color: '#fff',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: []
  }
}

function passwordManagerApi(over: Partial<PasswordManagerApi> = {}): PasswordManagerApi {
  return {
    status: vi.fn(async () => ({ state: { kind: 'uninitialized' }, managers: [] }) as VaultStatus),
    createVault: vi.fn(async () => ({ ok: true }) as const),
    unlock: vi.fn(async () => ({ ok: true }) as const),
    lock: vi.fn(async () => {}),
    changePassword: vi.fn(async () => ({ ok: true }) as const),
    createManager: vi.fn(async () => ({ ok: false as const, error: 'not implemented in this fake' })),
    renameManager: vi.fn(async () => ({ ok: true }) as const),
    bindManagerGroup: vi.fn(async () => ({ ok: true }) as const),
    releaseGroupBinding: vi.fn(async () => ({ releasedManagerIds: [] })),
    deleteManager: vi.fn(async () => ({ ok: true }) as const),
    createCredential: vi.fn(async () => ({ ok: false, error: 'not-found' }) as const),
    renameCredential: vi.fn(async () => ({ ok: true }) as const),
    updateCredentialSecret: vi.fn(async () => ({ ok: true }) as const),
    removeCredential: vi.fn(async () => ({ ok: true }) as const),
    revealCredential: vi.fn(async () => ({ ok: false, error: 'not-found' }) as const),
    credentialCode: vi.fn(async () => ({ ok: false, error: 'no-totp' }) as const),
    ...over
  }
}

function apiWith(passwordManager: PasswordManagerApi): NodeTerminalApi {
  return { passwordManager } as unknown as NodeTerminalApi
}

let root: Root
let host: HTMLDivElement

async function mount(intent: 'default' | 'new-credential' = 'default'): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<PasswordManagerPanel onClose={() => {}} groups={[{ id: 'g1', title: 'Work' }]} initialIntent={intent} />)
    await Promise.resolve()
    await Promise.resolve()
  })
}

function setActiveLocalSession(api: NodeTerminalApi, projectId: string): void {
  createSession('local', api, 'This machine')
  useProjects.setState({ projects: [project(projectId)], activeProjectId: projectId })
}

beforeEach(() => {
  resetSessionsForTest()
  useDestructiveGate.setState({ request: null })
})

afterEach(async () => {
  useDestructiveGate.getState().close()
  if (root) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** React tracks an <input>'s value internally (_valueTracker) so it can tell a genuine user
 *  edit from a re-render setting the same DOM value; assigning `.value` directly bypasses that
 *  tracker, so a subsequent native "input" event reads back the value React THINKS is already
 *  current and never fires onChange. Set through the native property setter instead, exactly
 *  like ColorMenu.test.tsx's `dragHue` does for the same reason. */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(text: string | RegExp): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')
  )
  if (!found) throw new Error(`no button matching ${text}`)
  return found
}

describe('PasswordManagerPanel lock-state rendering', () => {
  it('shows the create-vault form for an uninitialized project', async () => {
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({ state: { kind: 'uninitialized' }, managers: [] }) as VaultStatus)
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    expect(document.body.textContent).toMatch(/Set a project password/i)
    expect(document.body.textContent).not.toMatch(/Password managers/)
  })

  it('shows the unlock form for a locked project, never the manager list', async () => {
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({ state: { kind: 'locked' }, managers: [] }) as VaultStatus)
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    expect(document.body.textContent).toMatch(/^.*Locked.*/s)
    expect(document.body.textContent).toContain("Enter this project's password to unlock")
    expect(document.body.textContent).not.toMatch(/Password managers/)
  })

  it('shows the manager list for an unlocked project', async () => {
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({
        state: { kind: 'unlocked' },
        managers: [{ id: 'm1', name: 'Personal', createdAt: 1, updatedAt: 1, credentialCount: 2 }]
      }) as VaultStatus)
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    expect(document.body.textContent).toContain('Password managers')
    expect(document.body.textContent).toContain('Personal')
    expect(document.body.textContent).toContain('2 credentials')
  })
})

describe('PasswordManagerPanel unlock failure', () => {
  it('reports a wrong password and a refused-but-unspecified failure identically, never distinguishing them', async () => {
    // core/password-manager/vault.ts deliberately conflates "wrong password" with "this vault
    // file could not be verified" (a tampered ciphertext fails the SAME authentication check) --
    // an attacker who can edit vault.json must not learn WHICH refusal happened. This asserts the
    // renderer honours that: it must render the identical sentence for both `res.error` values,
    // never branching on the wire error to say something more specific.
    let call = 0
    const unlock = vi.fn(async () => (call++ === 0 ? { ok: false, error: 'wrong-password' as const } : { ok: false, error: 'unsupported' as const }))
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({ state: { kind: 'locked' }, managers: [] }) as VaultStatus),
      unlock
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    const input = document.body.querySelector<HTMLInputElement>('input[type="password"]')!
    await act(async () => {
      setInputValue(input, 'nope')
    })
    await act(async () => {
      button('Unlock').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const firstMessage = document.body.querySelector('[role="alert"]')?.textContent

    await act(async () => {
      button('Unlock').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const secondMessage = document.body.querySelector('[role="alert"]')?.textContent

    expect(unlock).toHaveBeenCalledTimes(2)
    expect(firstMessage).toBeTruthy()
    expect(firstMessage).toBe(secondMessage)
    expect(firstMessage).toMatch(/wrong password.*could not be verified/i)
  })
})

describe('PasswordManagerPanel reveal gate', () => {
  it('never calls revealCredential until the Reveal button is explicitly clicked, and shows the plaintext only after', async () => {
    const created = { id: 'c1', label: 'GitHub', createdAt: 1, updatedAt: 1 }
    const revealCredential = vi.fn(async () => ({ ok: true, username: 'alice', password: 'hunter2' }) as const)
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({
        state: { kind: 'unlocked' },
        managers: [{ id: 'm1', name: 'Personal', createdAt: 1, updatedAt: 1, credentialCount: 0 }]
      }) as VaultStatus),
      createCredential: vi.fn(async () => ({ ok: true, credential: created }) as const),
      credentialCode: vi.fn(async () => ({ ok: false, error: 'no-totp' }) as const),
      revealCredential
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    // Expand the manager and create one credential so a CredentialRow (and its Reveal button)
    // actually exists to click.
    await act(async () => {
      button(/Personal/).click()
      await Promise.resolve()
    })
    await act(async () => {
      button('+ Add credential').click()
      await Promise.resolve()
    })
    const labelInput = document.body.querySelector<HTMLInputElement>('input[aria-label="New credential label"]')!
    await act(async () => {
      setInputValue(labelInput, 'GitHub')
    })
    await act(async () => {
      button('Add credential').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('GitHub')
    expect(revealCredential).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('hunter2')

    await act(async () => {
      button('Reveal').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(revealCredential).toHaveBeenCalledTimes(1)
    expect(revealCredential).toHaveBeenCalledWith('p1', 'm1', 'c1')
    expect(document.body.textContent).toContain('alice · hunter2')
  })
})

describe('PasswordManagerPanel TOTP countdown', () => {
  it('renders the code plus a literal text countdown -- never colour/motion alone -- and a live region for the rollover', async () => {
    const created = { id: 'c1', label: 'GitHub', createdAt: 1, updatedAt: 1 }
    const periodStart = Math.floor(Date.now() / 1000)
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({
        state: { kind: 'unlocked' },
        managers: [{ id: 'm1', name: 'Personal', createdAt: 1, updatedAt: 1, credentialCount: 0 }]
      }) as VaultStatus),
      createCredential: vi.fn(async () => ({ ok: true, credential: created }) as const),
      credentialCode: vi.fn(async () => ({
        ok: true as const,
        code: { code: '123456', next: '654321', periodStart, period: 30, digits: 6 }
      }))
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    await act(async () => {
      button(/Personal/).click()
      await Promise.resolve()
    })
    await act(async () => {
      button('+ Add credential').click()
      await Promise.resolve()
    })
    const labelInput = document.body.querySelector<HTMLInputElement>('input[aria-label="New credential label"]')!
    await act(async () => {
      setInputValue(labelInput, 'GitHub')
    })
    await act(async () => {
      button('Add credential').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    // The digits are grouped and rendered as real text.
    expect(document.body.querySelector('.pwm-code__digits')?.textContent).toBe('123 456')
    // The countdown has a plain-text equivalent beside the ring -- not just the ring's
    // conic-gradient angle, which a colour-blind or non-visual reader cannot perceive at all.
    const hint = document.body.querySelector('.pwm-code .pwm-hint')?.textContent ?? ''
    expect(hint).toMatch(/^\d+s · next 654 321$/)
    // And an assertive live region carries the same fact for a screen reader, independent of
    // the visible hint text (aria-live="off" — deliberately not "polite": a per-second-changing
    // number must not be announced every second, only actually queried by the reader).
    const live = document.body.querySelector('.sr-only[aria-live="off"]')?.textContent ?? ''
    expect(live).toMatch(/^New code in \d+ seconds$/)
  })

  it('reports "No TOTP" for a credential with no second factor, from the credentialCode no-totp refusal', async () => {
    const created = { id: 'c1', label: 'GitHub', createdAt: 1, updatedAt: 1 }
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({
        state: { kind: 'unlocked' },
        managers: [{ id: 'm1', name: 'Personal', createdAt: 1, updatedAt: 1, credentialCount: 0 }]
      }) as VaultStatus),
      createCredential: vi.fn(async () => ({ ok: true, credential: created }) as const),
      credentialCode: vi.fn(async () => ({ ok: false, error: 'no-totp' }) as const)
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    await act(async () => {
      button(/Personal/).click()
      await Promise.resolve()
    })
    await act(async () => {
      button('+ Add credential').click()
      await Promise.resolve()
    })
    const labelInput = document.body.querySelector<HTMLInputElement>('input[aria-label="New credential label"]')!
    await act(async () => {
      setInputValue(labelInput, 'GitHub')
    })
    await act(async () => {
      button('Add credential').click()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(document.body.querySelector('.pwm-credential-row__code')?.textContent).toBe('No TOTP')
  })
})

describe('PasswordManagerPanel destructive gate', () => {
  it('routes manager deletion through the two-key destructive gate, and does nothing before confirmation', async () => {
    const deleteManager = vi.fn(async () => ({ ok: true }) as const)
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({
        state: { kind: 'unlocked' },
        managers: [{ id: 'm1', name: 'Personal', createdAt: 1, updatedAt: 1, credentialCount: 3 }]
      }) as VaultStatus),
      deleteManager
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    act(() => {
      // Two "Delete" buttons can exist (manager + any credential row); the manager card only
      // has one at this point since no credential row has been created.
      button('Delete').click()
    })

    const request = useDestructiveGate.getState().request
    expect(request).toBeTruthy()
    expect(request?.title).toMatch(/Delete manager "Personal"/)
    expect(request?.description).toMatch(/3 credentials/)
    expect(deleteManager).not.toHaveBeenCalled()

    await act(async () => {
      request?.onConfirm()
      await Promise.resolve()
    })
    expect(deleteManager).toHaveBeenCalledWith('p1', 'm1')
  })

  it('routes credential removal through the two-key destructive gate, and does nothing before confirmation', async () => {
    const created = { id: 'c1', label: 'GitHub', createdAt: 1, updatedAt: 1 }
    const removeCredential = vi.fn(async () => ({ ok: true }) as const)
    const pwm = passwordManagerApi({
      status: vi.fn(async () => ({
        state: { kind: 'unlocked' },
        managers: [{ id: 'm1', name: 'Personal', createdAt: 1, updatedAt: 1, credentialCount: 0 }]
      }) as VaultStatus),
      createCredential: vi.fn(async () => ({ ok: true, credential: created }) as const),
      credentialCode: vi.fn(async () => ({ ok: false, error: 'no-totp' }) as const),
      removeCredential
    })
    setActiveLocalSession(apiWith(pwm), 'p1')
    await mount()

    await act(async () => {
      button(/Personal/).click()
      await Promise.resolve()
    })
    await act(async () => {
      button('+ Add credential').click()
      await Promise.resolve()
    })
    const labelInput = document.body.querySelector<HTMLInputElement>('input[aria-label="New credential label"]')!
    await act(async () => {
      setInputValue(labelInput, 'GitHub')
    })
    await act(async () => {
      button('Add credential').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    // Now two "Delete" buttons exist: the manager's and the credential row's. The credential
    // row's is the last one in document order.
    const deletes = [...document.body.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent?.trim() === 'Delete'
    )
    expect(deletes.length).toBe(2)
    act(() => deletes[deletes.length - 1].click())

    const request = useDestructiveGate.getState().request
    expect(request).toBeTruthy()
    expect(request?.title).toMatch(/Delete "GitHub"/)
    expect(removeCredential).not.toHaveBeenCalled()

    await act(async () => {
      request?.onConfirm()
      await Promise.resolve()
    })
    expect(removeCredential).toHaveBeenCalledWith('p1', { managerId: 'm1', credentialId: 'c1' })
  })
})

describe('PasswordManagerPanel session routing', () => {
  it('resolves the ACTIVE session api by project id, never the window-global decoy', async () => {
    const localStatus = vi.fn(async () => ({ state: { kind: 'uninitialized' }, managers: [] }) as VaultStatus)
    const localPwm = passwordManagerApi({ status: localStatus })
    const decoyStatus = vi.fn(async () => ({ state: { kind: 'unlocked' }, managers: [] }) as VaultStatus)
    const decoyPwm = passwordManagerApi({ status: decoyStatus })

    Object.defineProperty(window, 'nodeTerminal', {
      configurable: true,
      value: apiWith(decoyPwm)
    })

    setActiveLocalSession(apiWith(localPwm), 'p1')
    await mount()

    expect(localStatus).toHaveBeenCalledWith('p1')
    expect(decoyStatus).not.toHaveBeenCalled()
    expect(document.body.textContent).toMatch(/Set a project password/i)
  })
})
