import { isWindowsPlatform } from '../shared/platform-utils'

// Set before first paint so the title bar reserves space for native caption buttons immediately.
document.documentElement.dataset.platform = isWindowsPlatform() ? 'win' : 'other'

// Bootstrap switch: under Electron the preload has already defined window.nodeTerminal
// (contextBridge runs before any renderer script), so this is a pure pass-through on
// desktop. In a browser (Server Edition) we install the WS bridge first, then boot.
async function bootstrap(): Promise<void> {
  // "Escape to widget" (see main/canvas-widget-window.ts): a widget window loads this SAME
  // bundle with `?widget=<nodeId>` in its URL. Checked FIRST — a widget window never needs the
  // workspace store, the full canvas, or the WebGL-budget setup below, and loading any of that
  // would mean a SECOND process reading/writing the same project.json the main window owns.
  // `isWidgetWindow()` is a synchronous URL check and is harmless (always false) in every other
  // boot context, including the Server Edition browser tab, which never carries this query key.
  const widgetModule = await import('./widget/WidgetApp')
  if (widgetModule.isWidgetWindow()) {
    const [{ createRoot }, React] = await Promise.all([import('react-dom/client'), import('react')])
    createRoot(document.getElementById('root')!).render(React.createElement(widgetModule.default))
    return
  }
  // Dev-only glyphgrid proving ground. `import.meta.env.DEV` is statically replaced with
  // `false` in a production build, so this whole branch — and the harness import graph with
  // it — is dead code rollup drops; the app boot path below is untouched.
  if (import.meta.env.DEV && location.hash === '#glyphgrid') {
    const [{ createRoot }, React, { GlyphGridHarness }] = await Promise.all([
      import('react-dom/client'),
      import('react'),
      import('./glyphgrid/harness/GlyphGridHarness')
    ])
    createRoot(document.getElementById('root')!).render(React.createElement(GlyphGridHarness))
    return
  }
  if (!window.nodeTerminal) {
    // Record the shell BEFORE the bridge installs: affordances that only work under Electron
    // (Reveal in Finder) or only in a browser (HTTP downloads) read this. See bridge/runtime.ts.
    const [{ markBrowserRuntime }, { installWsBridge }] = await Promise.all([
      import('./bridge/runtime'),
      import('./bridge/ws-bridge')
    ])
    markBrowserRuntime()
    const connected = await installWsBridge()
    if (!connected) return // overlay is up; startReconnect reloads on the first reopen
  } else {
    // Electron desktop: main raised Chromium's WebGL context cap (--max-active-webgl-contexts),
    // so the terminal GPU-renderer budget can rise to match. A browser tab (Server Edition)
    // cannot raise its cap and stays on the default budget.
    const [{ setWebglBudget }, { WEBGL_BUDGET_DESKTOP }] = await Promise.all([
      import('./terminal/webgl-budget'),
      import('../shared/webgl')
    ])
    setWebglBudget(WEBGL_BUDGET_DESKTOP)
  }
  await import('./boot')
}
void bootstrap()
