// @vitest-environment jsdom
/**
 * The protected-project-file prompt, and the one rule its whole safety rests on: clearing an
 * unlock-ladder rung ends the WAIT and never the password.
 *
 * Driven through react-dom/client + `act` (this repo's house style — there is no
 * @testing-library here) so the dialog is exercised as it actually renders, portal and all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ArchiveUnlockDialogHost, requestArchivePassword } from './archiveUnlockDialog'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

const issue = vi.fn()
const verify = vi.fn()

// The SESSION's transport, and separately the viewer's own global bridge. Two distinct spies,
// because a test with only one cannot prove which machine an action reached -- and this dialog is
// mounted at the app root, outside the project-keyed provider, which is exactly where that
// distinction is easiest to get wrong and impossible to see.
const globalIssue = vi.fn()
const globalVerify = vi.fn()

vi.mock('../session/session', () => ({
  activeSessionApi: () => ({
    workspace: { archiveLadderIssue: issue, archiveLadderVerify: verify }
  })
}))

let host: HTMLDivElement
let root: Root

function q<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector)
}

function must<T extends Element>(selector: string): T {
  const el = q<T>(selector)
  if (!el) throw new Error(`expected element for selector: ${selector}`)
  return el
}

function buttonNamed(text: RegExp | string): HTMLButtonElement | null {
  const match = (t: string): boolean => (typeof text === 'string' ? t === text : text.test(t))
  return (
    Array.from(document.querySelectorAll('button')).find((b) => match((b.textContent ?? '').trim())) ??
    null
  )
}

function click(el: Element): void {
  act(() => {
    ;(el as HTMLElement).click()
  })
}

function typeInto(el: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Let the dialog's own awaited transport calls settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
  issue.mockReset()
  verify.mockReset()
  globalIssue.mockReset()
  globalVerify.mockReset()
  // Deliberately wired to spies the dialog must never call.
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    workspace: { archiveLadderIssue: globalIssue, archiveLadderVerify: globalVerify }
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root.render(<ArchiveUnlockDialogHost />)
  })
})

afterEach(() => {
  // Every test: the viewer's own bridge was never the one that answered.
  expect(globalIssue).not.toHaveBeenCalled()
  expect(globalVerify).not.toHaveBeenCalled()
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ''
})

describe('the protected project file prompt', () => {
  it('maps authored copy and accessible names while preserving the requested path', async () => {
    usePersonalVocabulary.setState({
      entries: {
        'This project file is password-protected.': 'This archive needs a key.',
        Password: 'Passcode',
        Open: 'Unlock file'
      },
      status: 'loaded',
      entryCount: 3
    })
    void requestArchivePassword({ path: '/tmp/secret.nodeterm-project' })
    await settle()

    expect(must('.confirm__msg').textContent).toContain('This archive needs a key.')
    expect(must('.confirm__path').textContent).toBe('/tmp/secret.nodeterm-project')
    expect(must<HTMLInputElement>('.confirm__input').getAttribute('aria-label')).toBe('Passcode')
    expect(buttonNamed('Unlock file')).not.toBeNull()
    click(buttonNamed('Cancel')!)
  })

  it('restores shipped copy and accessible names while School mode is enabled', async () => {
    usePersonalVocabulary.setState({
      entries: { 'This project file is password-protected.': 'This archive needs a key.', Password: 'Passcode' },
      status: 'loaded',
      entryCount: 2
    })
    useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' })
    void requestArchivePassword({ path: '/tmp/school.nodeterm-project' })
    await settle()

    expect(must('.confirm__msg').textContent).toContain('This project file is password-protected.')
    expect(must('.confirm__path').textContent).toBe('/tmp/school.nodeterm-project')
    expect(must<HTMLInputElement>('.confirm__input').getAttribute('aria-label')).toBe('Password')
    click(buttonNamed('Cancel')!)
  })

  it('resolves with the typed password', async () => {
    const asked = requestArchivePassword({ path: '/tmp/secret.nodeterm-project' })
    await settle()
    typeInto(must<HTMLInputElement>('.confirm__input'), 'hunter2')
    click(buttonNamed('Open')!)
    await expect(asked).resolves.toBe('hunter2')
  })

  it('names the file, and shows the previous failure beside the field it came from', async () => {
    void requestArchivePassword({
      path: '/tmp/secret.nodeterm-project',
      error: 'That password did not open the file.'
    })
    await settle()
    expect(must('.confirm__path').textContent).toBe('/tmp/secret.nodeterm-project')
    expect(must('[role="alert"]').textContent).toContain('did not open the file')
  })

  it('maps the authored retry explanation while preserving the protected file path', async () => {
    usePersonalVocabulary.setState({
      entries: { 'That password did not open the file.': 'That passcode did not open the archive.' },
      status: 'loaded',
      entryCount: 1
    })
    void requestArchivePassword({
      path: '/tmp/exact-protected.nodeterm-project',
      error: 'That password did not open the file.'
    })
    await settle()

    expect(must('.confirm__path').textContent).toBe('/tmp/exact-protected.nodeterm-project')
    expect(must('[role="alert"]').textContent).toContain('That passcode did not open the archive.')
    expect(must('[role="alert"]').textContent).not.toContain('That password did not open the file.')
  })

  it('offers no password field, and nothing to submit, while a wait is running', async () => {
    void requestArchivePassword({ path: '/f', lockedMs: 60_000, ladderAvailable: true })
    await settle()
    expect(must('[role="alert"]').textContent).toContain('Too many wrong passwords')
    expect(q('.confirm__input')).toBeNull()
    expect(buttonNamed('Open')).toBeNull()
  })

  it('offers no ladder when core says none is available', async () => {
    void requestArchivePassword({ path: '/f', lockedMs: 60_000 })
    await settle()
    expect(buttonNamed(/play your way out/i)).toBeNull()
  })

  it('clears the WAIT and never the password when a rung is cleared', async () => {
    // If this ever resolves the request, the ladder has become a second, far weaker password.
    issue.mockResolvedValue({
      challenge: {
        kind: 'dimsum',
        nonce: 'n1',
        prompt: '蝦餃',
        choices: ['Har gow', 'Siu mai'],
        triesLeft: 5
      },
      budgetLeft: 3,
      waitMs: 60_000
    })
    verify.mockResolvedValue({
      cleared: true,
      next: null,
      message: 'Correct — that is the one. Unlocked.',
      challenge: null,
      budgetLeft: 2,
      waitMs: 0
    })

    let resolved: string | null | undefined
    void requestArchivePassword({ path: '/f', lockedMs: 60_000, ladderAvailable: true }).then((v) => {
      resolved = v
    })
    await settle()

    click(buttonNamed(/play your way out/i)!)
    await settle()
    click(buttonNamed('Har gow')!)
    await settle()

    // Back to the password field, and the caller is still waiting for a password.
    expect(q('.confirm__input')).not.toBeNull()
    expect(resolved).toBeUndefined()
    // And nothing in this flow ever asked core to open anything.
    expect(verify).toHaveBeenCalledWith({
      path: '/f',
      answer: { kind: 'dimsum', nonce: 'n1', choice: 'Har gow' }
    })
  })

  it('cancelling resolves null rather than leaving the caller hanging', async () => {
    const asked = requestArchivePassword({ path: '/f' })
    await settle()
    click(buttonNamed('Cancel')!)
    await expect(asked).resolves.toBeNull()
  })
})
