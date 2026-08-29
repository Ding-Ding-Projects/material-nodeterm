/**
 * A project's icon: an emoji, or a curated Material Symbols glyph name. Lives on `Project.icon`
 * and rides `.nodeterm/project.json` (git-shared) like `name`/`color`, so `sanitizeProjectIcon`
 * treats every value as HOSTILE INPUT — same stance as `readProjectCapabilities` / `validKanban`
 * in core/workspace-files.ts: a stored value survives only when it passes a strict check,
 * everything else degrades to "no icon" rather than throwing or rendering something unvetted.
 *
 * Ported from upstream's `feat/project-icons` branch (eneskirca/nodeterm), reworked onto this
 * fork's own design system rather than upstream's. Upstream's icon variant is `lucide` (backed by
 * the `lucide-react` package); this fork is a Material Design 3 app that just finished removing
 * second icon vocabularies, so lucide is not ported. The equivalent variant here is
 * `material-symbol`, naming a glyph from this app's own bundled, subsetted Material Symbols
 * Rounded font (`src/renderer/components/MaterialSymbol.tsx` /
 * `src/renderer/components/materialSymbols.generated.ts`). Upstream's `image` variant (GitHub
 * avatar / user upload / fetched favicon, a `data:` URL) is also not ported — see the `emoji` /
 * `material-symbol` split below for why that scope was cut.
 *
 * `PROJECT_SYMBOL_IDS` is a curated subset of names from the app's font subset, not "every name
 * the subset happens to carry" — plenty of the 92 bundled glyphs are pure UI-action icons (close,
 * delete, add, an arrow) that make poor project badges. It is intentionally a CLOSED set, exactly
 * like upstream's `LUCIDE_ICON_IDS` was: an open set would let a hostile project.json name a glyph
 * that some future, differently-subsetted build of this app doesn't carry, which renders as
 * nothing (the font is subsetted BY CODEPOINT — an unlisted name has no glyph to fall back to).
 * `src/renderer/components/ProjectGlyph.tsx` carries a compile-time assertion that every id in
 * this list is a real key of the generated codepoint map, and
 * `materialSymbols.project-icon-coverage.test.ts` re-checks it at runtime.
 *
 * Browser-safe: this module is bundled into the renderer, so no node builtins (no `Buffer`), and
 * it deliberately does NOT import anything from `src/renderer` (that direction is backwards for a
 * module under `src/shared`) — `PROJECT_SYMBOL_IDS` is a plain string-literal list here, checked
 * against the real codepoint map from the renderer side instead.
 */
export type ProjectIcon =
  | { type: 'emoji'; emoji: string }
  | { type: 'material-symbol'; name: string }

/**
 * Curated allowlist of Material Symbol names a project icon's `name` may be — glyphs suited to
 * being a project's badge (folders, code, tools, status marks), drawn from the ~92 names this
 * app's subsetted icon font actually bundles. Closed set; also drives the icon-picker grid — this
 * list IS the grid.
 */
export const PROJECT_SYMBOL_IDS = [
  'folder', 'folder_open', 'create_new_folder', 'code', 'terminal', 'database', 'dns', 'memory',
  'hub', 'workspaces', 'view_kanban', 'task_alt', 'schedule', 'bolt', 'palette', 'brush',
  'language', 'lock', 'lock_open', 'vpn_key', 'sticky_note_2', 'settings', 'search', 'smart_toy',
  'auto_awesome', 'psychology', 'flag', 'push_pin', 'label', 'bug_report', 'checklist', 'cast',
  'sync', 'refresh', 'verified', 'grid_view', 'account_tree', 'account_circle', 'smartphone',
  'school'
] as const

/**
 * Strict, throw-free normaliser for a value read as a project's `icon` — the boundary every
 * `project.json` (git-shared, hand-editable, auto-adopted) must cross. Unknown/malformed shapes
 * or an unlisted Material Symbol name degrade to `undefined` (no icon) rather than throwing or
 * being trusted as-is.
 */
export function sanitizeProjectIcon(v: unknown): ProjectIcon | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (o.type === 'emoji') {
    return typeof o.emoji === 'string' && o.emoji.length > 0 && o.emoji.length <= 16
      ? { type: 'emoji', emoji: o.emoji }
      : undefined
  }
  if (o.type === 'material-symbol') {
    return typeof o.name === 'string' &&
      (PROJECT_SYMBOL_IDS as readonly string[]).includes(o.name)
      ? { type: 'material-symbol', name: o.name }
      : undefined
  }
  return undefined
}
