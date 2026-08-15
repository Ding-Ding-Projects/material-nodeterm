import { isMacPlatform, isWindowsPlatform } from '../shared/platform-utils'

// Windows has no macOS-style traffic lights, so the tab bar's window-chrome padding (see
// `.tabbar` in styles.css) needs to know which edge to reserve room on: macOS's on the left,
// Windows' `titleBarOverlay` caption buttons on the right (see main/index.ts createWindow). Set
// as early and as cheaply as possible — a synchronous `navigator` check, no bridge round-trip —
// so the very first paint already has the right padding instead of visibly reflowing a moment
// later.
document.documentElement.dataset.platform = isMacPlatform() ? 'mac' : isWindowsPlatform() ? 'win' : 'other'

// Bootstrap switch: under Electron the preload has already defined window.nodeTerminal
// (contextBridge runs before any renderer script), so this is a pure pass-through on
// desktop. In a browser (Server Edition) we install the WS bridge first, then boot.
async function bootstrap(): Promise<void> {
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
    // cannot raise its cap and stays on the default budget. On MAC desktop the budget goes the
    // other way — DOWN: the macOS compositor mishandles many live WebGL canvases (black
    // terminals after a zoom-out grant burst, whole-window flicker) with no JS-visible error,
    // so the binding limit there is the compositor, not Chromium's cap. See src/shared/webgl.ts.
    const [{ setWebglBudget }, { WEBGL_BUDGET_DESKTOP, WEBGL_BUDGET_DESKTOP_MAC }] = await Promise.all([
      import('./terminal/webgl-budget'),
      import('../shared/webgl')
    ])
    // isMacPlatform is already imported statically above (needed synchronously for
    // data-platform), so this reuses it rather than re-fetching ../shared/platform-utils.
    setWebglBudget(isMacPlatform() ? WEBGL_BUDGET_DESKTOP_MAC : WEBGL_BUDGET_DESKTOP)
  }
  await import('./boot')
}
void bootstrap()
