// @vitest-environment jsdom
//
// ServiceNode is ONE component behind six canvas node kinds (minecraft, dockerhost, proxmox,
// gitlab, homeassistant, freepbx). Its own header comment states the rule these tests exist to
// hold it to: a control styled as operable while it does nothing is a DEFECT, not a placeholder
// (CLAUDE.md, "User interface quality"). So alongside the ordinary behavior (product names, the
// click-to-rename label, the address field that only ever stores what the storage boundary would
// also accept, and the accessibility wiring a screen reader actually depends on) this file spends
// a whole describe block proving nothing in the body LOOKS like it can dial the service yet,
// because nothing can.
//
// Rendered with react-dom/client + act(), matching every other node/component test in this repo
// (see DinoNode.test.tsx, ColumnPill.test.tsx, SshProjectDialog.test.tsx) — there is no
// @testing-library/react in this project, and controlled-input changes are driven through the
// native `value` setter + a real `input`/`focusout`/`keydown` DOM event, which is what makes
// React actually run the corresponding onChange/onBlur/onKeyDown handler rather than merely
// mutating the DOM out from under it.
import { useState, type ComponentProps } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceNode } from './ServiceNode'
import { useProjects } from '../state/projects'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ServiceNode renders NodeResizer unconditionally (it takes no DOM footprint here — jsdom has no
// layout — but React Flow's own useReactFlow() throws outside a <ReactFlowProvider>, which this
// harness deliberately has none of). Stubbed exactly like DinoNode.test.tsx's mock: NodeResizer
// becomes a no-op, and useReactFlow hands back updateNodeData/setNodes wired to the harness below
// instead of a real canvas store.
type Patch = Record<string, unknown>
type NodesUpdater = (nodes: Array<{ id: string; data: Patch }>) => Array<{ id: string; data: Patch }>

let applyPatch: ((patch: Patch) => void) | null = null
let applySetNodes: ((updater: NodesUpdater) => void) | null = null

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({
    updateNodeData: (_id: string, patch: Patch) => applyPatch?.(patch),
    setNodes: (updater: NodesUpdater) => applySetNodes?.(updater)
  })
}))

/** The node data ServiceNode actually reads. Everything not passed in defaults to the same "no
 *  connection, no name, ordinary blue" shape a freshly created node would have. */
const baseData = (overrides: Patch = {}): Patch => ({
  title: '',
  color: '#0a84ff',
  group: null,
  collapsed: false,
  serviceLabel: '',
  serviceConnection: undefined,
  ...overrides
})

/** Mirrors the harness's own live copy of node data, so a test can assert what was actually
 *  WRITTEN (via updateNodeData) rather than only what is on screen. Reset every test. */
let latestData: Patch | null = null

/** Renders the real ServiceNode behind a controlled `data` prop that tracks every
 *  `updateNodeData` call, the same way React Flow's own store would. Bare `useState` rather than
 *  a mock store — the point of these tests is the component's own commit/restore logic, and a
 *  fake store that "helpfully" reimplements part of that logic would just move the risk of a bug
 *  into the test fixture instead of catching it in the component. */
function Harness({ id, kind, data }: { id: string; kind: string; data: Patch }) {
  const [state, setState] = useState<Patch>(data)
  applyPatch = (patch) => setState((d) => ({ ...d, ...patch }))
  applySetNodes = (updater) =>
    setState((d) => {
      const [next] = updater([{ id, data: d }])
      return next?.data ?? d
    })
  latestData = state
  const props = { id, type: kind, data: state, selected: false } as unknown as ComponentProps<
    typeof ServiceNode
  >
  return <ServiceNode {...props} />
}

describe('ServiceNode', () => {
  let host: HTMLElement
  let root: Root

  beforeEach(() => {
    // ColumnPill — a sibling ServiceNode renders unconditionally above the node body — reads the
    // live canvas store to decide whether a kanban half-pill belongs on top of the node. Reset so
    // a project left behind by a leaked module instance can never make one appear here; see
    // ColumnPill.test.tsx for that pill exercised directly.
    useProjects.setState({ projects: [], activeProjectId: '' })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    applyPatch = null
    applySetNodes = null
    latestData = null
  })

  const render = (kind: string, data: Patch): HTMLElement => {
    act(() => {
      root.render(<Harness id="svc-1" kind={kind} data={data} />)
    })
    const node = host.querySelector('.service-node')
    if (!node) throw new Error('no service node rendered')
    return node as HTMLElement
  }

  const addressInput = (node: HTMLElement): HTMLInputElement => {
    const input = node.querySelector<HTMLInputElement>('.service-node__input')
    if (!input) throw new Error('no address input rendered')
    return input
  }

  /** Follows `aria-describedby` to the element it names, failing loudly if the pointer is stale —
   *  which is itself the accessibility defect one of the tests below exists to catch. */
  const describedNote = (node: HTMLElement, input: HTMLInputElement): HTMLElement => {
    const describedById = input.getAttribute('aria-describedby')
    expect(describedById, 'address input has no aria-describedby at all').toBeTruthy()
    const note = node.querySelector(`#${describedById}`)
    if (!note) throw new Error(`aria-describedby="${describedById}" points at nothing in the DOM`)
    return note as HTMLElement
  }

  const setValue = (input: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  /** React 18 maps the native, bubbling `focusout` event to the synthetic `onBlur` it hands
   *  components (registerSimpleEvent('focusout', 'onBlur') in react-dom) — dispatching it directly
   *  is what actually reaches ServiceNode's `onBlur={commitEndpoint}`, the same way a real click
   *  away from the field would. */
  const blur = (input: HTMLInputElement): void => {
    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }

  const keydown = (el: Element, key: string): void => {
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
  }

  // ---------------------------------------------------------------------------------------------
  // 1. Every kind renders its own product name.
  // ---------------------------------------------------------------------------------------------

  describe('product name per kind', () => {
    // Hand-written rather than imported from SERVICE_NODE_LABELS: if the test read the same table
    // the component reads, a typo or a swapped pair in that table would agree with itself and the
    // test would still pass while the header showed the wrong words for six different node kinds.
    const expected: Record<string, string> = {
      minecraft: 'Minecraft server',
      dockerhost: 'Docker host',
      proxmox: 'Proxmox',
      gitlab: 'GitLab',
      homeassistant: 'Home Assistant',
      freepbx: 'FreePBX'
    }

    for (const [kind, name] of Object.entries(expected)) {
      it(`shows "${name}" for kind "${kind}"`, () => {
        const node = render(kind, baseData())
        expect(node.querySelector('.service-node__product')?.textContent).toBe(name)
      })
    }
  })

  // ---------------------------------------------------------------------------------------------
  // 2. Label: plain button until clicked, then an input; Enter commits, Escape restores.
  // ---------------------------------------------------------------------------------------------

  describe('label editing', () => {
    it('is a plain rename button, not an input, before anything is clicked', () => {
      // If this rendered an input from the start, "click to rename" would be a lie — an
      // always-live input across the whole header strip is exactly the thing TerminalNode and
      // StickyNode already avoid, because it leaves nothing on the header the user can grab to
      // drag the node instead of typing into it.
      const node = render('proxmox', baseData({ serviceLabel: 'Rack 3' }))
      const button = node.querySelector('button.service-node__label-text')
      expect(button).not.toBeNull()
      expect(button?.textContent).toBe('Rack 3')
      expect(node.querySelector('input.term-node__title')).toBeNull()
    })

    it('shows an empty-state placeholder rather than a blank button when unnamed', () => {
      const node = render('proxmox', baseData({ serviceLabel: '' }))
      const button = node.querySelector('button.service-node__label-text')
      expect(button?.textContent).toContain('Name this proxmox')
    })

    it('becomes a focused input, seeded with the current name, on click', () => {
      const node = render('gitlab', baseData({ serviceLabel: 'Build box' }))
      act(() => node.querySelector<HTMLButtonElement>('button.service-node__label-text')?.click())
      const input = node.querySelector<HTMLInputElement>('input.term-node__title')
      expect(input).not.toBeNull()
      expect(input?.value).toBe('Build box')
      // Only one control at a time — the rename button must be gone while the input is up, or
      // there would be two conflicting ways to "start renaming" live at once.
      expect(node.querySelector('button.service-node__label-text')).toBeNull()
    })

    it('Enter commits the typed name and returns to the plain button', () => {
      const node = render('gitlab', baseData({ serviceLabel: 'Build box' }))
      act(() => node.querySelector<HTMLButtonElement>('button.service-node__label-text')?.click())
      const input = node.querySelector<HTMLInputElement>('input.term-node__title')!
      setValue(input, 'CI runner')
      keydown(input, 'Enter')
      expect(node.querySelector('input.term-node__title')).toBeNull()
      expect(node.querySelector('button.service-node__label-text')?.textContent).toBe('CI runner')
      expect(latestData?.serviceLabel).toBe('CI runner')
    })

    it('Escape restores the value editing started with, discarding what was typed', () => {
      // The specific defect this catches: reverting only the "am I editing" flag on Escape and
      // forgetting to also write the ORIGINAL name back would leave the half-typed text live in
      // node data even though the header goes back to showing the old name — a silent
      // display/data split that would only be caught by reading `serviceLabel` back, not by
      // looking at the screen.
      const node = render('gitlab', baseData({ serviceLabel: 'Build box' }))
      act(() => node.querySelector<HTMLButtonElement>('button.service-node__label-text')?.click())
      const input = node.querySelector<HTMLInputElement>('input.term-node__title')!
      setValue(input, 'Something else entirely')
      keydown(input, 'Escape')
      expect(node.querySelector('input.term-node__title')).toBeNull()
      expect(node.querySelector('button.service-node__label-text')?.textContent).toBe('Build box')
      expect(latestData?.serviceLabel).toBe('Build box')
    })
  })

  // ---------------------------------------------------------------------------------------------
  // 3. The address field: only ever stores what safeServiceEndpoint would also accept.
  // ---------------------------------------------------------------------------------------------

  describe('address field', () => {
    it('a valid https address commits on blur', () => {
      const node = render('gitlab', baseData())
      const input = addressInput(node)
      setValue(input, 'https://gitlab.example.com')
      blur(input)
      expect(latestData?.serviceConnection).toEqual({ endpoint: 'https://gitlab.example.com' })
    })

    it('an invalid address is refused: nothing is written to node data', () => {
      // This is the guard for "the SAME predicate the storage boundary uses" (the component's own
      // comment): if commitEndpoint ever accepted something safeServiceEndpoint refuses, the node
      // would render as configured and silently be unable to connect the moment anything actually
      // reads serviceConnection later.
      const node = render('gitlab', baseData())
      const input = addressInput(node)
      setValue(input, 'not an address')
      blur(input)
      expect(latestData?.serviceConnection).toBeUndefined()
    })

    it('refuses a URL carrying a password, and the note says a password belongs in the keychain', () => {
      // The password case is the one CLAUDE.md/the component's own comment calls out by name: a
      // refusal with no reason reads as a broken field, and sends the user looking for a WORSE
      // place to put the secret than the one field that would have refused it.
      const node = render('proxmox', baseData())
      const input = addressInput(node)
      setValue(input, 'https://admin:hunter2@proxmox.local:8006')
      blur(input)
      expect(latestData?.serviceConnection).toBeUndefined()
      const note = describedNote(node, input)
      expect(note.textContent).toMatch(/password/i)
      expect(note.textContent).toMatch(/keychain/i)
    })

    it('clearing a saved address removes the stored connection entirely', () => {
      const node = render(
        'freepbx',
        baseData({ serviceConnection: { endpoint: 'https://pbx.example.com' } })
      )
      const input = addressInput(node)
      // Fixture check: the field must actually have started populated, or clearing it and finding
      // no connection afterward would prove nothing.
      expect(input.value).toBe('https://pbx.example.com')
      setValue(input, '')
      blur(input)
      expect(latestData?.serviceConnection).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------------------------
  // 4. Accessibility.
  // ---------------------------------------------------------------------------------------------

  describe('accessibility', () => {
    it('exposes an accessible name naming both the product and the saved name', () => {
      const node = render('homeassistant', baseData({ serviceLabel: 'Living room hub' }))
      expect(node.getAttribute('role')).toBe('group')
      expect(node.getAttribute('aria-label')).toBe('Home Assistant: Living room hub')
    })

    it('still exposes a non-empty accessible name before anything is named', () => {
      // A blank aria-label would be worse than none: a screen-reader user would land on an
      // unlabelled "group" with no way to tell which of six near-identical service nodes on the
      // canvas they are on.
      const node = render('homeassistant', baseData({ serviceLabel: '' }))
      const label = node.getAttribute('aria-label')
      expect(label).toBeTruthy()
      expect(label).toBe('Home Assistant, no name set')
    })

    it('describes the address input with its own note element, and that element actually exists', () => {
      const node = render('minecraft', baseData())
      const input = addressInput(node)
      const note = describedNote(node, input)
      expect(note.tagName).toBe('P')
      expect(note.textContent).not.toBe('')
    })

    it('sets aria-invalid on an unparsable address and clears it once the address is valid', () => {
      const node = render('minecraft', baseData())
      const input = addressInput(node)
      setValue(input, 'nonsense')
      expect(input.getAttribute('aria-invalid')).toBe('true')
      setValue(input, 'ssh://docker@192.168.1.20')
      expect(input.getAttribute('aria-invalid')).toBe('false')
    })
  })

  // ---------------------------------------------------------------------------------------------
  // 5. Honesty: nothing here looks operable while doing nothing.
  // ---------------------------------------------------------------------------------------------

  describe('honesty: no control here pretends it can connect', () => {
    it('has no button whose visible text, title, or accessible name suggests it dials the service', () => {
      // Per the component's own header comment and CLAUDE.md's "decorative-looking UI must be
      // functional" rule: a "Connect" button here would be styled as operable while doing
      // nothing, which is a defect rather than a placeholder. This is the concrete guard against
      // someone adding exactly that button ahead of the wiring that would make it do anything.
      const node = render('dockerhost', baseData({ serviceLabel: 'Prod cluster' }))
      const buttons = [...node.querySelectorAll('button')]
      // Fixture check: this node really does have buttons to inspect (collapse, color, rename) —
      // an empty list would make the loop below vacuously pass without testing anything.
      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) {
        const spoken = [
          button.textContent ?? '',
          button.getAttribute('title') ?? '',
          button.getAttribute('aria-label') ?? ''
        ].join(' ')
        expect(spoken).not.toMatch(/connect/i)
      }
    })
  })
})
