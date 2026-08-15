import { create } from 'zustand'

/**
 * Global "which element is the appearance editor currently open for" state — one popover instance
 * (`AppearanceEditorHost`, mounted once near the app root) rather than every themeable component
 * carrying its own portal/positioning logic. Callers open it with `openAppearanceEditor(...)`.
 */
export interface AppearanceEditorTarget {
  id: string
  label: string
  kind: string
  /** The element the popover anchors beside AND returns focus to on close. */
  anchor: HTMLElement
}

interface AppearanceEditorHostState {
  target: AppearanceEditorTarget | null
  open(target: AppearanceEditorTarget): void
  close(): void
}

export const useAppearanceEditorHost = create<AppearanceEditorHostState>((set, get) => ({
  target: null,
  open(target) {
    set({ target })
  },
  close() {
    const t = get().target
    set({ target: null })
    // Non-modal popovers must return focus to what opened them (docs/appearance.md).
    if (t?.anchor?.isConnected) t.anchor.focus()
  }
}))

export function openAppearanceEditor(id: string, label: string, kind: string, anchor: HTMLElement): void {
  useAppearanceEditorHost.getState().open({ id, label, kind, anchor })
}
