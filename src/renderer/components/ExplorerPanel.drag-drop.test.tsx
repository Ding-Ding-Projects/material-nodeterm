// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsApi, NodeTerminalApi, Project } from '@shared/types'
import {
  SessionProvider,
  createSession,
  resetSessionsForTest,
  type WorkspaceSession
} from '../session/session'
import { useProjects } from '../state/projects'
import {
  AGENT_NODE_DRAG_MIME,
  EXPLORER_FOLDER_DRAG_MIME,
  readExplorerFolderDrag,
  writeAgentNodeDrag
} from '../lib/explorerNodeDrag'
import { ExplorerPanel } from './ExplorerPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn()
})

class TestDragData {
  effectAllowed = 'uninitialized'
  dropEffect = 'none'
  private readonly values = new Map<string, string>()

  get types(): string[] {
    return [...this.values.keys()]
  }

  getData(type: string): string {
    return this.values.get(type) ?? ''
  }

  setData(type: string, value: string): void {
    this.values.set(type, value)
  }
}

function dragEvent(type: string, transfer: TestDragData): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  return event
}

const project: Project = {
  id: 'project-one',
  name: 'Project one',
  color: '#fff',
  cwd: 'C:\\project',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: []
}

const fs = {
  list: vi.fn(async (path: string) =>
    path === project.cwd ? [{ name: 'src', dir: true, ignored: false }] : []
  )
} as unknown as FsApi

function api(): NodeTerminalApi {
  return { fs } as unknown as NodeTerminalApi
}

let root: Root
let host: HTMLDivElement
let session: WorkspaceSession

async function mount(props: {
  onAgentNodeDrop?: (drop: { nodeId: string; projectId: string; path: string }) => void
  onOpenTerminalAtFolder?: (folder: { projectId: string; path: string }) => void
  keyboardAgentNodeId?: string
} = {}): Promise<void> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <SessionProvider session={session}>
        <ExplorerPanel
          onClose={() => {}}
          onOpenFile={() => {}}
          onAgentNodeDrop={props.onAgentNodeDrop}
          onOpenTerminalAtFolder={props.onOpenTerminalAtFolder}
          keyboardAgentNodeId={props.keyboardAgentNodeId}
        />
      </SessionProvider>
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

function folderRow(): HTMLDivElement {
  return document.body.querySelector<HTMLDivElement>('.ex-row[title="src"]')!
}

function menuButton(label: string): HTMLButtonElement {
  return [...document.body.querySelectorAll<HTMLButtonElement>('.ctx-item')].find(
    (button) => button.textContent?.trim() === label
  )!
}

async function openKeyboardMenu(row: HTMLDivElement): Promise<void> {
  await act(async () => {
    row.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    )
  })
}

beforeEach(() => {
  resetSessionsForTest()
  session = createSession('local', api(), 'This machine')
  useProjects.setState({ projects: [project], activeProjectId: project.id })
})

afterEach(async () => {
  if (root) await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('Explorer folder drag and drop', () => {
  it('makes only folder rows draggable with the namespaced project/path payload', async () => {
    await mount()
    const row = folderRow()
    const transfer = new TestDragData()

    expect(row.draggable).toBe(true)
    expect(row.getAttribute('role')).toBe('treeitem')
    await act(async () => row.dispatchEvent(dragEvent('dragstart', transfer)))

    expect(transfer.types).toEqual([EXPLORER_FOLDER_DRAG_MIME])
    expect(transfer.types).not.toContain('text/plain')
    expect(readExplorerFolderDrag(transfer as unknown as DataTransfer)).toEqual({
      version: 1,
      projectId: project.id,
      path: 'C:\\project/src'
    })
  })

  it('shows a folder-row drop state and reports the dragged agent without touching OS files', async () => {
    const onAgentNodeDrop = vi.fn()
    await mount({ onAgentNodeDrop })
    const row = folderRow()
    const transfer = new TestDragData()
    writeAgentNodeDrag(transfer as unknown as DataTransfer, 'agent-one')

    const over = dragEvent('dragover', transfer)
    await act(async () => row.dispatchEvent(over))
    expect(over.defaultPrevented).toBe(true)
    expect(row.classList.contains('ex-row--agent-drop')).toBe(true)

    const drop = dragEvent('drop', transfer)
    await act(async () => row.dispatchEvent(drop))
    expect(drop.defaultPrevented).toBe(true)
    expect(row.classList.contains('ex-row--agent-drop')).toBe(false)
    expect(onAgentNodeDrop).toHaveBeenCalledWith({
      nodeId: 'agent-one',
      projectId: project.id,
      path: 'C:\\project/src'
    })
    expect(transfer.types).toEqual([AGENT_NODE_DRAG_MIME])
    expect(transfer.types).not.toContain('Files')
  })

  it('offers keyboard context-menu routes for the terminal and prepared same-type agent', async () => {
    const onAgentNodeDrop = vi.fn()
    const onOpenTerminalAtFolder = vi.fn()
    await mount({
      onAgentNodeDrop,
      onOpenTerminalAtFolder,
      keyboardAgentNodeId: 'agent-keyboard'
    })
    const row = folderRow()

    await openKeyboardMenu(row)
    await act(async () => menuButton('Open terminal here').click())
    expect(onOpenTerminalAtFolder).toHaveBeenCalledWith({
      projectId: project.id,
      path: 'C:\\project/src'
    })

    await openKeyboardMenu(row)
    await act(async () => menuButton('Open selected agent here').click())
    expect(onAgentNodeDrop).toHaveBeenCalledWith({
      nodeId: 'agent-keyboard',
      projectId: project.id,
      path: 'C:\\project/src'
    })
  })
})
