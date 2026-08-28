// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionRow } from './SessionRow'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import type { SessionRowVM } from '../lib/sessionList'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const row: SessionRowVM = {
  id: 'node-1',
  title: 'Build project',
  color: '#6750a4',
  isAgent: false,
  statusKind: 'done',
  stateLabel: 'Finished',
  statusRestored: false,
  unread: true,
  session: 'shell-1',
  loop: undefined,
  usesContext: false,
  sessionId: undefined,
  cwd: 'C:/projects/demo',
  sshHost: undefined
}

describe('SessionRow personal vocabulary', () => {
  let root: Root | undefined
  let host: HTMLDivElement | undefined

  afterEach(() => {
    if (root) act(() => root?.unmount())
    host?.remove()
    root = undefined
    host = undefined
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: false })
  })

  function renderRow(): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root?.render(
        <SessionRow
          row={row}
          onClick={() => {}}
          onClose={() => {}}
          onRename={() => {}}
          onAiName={() => {}}
          onContextMenu={() => {}}
          onDragStart={() => {}}
          onDragEnd={() => {}}
        />
      )
    })
  }

  it('maps app-authored accessibility titles after an upload', () => {
    usePersonalVocabulary.setState({
      entries: { 'Finished — new for you': 'Done, shell box has news', 'Close session': 'End shell box' },
      status: 'loaded',
      entryCount: 2
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    renderRow()
    expect(host?.querySelector('.ss-check')?.getAttribute('title')).toBe('Done, shell box has news')
    expect(host?.querySelector('.ss-row__close')?.getAttribute('title')).toBe('End shell box')
  })

  it('does not apply the uploaded vocabulary before School mode hydration', () => {
    usePersonalVocabulary.setState({ entries: { 'Close session': 'End shell box' }, status: 'loaded', entryCount: 1 })
    useSchoolMode.setState({ enabled: false, hydrated: false })
    renderRow()
    expect(host?.querySelector('.ss-row__close')?.getAttribute('title')).toBe('Close session')
  })
})
