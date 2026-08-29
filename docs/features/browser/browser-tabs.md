# Browser node tabs

A **browser node** on the canvas can hold multiple tabs, not just one URL. Source:
`src/renderer/nodes/BrowserNode.tsx`, with the persisted shape defined on `CanvasNodeState` in
`src/shared/types.ts` (`browserTabs?: BrowserTab[]`, `browserActiveTabId?: string`).

## The persisted shape and the legacy migration

Before this feature, a browser node carried a single `url`/`title` pair directly on its node data.
`browserTabs` is an array of `BrowserTab` (each with its own url/title); `browserActiveTabId`
records which tab id is currently shown (absent = the first tab).

`browserTabs` is **project content** — it's git-shared, exactly like every other field on
`CanvasNodeState`. A tab's URL and title are not secrets, so there's no reason to keep them out of
`project.json`. What is deliberately **never** mirrored there is the tab's cookies/localStorage —
those live in the node's Electron partition (keyed by `browserProfileId`; see
`shared/browser-profiles.ts`), which is machine-local by construction. Two teammates who clone a
repo with the same browser node see the same tabs and the same URLs, but each gets their own
independent login state in that node's session.

A node created before this feature has `browserTabs` absent or empty. `nodeStatesToFlow` migrates
that legacy single `url`/`title` pair into a one-tab array **once**, on load — and that migration
is not written back to disk until the user actually edits a tab. This is deliberate: opening an
old project and immediately closing it again without touching the browser node should not silently
rewrite `project.json` with a schema the user never asked for. `BrowserNode.tsx` itself falls back
to the same single-tab default whenever `data.browserTabs` is undefined
(`defaultBrowserTabs(id, data.url, data.title)`), so the component behaves identically whether the
migration has already run in the store or not.

`BrowserNode.tsx` keeps a **local mirror** of `tabs`/`activeTabId` in component state, reconciled
against `data.browserTabs`/`data.browserActiveTabId` whenever they change from *outside* the
component (i.e. a set from elsewhere — canvas control, a project reload) rather than treating the
prop as the single render-time source for every keystroke of in-tab editing.

## Cookie/storage isolation

Each browser node's webview is keyed (React `key`) by **both** the active tab's id and the
resolved partition (`${activeTab.id}::${partition ?? 'default'}`). Switching tabs must tear down
and rebuild the webview's session — reusing one `<webview>` element across tabs backed by
different partitions would risk one tab's session bleeding into another's DOM/session state. The
partition itself is derived by `browserPartitionFor(activeProjectId, browserProfileId)` from
`shared/browser-profiles.ts` — see that module for how `browserProfileId` selects one of the
project's `browserProfiles`, or falls back to the app's unpartitioned default session when unset.

## Known limitation: a background tab loses live state

A browser node renders **one** active webview at a time. Switching to a different tab unmounts the
previous tab's webview — its in-page JS state, scroll position, and any unsaved form input are
gone. Reopening it reloads the tab's stored URL fresh; it is not a suspended/resumed webview the
way a browser's own background tabs are. This is a deliberate v1 trade rather than an oversight:
keeping every tab's webview alive simultaneously would mean one Electron webview process per tab
per browser node, which does not scale the way the canvas's WebGL-context budgeting for terminals
already has to be careful about (see the terminal-node WebGL budget section in `CLAUDE.md`).
Persisted state (the tab's URL and title) survives; anything live inside the page does not.

## Suggested articles

- [Canvas and lifecycle](../canvas/canvas-and-lifecycle.md) — how node data persists and what
  counts as project content versus machine-local state.
- [Node kinds](../canvas/node-kinds.md) — where the browser node sits among the other canvas node
  kinds.
