// @vitest-environment jsdom
/**
 * The authenticator node: this machine's TOTP generators on the canvas.
 *
 * A unit test with an injected host proves the component and nothing about the wiring underneath
 * it, so the wiring was proved separately by driving the BUILT app (pane menu -> Canvas objects ->
 * New authenticator, which rendered one row with a live code and a ticking countdown). What is
 * pinned here is the behaviour that is easy to break later and invisible when it breaks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import AuthenticatorNode from './AuthenticatorNode'

const list = vi.fn()
const codes = vi.fn()
const writeText = vi.fn()
const status = vi.fn()
const listCredentials = vi.fn()
const credentialCode = vi.fn()

let host: HTMLDivElement
let root: Root

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({ deleteElements: vi.fn(), updateNodeData: vi.fn() })
}))

vi.mock('../state/projects', () => ({
  useProjects: (selector: (s: { activeProjectId: string }) => unknown) => selector({ activeProjectId: 'p1' })
}))

vi.mock('../components/EditableNodeTitle', () => ({
  EditableNodeTitle: ({ emptyLabel }: { emptyLabel?: string }) => <span>{emptyLabel}</span>
}))

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'e1',
  issuer: 'GitHub',
  account: 'me@example.com',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  createdAt: 0,
  updatedAt: 0,
  revision: 'r1',
  ...over
})

function render(): void {
  act(() => {
    root.render(
      // The node reads only `id`, `data.title`, `data.color` and `selected`; the rest of NodeProps
      // is React Flow's own plumbing and is not what this test is about.
      <AuthenticatorNode
        {...({
          id: 'authenticator-1',
          data: { title: '', color: '#0a84ff' },
          selected: false
        } as unknown as Parameters<typeof AuthenticatorNode>[0])}
      />
    )
  })
}

/** Let the node's awaited list/codes calls settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  list.mockReset().mockResolvedValue([entry()])
  codes.mockReset().mockResolvedValue({ e1: { code: '123456', next: '654321', periodStart: 0, period: 30, digits: 6 } })
  writeText.mockReset().mockResolvedValue(true)
  status.mockReset().mockResolvedValue({ state: { kind: 'uninitialized' }, managers: [] })
  listCredentials.mockReset().mockResolvedValue({ ok: true, credentials: [] })
  credentialCode.mockReset().mockResolvedValue({ ok: false, error: 'no-totp' })
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    authenticator: { list, codes },
    passwordManager: { status, listCredentials, credentialCode },
    clipboard: { writeText }
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('AuthenticatorNode', () => {
  it('shows each generator with its live code', async () => {
    render()
    await settle()
    expect(document.querySelectorAll('.authenticator-node__row')).toHaveLength(1)
    expect(document.querySelector('.authenticator-node__issuer')?.textContent).toBe('GitHub')
    expect(document.querySelector('.authenticator-node__account')?.textContent).toBe('me@example.com')
    expect(document.querySelector('.authenticator-node__code')?.textContent).toBe('123456')
  })

  it('asks for every code in ONE call, never one request per row', async () => {
    list.mockResolvedValue([entry(), entry({ id: 'e2', issuer: 'AWS' })])
    codes.mockResolvedValue({
      e1: { code: '111111', next: 'x', periodStart: 0, period: 30, digits: 6 },
      e2: { code: '222222', next: 'y', periodStart: 0, period: 30, digits: 6 }
    })
    render()
    await settle()
    expect(codes).toHaveBeenCalledTimes(1)
    expect(codes).toHaveBeenCalledWith(['e1', 'e2'])
  })

  it('says the store could not be read, rather than showing an empty list', async () => {
    // The distinction the whole error path exists for: "you have no generators" is a different and
    // much worse thing to tell somebody who has several.
    list.mockRejectedValue(new Error('vault locked'))
    render()
    await settle()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not read')
    expect(document.querySelectorAll('.authenticator-node__row')).toHaveLength(0)
  })

  it('shows an honest empty state when there really are none', async () => {
    list.mockResolvedValue([])
    render()
    await settle()
    expect(document.querySelector('.authenticator-node__empty')?.textContent).toContain('No generators yet')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('keeps the last codes on screen when a refresh fails', async () => {
    render()
    await settle()
    expect(document.querySelector('.authenticator-node__code')?.textContent).toBe('123456')
    // A transient failure is not evidence the entries are gone, and a blank row invites a
    // pointless retry.
    codes.mockRejectedValue(new Error('transient'))
    await settle()
    expect(document.querySelector('.authenticator-node__code')?.textContent).toBe('123456')
  })

  it('claims a copy only when the clipboard acknowledged it', async () => {
    render()
    await settle()
    const button = document.querySelector<HTMLButtonElement>('.authenticator-node__code')!
    act(() => button.click())
    await settle()
    expect(writeText).toHaveBeenCalledWith('123456')
    expect(button.textContent).toBe('Copied')
  })

  it('does not claim a copy the clipboard refused', async () => {
    // A green tick over a failed copy is how somebody pastes the wrong thing into a login form.
    writeText.mockResolvedValue(false)
    render()
    await settle()
    const button = document.querySelector<HTMLButtonElement>('.authenticator-node__code')!
    act(() => button.click())
    await settle()
    expect(button.textContent).toBe('123456')
  })

  it('offers no copy while a code has not arrived', async () => {
    codes.mockResolvedValue({})
    render()
    await settle()
    const button = document.querySelector<HTMLButtonElement>('.authenticator-node__code')!
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('••••••')
  })

  it('shows a password-manager credential that carries a TOTP secret', async () => {
    // The reported defect: the generators somebody added lived in the project vault, and a node
    // that read only the authenticator store told them they had none.
    list.mockResolvedValue([])
    status.mockResolvedValue({ state: { kind: 'unlocked' }, managers: [{ id: 'm1', name: 'Work' }] })
    listCredentials.mockResolvedValue({ ok: true, credentials: [{ id: 'c1', label: 'Bank', createdAt: 0, updatedAt: 0 }] })
    credentialCode.mockResolvedValue({
      ok: true,
      code: { code: '424242', next: 'z', periodStart: Math.floor(Date.now() / 1000), period: 30, digits: 6 }
    })
    render()
    await settle()
    expect(document.querySelector('.authenticator-node__issuer')?.textContent).toBe('Bank')
    expect(document.querySelector('.authenticator-node__account')?.textContent).toBe('Work')
    expect(document.querySelector('.authenticator-node__code')?.textContent).toBe('424242')
  })

  it('omits a credential with no TOTP secret rather than showing a blank row', async () => {
    list.mockResolvedValue([])
    status.mockResolvedValue({ state: { kind: 'unlocked' }, managers: [{ id: 'm1', name: 'Work' }] })
    listCredentials.mockResolvedValue({ ok: true, credentials: [{ id: 'c1', label: 'Bank', createdAt: 0, updatedAt: 0 }] })
    credentialCode.mockResolvedValue({ ok: false, error: 'no-totp' })
    render()
    await settle()
    expect(document.querySelectorAll('.authenticator-node__row')).toHaveLength(0)
  })

  it('says a locked vault is locked, never that there are no codes', async () => {
    // A locked door and an empty room are different, and only one of them is worth acting on.
    list.mockResolvedValue([])
    status.mockResolvedValue({ state: { kind: 'locked' }, managers: [] })
    render()
    await settle()
    expect(document.querySelector('.authenticator-node__empty')?.textContent).toContain('locked')
  })

  it('states the seconds as text, not only as a bar', async () => {
    // A bar alone is length and colour: unreadable to somebody who cannot see it, and ambiguous to
    // everybody else at a glance.
    render()
    await settle()
    const countdown = document.querySelector('.authenticator-node__countdown')
    expect(countdown?.getAttribute('aria-label')).toMatch(/New code in \d+ seconds/)
    expect(document.querySelector('.authenticator-node__countdown-text')?.textContent).toMatch(/^\d+s$/)
  })
})
