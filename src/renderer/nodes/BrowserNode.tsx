import { useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, useStore, type NodeProps } from '@xyflow/react'
import type { BrowserProfile, BrowserTab } from '@shared/types'
import { browserPartitionForNode } from '@shared/browser-profiles'
import { markWorkspaceDirty } from '../state/workspaceDirty'
import { defaultBrowserTabs, type CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { useProjects } from '../state/projects'
import { BrowserSurface } from './BrowserSurface'
import { BrowserProfilePicker } from './BrowserProfilePicker'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { notify } from '../lib/adhdNotify'

/** Debounce for persisting a tab's live URL/title while the user navigates — matches the SSH
 *  mirror's 5s write-throttle intent (this repo's established pattern for "don't rewrite the
 *  project file on every navigation event"), scaled down since this is a purely local write. */
const NAV_PERSIST_DEBOUNCE_MS = 800

/**
 * A navigable Chromium browser node with its own **tab strip** (2026-08): several pages share one
 * node, one Electron profile/partition, and one set of node chrome (frame/header/resize/close).
 * Each tab wraps the shared {@link BrowserSurface} (webview + toolbar); only the ACTIVE tab's
 * surface is mounted — switching tabs tears down the previous webview (its guest process ends)
 * and mounts the newly active one, which reopens at its last persisted URL. Tabs persist to
 * `data.browserTabs`/`data.browserActiveTabId` (project content, git-shared — see
 * `CanvasNodeState`'s doc comment; cookies/storage stay in the Electron partition and are never
 * written here). `data.url`/`data.title` are kept mirroring the ACTIVE tab for any older code path
 * that still reads a browser node's single `url`/`title` (e.g. the new-window sibling-node
 * fallback in Canvas, the header tooltip).
 *
 * A link opened with `target=_blank` / `window.open` no longer spawns a roped sibling node on the
 * canvas — it opens as a new TAB in this same node (see Canvas's `onBrowserNewWindow` listener).
 *
 * Multiple browser profiles per project (2026-08): the header's {@link BrowserProfilePicker} lets
 * the user switch which of the project's named `browserProfiles` this node uses — two nodes on
 * the same profile share cookies/storage, nodes on different profiles are isolated. See
 * `shared/browser-profiles.ts` for the partition derivation this is built on.
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { NODE_MIN_SIZES } from '../lib/nodeSizing'
import type { CanvasNode } from '../state/workspace'
import { BrowserSurface } from './BrowserSurface'
import { BrowserDrivingIndicator } from './BrowserDrivingChip'
import { useWebviewKeepAlive } from '../state/webviewKeepAlive'

/**
 * A navigable Chromium browser node: node chrome (frame/header/resize/close) wrapping the shared
 * {@link BrowserSurface} (webview + toolbar). The last top-level URL persists to `data.url` so the
 * node reopens where it was; the same surface backs the kanban card modal's browser popup.
 *
 * A background KEEP-ALIVE GHOST (`data.ghost` — see lib/webviewKeepAlive.ts) renders the same
 * tree (the mounted `<webview>` is the point), hidden by the ghost node's `display:none` style.
 * Only the wiring differs: navigation/title facts go to the pool entry (there is no live node in
 * React Flow to update — `updateNodeData` on a ghost id is a dropped change), and a memory-saver
 * discard ends the entry outright (a ghost without its guest is a husk holding a cap slot).
 */
export default function BrowserNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const { deleteElements, updateNodeData } = useReactFlow()
  const headerFill = nodeHeaderFillStyle(data.color)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const projectBrowserProfiles = useProjects(
    (s) => s.projects.find((p) => p.id === s.activeProjectId)?.browserProfiles
  )
  const setProjectBrowserProfiles = useProjects((s) => s.setProjectBrowserProfiles)

  const browserProfileId = data.browserProfileId as string | undefined
  // The group frame this node sits in, read from React Flow (the live source of truth for
  // parentage) rather than from `data` — nothing writes a group id into node data, and a stale
  // one would silently point the webview at the wrong cookie jar.
  const parentGroupId = useStore((st) => st.nodeLookup.get(id)?.parentId)
  const partition = browserPartitionForNode(activeProjectId, browserProfileId, parentGroupId)
  const isTemporary = !!data.temporary

  // ── Tabs ────────────────────────────────────────────────────────────────────────────────────
  // `tabs`/`activeTabId` are a LOCAL mirror of `data.browserTabs`/`data.browserActiveTabId`,
  // initialized once and then reconciled from outside changes (see the sync effect below) rather
  // than read fresh on every render — a fresh read would clobber an in-flight debounced edit the
  // moment `updateNodeData` fires for an unrelated field.
  const [tabs, setTabsState] = useState<BrowserTab[]>(
    () => data.browserTabs ?? defaultBrowserTabs(id, data.url as string | undefined, (data.title as string) || 'New Tab')
  )
  const [activeTabId, setActiveTabIdState] = useState<string>(
    () => data.browserActiveTabId ?? tabs[0]?.id ?? `${id}-tab-0`
  )
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef<{ tabs: BrowserTab[]; activeTabId: string }>({ tabs, activeTabId })
  latestRef.current = { tabs, activeTabId }

  // Reconcile local tabs against `data.browserTabs` set from OUTSIDE this component — the only
  // external writer today is Canvas's new-window handler, appending a tab and activating it.
  // Merge by id rather than replacing wholesale, so an in-flight local edit (a navigation not yet
  // debounce-flushed) is never clobbered by a stale external snapshot.
  useEffect(() => {
    const incoming = data.browserTabs
    if (!incoming || incoming.length === 0) return
    const localIds = new Set(latestRef.current.tabs.map((t) => t.id))
    const added = incoming.filter((t) => !localIds.has(t.id))
    if (added.length === 0) return
    setTabsState((prev) => [...prev, ...added])
    if (data.browserActiveTabId && added.some((t) => t.id === data.browserActiveTabId)) {
      setActiveTabIdState(data.browserActiveTabId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.browserTabs, data.browserActiveTabId])

  // Flush any pending debounced persist on unmount so a navigation right before closing the node
  // isn't silently lost.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current)
        persistImmediate(latestRef.current.tabs, latestRef.current.activeTabId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persistImmediate = (nextTabs: BrowserTab[], nextActiveTabId: string): void => {
    const active = nextTabs.find((t) => t.id === nextActiveTabId) ?? nextTabs[0]
    updateNodeData(id, {
      browserTabs: nextTabs,
      browserActiveTabId: nextActiveTabId,
      // Legacy mirror — see the component doc comment.
      ...(active ? { url: active.url, title: active.title } : {})
    })
  }

  const schedulePersist = (nextTabs: BrowserTab[], nextActiveTabId: string): void => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null
      persistImmediate(nextTabs, nextActiveTabId)
    }, NAV_PERSIST_DEBOUNCE_MS)
  }

  const selectTab = (tabId: string): void => {
    setActiveTabIdState(tabId)
    persistImmediate(tabs, tabId)
  }

  const newTab = (): void => {
    const created: BrowserTab = { id: `${id}-tab-${Date.now().toString(36)}`, url: '', title: 'New Tab' }
    const next = [...tabs, created]
    setTabsState(next)
    setActiveTabIdState(created.id)
    persistImmediate(next, created.id)
  }

  const closeTab = (tabId: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    let next = tabs.filter((t) => t.id !== tabId)
    if (next.length === 0) {
      // Closing the last tab never closes the node — it resets to one fresh blank tab.
      next = [{ id: `${id}-tab-${Date.now().toString(36)}`, url: '', title: 'New Tab' }]
    }
    const nextActive = activeTabId === tabId ? next[next.length - 1].id : activeTabId
    setTabsState(next)
    setActiveTabIdState(nextActive)
    persistImmediate(next, nextActive)
  }

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]
  const ghost = data.ghost === true

  return (
    <div className={`term-node browser-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={NODE_MIN_SIZES.browser.width} minHeight={NODE_MIN_SIZES.browser.height} isVisible={selected} color={data.color} />
      {/* Invisible target handle so a rope from the agent node that opened this can attach. */}
      <Handle
        id="flow-in"
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: 'none', top: 0 }}
      />
      {/* Invisible source handle so a rope to a browser node this one spawned (new-window) attaches. */}
      <Handle
        id="flow-out"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: 'none', bottom: 0 }}
      />

      <div
        className={`term-node__header ${headerFill.className}${
          headerFill.filled ? ' term-node__header--filled' : ''
        }`}
        style={headerFill.style}
      >
        <span className="term-node__title-text" title={activeTab?.url || ''}>
          {(data.title as string) || vocab('Browser')}
        </span>
        {/* The driving chip — present the whole time an agent holds a control lease on this node,
            with the one obvious Stop. Renders nothing otherwise (and, until PR 7 ships the verb that
            drives a lease, in every case today). */}
        <BrowserDrivingIndicator nodeId={id} />
        <span className="term-node__spacer" />
        {isTemporary && (
          <button
            className="browser-node__keep"
            title={vocab('This popup is temporary — it is not saved with the project. Keep it?')}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { temporary: undefined })
              markWorkspaceDirty()
            }}
          >
            {vocab('Temporary · Keep')}
          </button>
        )}
        <BrowserProfilePicker
          profiles={projectBrowserProfiles}
          selectedId={browserProfileId}
          onSelect={(profileId) => updateNodeData(id, { browserProfileId: profileId })}
          onCreate={(profile: BrowserProfile) =>
            setProjectBrowserProfiles(activeProjectId, [...(projectBrowserProfiles ?? []), profile])
          }
          onRename={(profileId, name) =>
            setProjectBrowserProfiles(
              activeProjectId,
              (projectBrowserProfiles ?? []).map((p) => (p.id === profileId ? { ...p, name } : p))
            )
          }
          onRemove={(profileId) => {
            setProjectBrowserProfiles(
              activeProjectId,
              (projectBrowserProfiles ?? []).filter((p) => p.id !== profileId)
            )
            // This node's own selection stays as-is (still a valid, isolated partition — see
            // `browserPartitionFor`'s dangling-reference note); only the name disappears from the
            // picker. A node that was ON the removed profile keeps its own cookie jar rather than
            // silently merging into the default session.
          }}
          onReset={(profileId) => {
            const profilePartition = browserPartitionForNode(activeProjectId, profileId, undefined)
            void window.nodeTerminal.browser.profile.reset(profilePartition).then((result) => {
              notify(
                result.ok
                  ? { kind: 'success', title: vocab('Browser profile reset'), body: vocab('The local browser session was cleared. Project tabs and the profile name remain.') }
                  : { kind: 'error', title: vocab('Browser profile reset failed'), body: result.error, bodyKind: 'fact' }
              )
            })
          }}
        />
        <button className="term-node__close" title={vocab('Close')} onClick={() => deleteElements({ nodes: [{ id }] })}>
          ×
        </button>
      </div>

      <div className="browser-node__tabs nodrag" role="tablist" aria-label={vocab('Browser tabs')}>
        {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTabId}
              className={`browser-node__tab${tab.id === activeTabId ? ' browser-node__tab--active' : ''}`}
              title={tab.url || tab.title || vocab('New Tab')}
              onClick={() => selectTab(tab.id)}
            >
              <span className="browser-node__tab-title">{tab.title || tab.url || vocab('New Tab')}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`${vocab('Close tab')} ${tab.title || vocab('New Tab')}`}
                className="browser-node__tab-close"
                onClick={(e) => closeTab(tab.id, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    closeTab(tab.id, e as unknown as React.MouseEvent)
                  }
                }}
              >
                ×
              </span>
            </button>
        ))}
        <button
          type="button"
          className="browser-node__tab-new"
          title={vocab('New tab')}
          aria-label={vocab('New tab')}
          onClick={newTab}
        >
          +
        </button>
      </div>

      <div className="editor-node__body">
        {!ghost && activeTab && (
          <BrowserSurface
            // Keyed by tab id AND partition: switching tabs must tear down and rebuild the
            // <webview> onto the new tab's live URL, and switching profiles must rebuild onto
            // the new Electron session rather than trying to reparent a live guest across
            // sessions — see BrowserSurfaceProps.partition's doc comment.
            key={`${activeTab.id}::${partition ?? 'default'}`}
            nodeId={id}
            ownerNodeId={data.browserOwnerNodeId as string | undefined}
            surface="canvas"
            url={activeTab.url}
            onUrlChange={(u) => {
              const next = tabs.map((t) => (t.id === activeTabId ? { ...t, url: u } : t))
              setTabsState(next)
              schedulePersist(next, activeTabId)
            }}
            onTitleChange={(t) => {
              const next = tabs.map((tab) => (tab.id === activeTabId ? { ...tab, title: t } : tab))
              setTabsState(next)
              schedulePersist(next, activeTabId)
            }}
            partition={partition}
          />
        )}
        {ghost && (
          <BrowserSurface
            nodeId={id}
            ownerNodeId={data.browserOwnerNodeId as string | undefined}
            surface="canvas"
            url={(data.url as string) ?? ''}
            partition={data.partition as string | undefined}
            onUrlChange={(u) => useWebviewKeepAlive.getState().updateGhostData(id, { url: u })}
            onTitleChange={(t) => useWebviewKeepAlive.getState().updateGhostData(id, { title: t })}
            onGuestDiscarded={() => useWebviewKeepAlive.getState().drop(id)}
          />
        )}
      </div>
    </div>
  )
}
