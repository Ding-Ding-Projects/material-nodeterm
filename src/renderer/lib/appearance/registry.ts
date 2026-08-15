/**
 * Element identity helpers for the appearance system (docs/appearance.md).
 *
 * An element is addressed by ONE stable string id, built as `kind:key` — the tab bar builds
 * `tab:<projectId>`, a node header builds `node:<nodeId>`, a piece of app chrome that exists once
 * builds `app:<name>`. The id is what both `Settings.elementAppearance` and the
 * `data-appearance-id` DOM attribute use, so the two can never drift.
 */
export function appearanceId(kind: string, key: string): string {
  return `${kind}:${key}`
}

export function parseAppearanceId(id: string): { kind: string; key: string } {
  const i = id.indexOf(':')
  if (i === -1) return { kind: id, key: '' }
  return { kind: id.slice(0, i), key: id.slice(i + 1) }
}

/** Human labels for the `kind` half of an id, used by the management list in Settings. */
export const APPEARANCE_KIND_LABELS: Record<string, string> = {
  tab: 'Project tab',
  node: 'Canvas node',
  app: 'App chrome'
}

export function kindLabel(kind: string): string {
  return APPEARANCE_KIND_LABELS[kind] ?? kind
}

/** Fixed ids for app-chrome elements that exist exactly once — these are what prove the editor
 *  can theme its OWN dialog and the chrome around it, not just user content. Each one carries
 *  `data-appearance-id` on its real rendered root (see the individual components) and appears as
 *  a manageable row in Settings → Appearance → "Appearance editor". */
export const APP_CHROME_TARGETS: { id: string; label: string }[] = [
  { id: appearanceId('app', 'tabbar-brand'), label: 'Tab bar brand name' },
  { id: appearanceId('app', 'context-menu'), label: 'Right-click menus' },
  { id: appearanceId('app', 'settings-dialog'), label: 'Settings dialog headings' },
  { id: appearanceId('app', 'appearance-editor'), label: "The appearance editor's own dialog" },
  { id: appearanceId('app', 'command-palette'), label: 'Command palette' }
]
