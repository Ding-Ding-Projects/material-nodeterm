import { useEffect } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from './canvas/Canvas'
import { PromptDialogHost } from './components/promptDialog'
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

  // Publish the resolved appearance as `data-theme` on <html> — what the light palette in
  // styles.css keys off. Absent, or 'dark', leaves every token at its original value, so this one
  // attribute is all that stands between an existing install and the chrome it has always had.
  const appTheme = useAppTheme()
  useEffect(() => {
    document.documentElement.dataset.theme = appTheme
  }, [appTheme])

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
