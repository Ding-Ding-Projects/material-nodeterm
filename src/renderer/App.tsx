import { useEffect } from 'react'
import { rainbowDurationSeconds } from './lib/nodeColor'
import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from './canvas/Canvas'
import { PromptDialogHost } from './components/promptDialog'
import { DestructiveGateHost } from './components/DestructiveGateHost'
import { DimSumSurprise } from './components/DimSumSurprise'
import { NotificationToasts } from './components/NotificationToasts'
import { SessionProvider } from './session/session'
import { localSession } from './session/localSession'
import { useSettings } from './state/settings'
import { useSchoolMode } from './state/schoolMode'
import { useKidsMode } from './state/kidsMode'
import { usePersonalVocabulary } from './state/personalVocabulary'
import { useViewMode } from './state/viewMode'
import { setWebglEnabled } from './terminal/webgl-budget'
import { applyRendererMode } from './terminal/renderer-mode'
import { useSharedGlyph } from './canvas/SharedGlyphLayer'
// `resolveGpuRendering` is gone: 'shared' turned the setting into a renderer CHOICE rather than a
// webgl on/off, so `resolveTerminalRenderer` answers it and `applyRendererMode` owns the ordering
// between the two coordinators.
import { resolveTerminalRenderer } from '../shared/webgl'
import { resolveTerminalTheme } from './terminal/themes'
import { useAppTheme } from './state/useAppTheme'
import { AppearanceStyleInjector } from './components/appearance/AppearanceStyleInjector'
import { AppearanceEditorHost } from './components/appearance/AppearanceEditor'
import { resolveAppDisplayName } from '../shared/appIdentity'
import { applyAccentTokens } from './lib/accentTokens'

export default function App() {
  // Apply the terminal-rendering setting to the two GPU coordinators, live. 'auto' is
  // per-terminal WebGL on every platform (see `resolveTerminalRenderer` for the history of the
  // macOS branch and the evidence that collapsed it). 'off' reclaims every context; 'shared'
  // takes the per-terminal budget down entirely and brings up the one canvas-wide glyph context
  // instead. `applyRendererMode` owns the ordering contract between the two (and its test).
  // Subscribed at the root so it holds whatever view is showing.
  const gpu = useSettings((s) => s.settings.terminalGpuRendering)
  useEffect(() => {
    applyRendererMode(resolveTerminalRenderer(gpu), {
      setWebglEnabled,
      setSharedEnabled: (on) => useSharedGlyph.getState().setEnabled(on)
    })
  }, [gpu])

  // Publish the active terminal theme's background as a CSS variable. xterm paints its own
  // background, but the chrome AROUND it does not: the canvas node's body shows through the few px
  // its xterm host is inset by (and through a co-attach letterbox), and the kanban card modal
  // frames its terminal in an 8px pad. Without this both keep the app's colour and every
  // non-default theme renders inside a mismatched frame.
  const terminalTheme = useSettings((s) => s.settings.terminalTheme)
  useEffect(() => {
    const { background } = resolveTerminalTheme(terminalTheme).theme
    if (background) document.documentElement.style.setProperty('--term-bg', background)
  }, [terminalTheme])

  // Publish the rainbow cycle duration once, on the root, rather than per node.
  //
  // Every rainbow node reads the same variable, so they all turn together. Setting it per node
  // would let them drift apart by however long apart they were mounted, and a canvas where six
  // rainbow nodes are each showing a different hue reads as a rendering fault rather than as a
  // deliberate colour. The level-to-seconds mapping is in lib/nodeColor.ts so this and the
  // stylesheet cannot disagree about what a speed of 3 means.
  const rainbowSpeed = useSettings((s) => s.settings.rainbowSpeed)
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--nt-rainbow-duration',
      `${rainbowDurationSeconds(rainbowSpeed)}s`
    )
  }, [rainbowSpeed])

  // Publish the resolved appearance as `data-theme` on <html> — what the light palette in
  // styles.css keys off. Absent, or 'dark', leaves every token at its original value, so this one
  // attribute is all that stands between an existing install and the chrome it has always had.
  const appTheme = useAppTheme()
  useEffect(() => {
    document.documentElement.dataset.theme = appTheme
  }, [appTheme])

  // A custom accent is a colour FAMILY, not one isolated fill. CSS can alias --md-primary to
  // --accent, but it cannot split a hex variable into RGB for containers or derive readable text
  // tones. Publish the dependent roles together, and re-derive them when the light/dark surface
  // beneath them changes.
  const accent = useSettings((s) => s.settings.accent)
  useEffect(() => {
    applyAccentTokens(document.documentElement, accent, appTheme)
  }, [accent, appTheme])

  // Keep the view-mode store's default in sync with the Settings choice, so projects the user
  // hasn't explicitly toggled follow it (and flip live when the setting changes).
  const defaultView = useSettings((s) => s.settings.defaultProjectView)
  useEffect(() => {
    useViewMode.getState().setDefaultView(defaultView === 'kanban' ? 'kanban' : 'canvas')
  }, [defaultView])

  // Hydrate the shared School-mode record once, at the root — every surface (Settings, the
  // dim-sum surprise, the personal-vocabulary boundary) reads the store this seeds rather than
  // calling the IPC directly, so a change made by ANOTHER app/window applies live everywhere.
  useEffect(() => {
    void useSchoolMode.getState().init()
    void useKidsMode.getState().init()
    usePersonalVocabulary.getState().hydrate()
  }, [])
  // The user's chosen display name (docs/app-rename.md) — DISPLAY only. The document title is the
  // one piece of chrome every surface (desktop window, browser tab) shows without any component
  // having to opt in.
  const appDisplayName = useSettings((s) => s.settings.appDisplayName)
  useEffect(() => {
    document.title = resolveAppDisplayName(appDisplayName)
  }, [appDisplayName])

  return (
    <SessionProvider session={localSession}>
      <ReactFlowProvider>
        <Canvas />
        {/* In-app window.prompt replacement (Electron has no prompt); driven by promptDialog(). */}
        <PromptDialogHost />
      {/* Mounted at the root so every surface can reach the super gate, and so an open one
          survives a project switch beneath it. See state/destructiveGate.ts. */}
      <DestructiveGateHost />
        {/* Non-blocking corner-anchored toast stack — mounted once, app-wide. See
            docs/notifications.md. */}
        <NotificationToasts />
        {/* Per-element appearance customization (docs/appearance.md): the generated stylesheet
            plus the one shared anchored editor popover, both mounted once. */}
        <AppearanceStyleInjector />
        <AppearanceEditorHost />
      </ReactFlowProvider>
      <DimSumSurprise />
    </SessionProvider>
  )
}
