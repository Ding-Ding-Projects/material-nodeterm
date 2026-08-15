#!/usr/bin/env node
// scripts/check-app-contract.mjs
//
// A hand-written completeness guard for the DESKTOP APP's user-facing feature
// contract — the app equivalent of scripts/check-site-contract.mjs (read that
// file first; this one follows the same shape on purpose). Deliberately NOT
// wired into any GitHub Actions workflow — this project's CI runs no gating
// checks by policy (see CLAUDE.md's "Continuous integration and releases"
// section). It is a local tool: run it yourself before considering a
// desktop-app feature change finished.
//
//   node scripts/check-app-contract.mjs
//
// WHY THIS IS HAND-WRITTEN RATHER THAN PATTERN-MATCHED (same reasoning as the
// site guard, restated for this file because it is the property that makes
// either guard worth anything): a guard that only validates whatever it
// happens to find already passes cleanly on a codebase that has NONE of the
// features it should have, because it never looked for anything by name — it
// can only be surprised by a match, never by an absence it didn't think to
// check. Every row in FEATURES below names a REAL required file, an exported
// symbol, a documentation article, and — where the feature has one — a
// settings-sidebar section id and sidebar icon key, and asserts each is
// PRESENT. When a new canonical feature is added to the desktop app, add its
// row here in the same change, or this guard will not know to look for it,
// and a codebase with that feature silently removed would keep passing.
//
// Each settings-backed feature is also checked for being WIRED, not just
// existing: its section id must be reachable from a *visible* settings
// group (per nav.ts's visibleSettingsGroups on both platforms), and its
// section component must be referenced from the settings tree the same way
// every other section is. A settings section file that exists on disk but
// was deleted from SETTINGS_GROUPS is invisible to a user and must fail here
// exactly as if the file did not exist.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..')

let failures = 0
let checkedCount = 0

function fail(message) {
  failures += 1
  console.error(`✗ ${message}`)
}
function pass(message) {
  checkedCount += 1
  console.log(`✓ ${message}`)
}

function readText(relPath) {
  const abs = join(REPO_ROOT, relPath)
  if (!existsSync(abs)) return null
  try {
    return readFileSync(abs, 'utf8')
  } catch (_err) {
    return null
  }
}

function requireFileExists(relPath, label) {
  checkedCount += 1
  if (!existsSync(join(REPO_ROOT, relPath))) {
    fail(`${label}: missing required file ${relPath}`)
    return false
  }
  pass(`${label}: ${relPath} exists`)
  return true
}

function requireFileContains(relPath, needle, label) {
  checkedCount += 1
  const text = readText(relPath)
  if (text == null) {
    fail(`${label}: cannot read ${relPath}`)
    return false
  }
  const found = needle instanceof RegExp ? needle.test(text) : text.includes(needle)
  if (!found) {
    fail(`${label}: ${relPath} does not contain expected content (${needle})`)
    return false
  }
  pass(`${label}: ${relPath} contains expected content`)
  return true
}

// Occurrence-counting rather than a single `.includes()` — the same
// "renamed/removed symbol still matches" trap the site guard's header
// comment names. Two BROKEN versions of this were tried before this one, and
// both are worth recording so nobody reintroduces them:
//
//  1. Count \b<symbol>\b anywhere in the file, require >=2. TOOTHLESS: this
//     codebase's imports are almost always `import { Foo } from '.../Foo'`,
//     so the module-path STRING repeats the symbol a second time all on its
//     own — the count sits at >=2 forever, even after every real JSX usage
//     is deleted, because the single import line alone supplies both
//     "occurrences". A deliberate probe (delete `<CommandPalette` from
//     Canvas.tsx, leave the import) proved this: the guard stayed green.
//
//  2. Strip only lines that literally START with `import`, then require the
//     symbol appears once in what remains, AND separately require `import`
//     and the symbol to co-occur on one line ([^\n]* between them). This
//     breaks on this codebase's MULTI-LINE named imports
//     (`import {\n  Foo,\n  Bar\n} from '../lazyPanels'`): the continuation
//     line `  Foo,` does not start with `import`, so it survives the strip
//     and gets miscounted as a "real use" of Foo — while the single-line
//     `import ... Foo` check fails because `import` and `Foo` are now on
//     different lines, separated by a newline `[^\n]*` cannot cross. Result:
//     a real, correctly-wired lazy-loaded panel (SourceControlPanel,
//     FileConverterPanel, OllamaManagerPanel — all imported from
//     `lazyPanels.tsx` via a multi-line destructure) was reported as "not
//     imported at all", a false failure caught only by running this guard
//     for real and reading why it went red.
//
// The fix: find the actual import STATEMENT(S) (regex spanning newlines via
// [\s\S]*?, not per-line), confirm the symbol is named inside one, then
// strip those whole statements out and require the symbol survives at least
// once in what remains — that is a real reference, not a second sighting of
// the same import.
const IMPORT_STATEMENT_RE = /import\s+[\s\S]*?\bfrom\s+['"][^'"]+['"]/g
function requireWiredSymbol(relPath, symbol, label) {
  checkedCount += 1
  const text = readText(relPath)
  if (text == null) {
    fail(`${label}: cannot read consumer file ${relPath} to verify ${symbol} is wired in`)
    return false
  }
  const importStatements = text.match(IMPORT_STATEMENT_RE) || []
  const symbolPattern = new RegExp(`\\b${symbol}\\b`)
  const hasImport = importStatements.some((stmt) => symbolPattern.test(stmt))
  const withoutImports = text.replace(IMPORT_STATEMENT_RE, '')
  const realUses = (withoutImports.match(new RegExp(`\\b${symbol}\\b`, 'g')) || []).length
  if (!hasImport) {
    fail(`${label}: ${symbol} is not imported in ${relPath} at all`)
    return false
  }
  if (realUses < 1) {
    fail(
      `${label}: ${symbol} is imported in ${relPath} but never referenced outside the import statement — a component imported but never rendered is not shipped`,
    )
    return false
  }
  pass(`${label}: ${symbol} imported and used ${realUses} time(s) outside its import statement in ${relPath}`)
  return true
}

// ---------------------------------------------------------------------
// Settings-sidebar wiring: nav.ts (section registry) + SettingsIcons.tsx
// (sidebar glyph). Both are read once, up front.
// ---------------------------------------------------------------------
const NAV_FILE = 'src/renderer/components/settings/nav.ts'
const ICONS_FILE = 'src/renderer/components/settings/SettingsIcons.tsx'
const navText = readText(NAV_FILE) || ''
const iconsText = readText(ICONS_FILE) || ''

function requireSettingsSection(sectionId, label) {
  checkedCount += 1
  // Must be declared in the SettingsSectionId union AND actually placed in
  // one of the SETTINGS_GROUPS' `sections` arrays — a type union entry with
  // no group placement is a section nothing can ever navigate to (dead per
  // the same "declared but never used" shape as the wired-symbol check).
  const idPattern = new RegExp(`\\{\\s*id:\\s*'${sectionId}'`)
  if (!idPattern.test(navText)) {
    fail(`${label}: settings section '${sectionId}' is not placed in any SETTINGS_GROUPS entry in ${NAV_FILE}`)
    return false
  }
  pass(`${label}: settings section '${sectionId}' is registered in ${NAV_FILE}`)
  checkedCount += 1
  // Icon lookup is a plain object keyed by the exact section id string.
  const iconPattern = new RegExp(`\\n\\s*(?:'${sectionId}'|${sectionId}):\\s*(?:<|\\()`)
  if (!iconPattern.test(iconsText)) {
    fail(`${label}: no sidebar icon keyed '${sectionId}' in ${ICONS_FILE} (PATHS record is missing this key)`)
    return false
  }
  pass(`${label}: sidebar icon present for '${sectionId}' in ${ICONS_FILE}`)
  return true
}

// ---------------------------------------------------------------------
// FEATURES — one row per canonical desktop-app feature. Each row asserts:
//   - every implementation file listed exists
//   - every contentCheck substring/regex is present in the named file
//   - (optional) the settings section id + sidebar icon are wired
//   - (optional) a component is actually referenced from its real consumer,
//     not merely present on disk
//   - the documentation article exists and contains the required content
// ---------------------------------------------------------------------
const FEATURES = [
  {
    id: 'terminal-sessions-tmux',
    label: 'Terminal sessions + tmux continuity',
    files: ['src/core/pty-manager.ts'],
    contentChecks: [['src/core/pty-manager.ts', 'export function tmuxConf']],
    settingsSection: 'tmux',
    docs: ['docs/features/terminals/session-continuity.md'],
  },
  {
    id: 'windows-session-host',
    label: 'Windows session host',
    files: [
      'src/core/session-host-backend.ts',
      'src/core/session-host-client.ts',
      'src/core/session-host-launcher.ts',
      'src/session-host/host.ts',
    ],
    contentChecks: [['src/core/session-host-backend.ts', 'export function sessionHostSupported']],
    docs: ['docs/windows-session-host.md'],
  },
  {
    id: 'projects-tabs',
    label: 'Projects (tabs)',
    files: ['src/renderer/state/projects.ts'],
    contentChecks: [['src/renderer/state/projects.ts', 'useProjects']],
    docs: ['docs/features/projects/projects-and-tabs.md'],
  },
  {
    id: 'node-kinds',
    label: 'Node kinds (terminal / sticky / group / editor / diff)',
    files: [
      'src/renderer/nodes/TerminalNode.tsx',
      'src/renderer/nodes/StickyNode.tsx',
      'src/renderer/nodes/GroupNode.tsx',
      'src/renderer/nodes/EditorNode.tsx',
      'src/renderer/nodes/DiffNode.tsx',
    ],
    docs: ['docs/features/canvas/node-kinds.md'],
  },
  {
    id: 'agent-support',
    label: 'Agent support (Claude / Codex / Gemini / opencode / Grok / custom)',
    files: ['src/shared/agents/config.ts'],
    contentChecks: [['src/shared/agents/config.ts', 'BuiltinAgentId']],
    settingsSection: 'agents',
    docs: ['docs/features/agents/agent-support.md'],
  },
  {
    id: 'canvas',
    label: 'The canvas',
    files: ['src/renderer/canvas/Canvas.tsx'],
    docs: ['docs/features/canvas/canvas-and-lifecycle.md'],
  },
  {
    id: 'source-control-worktrees',
    label: 'Source control + worktrees',
    files: ['src/core/git-service.ts', 'src/renderer/components/SourceControlPanel.tsx', 'src/renderer/state/worktrees.ts'],
    contentChecks: [
      ['src/core/git-service.ts', 'export class GitService'],
      ['src/renderer/components/SourceControlPanel.tsx', 'export function SourceControlPanel'],
    ],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'SourceControlPanel' },
    docs: ['docs/features/source-control/source-control-and-worktrees.md'],
  },
  {
    id: 'kanban-board',
    label: 'Kanban board',
    files: ['src/renderer/components/kanban/KanbanView.tsx'],
    contentChecks: [['src/renderer/components/kanban/KanbanView.tsx', 'export const KanbanView']],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'KanbanView' },
    docs: ['docs/features/kanban/kanban-board.md'],
  },
  {
    id: 'remote-ssh',
    label: 'Remote / SSH projects',
    files: ['src/core/remote-ssh/control-master.ts', 'src/renderer/components/settings/sections/SshSection.tsx'],
    contentChecks: [['src/core/remote-ssh/control-master.ts', 'controlPathFor']],
    settingsSection: 'ssh',
    docs: ['docs/features/remote/ssh-projects.md'],
  },
  {
    id: 'server-edition',
    label: 'Server Edition',
    files: ['src/server/index.ts'],
    docs: ['docs/SERVER.md', 'docs/features/remote/server-edition.md'],
  },
  {
    id: 'speech-dictation',
    label: 'Speech / dictation',
    files: ['src/core/speech/speech-service.ts', 'src/renderer/components/DictationOverlay.tsx'],
    contentChecks: [['src/renderer/components/DictationOverlay.tsx', 'export function DictationOverlay']],
    settingsSection: 'speech',
    docs: ['docs/features/speech/dictation.md'],
  },
  {
    id: 'packaging-auto-update',
    label: 'Packaging + auto-update',
    files: ['src/main/updater.ts'],
    contentChecks: [['src/main/updater.ts', 'export function initUpdater']],
    settingsSection: 'updates',
    docs: ['docs/features/packaging/packaging-and-auto-update.md'],
  },
  {
    id: 'language-modes',
    label: 'Language modes',
    files: ['src/shared/i18n/types.ts'],
    contentChecks: [["src/shared/i18n/types.ts", "export type LanguageMode = 'en' | 'yue' | 'bilingual'"]],
    settingsSection: 'language',
    docs: ['docs/language-modes.md'],
  },
  {
    id: 'funny-levels',
    label: 'Funny levels (English + Cantonese sliders)',
    files: ['src/shared/types.ts'],
    contentChecks: [
      ['src/shared/types.ts', 'funnyLevelEn'],
      ['src/shared/types.ts', 'funnyLevelYue'],
    ],
    settingsSection: 'language',
    docs: ['docs/language-modes.md'],
  },
  {
    id: 'emoji-toggle',
    label: 'Show emojis in dialogs toggle',
    files: ['src/shared/types.ts'],
    contentChecks: [['src/shared/types.ts', 'showEmojiInDialogs']],
    settingsSection: 'language',
    docs: ['docs/language-modes.md'],
  },
  {
    id: 'regex-builder',
    label: 'Regex builder',
    files: ['src/renderer/components/regex/AnchoredRegexBuilder.tsx'],
    contentChecks: [
      ['src/renderer/components/regex/AnchoredRegexBuilder.tsx', 'export']
    ],
    // The builder must actually be reachable from more than one search
    // surface, not merely exist as an unused component — this is the
    // "every search bar has its own anchored builder" contract from
    // CLAUDE.md, so check it is imported from several real search surfaces.
    wiredInAny: {
      symbol: 'AnchoredRegexBuilder',
      files: [
        'src/renderer/components/CommandPalette.tsx',
        'src/renderer/components/ExplorerPanel.tsx',
        'src/renderer/components/FindBar.tsx',
        'src/renderer/components/menu/FilterableMenu.tsx',
        'src/renderer/components/settings/SettingsSidebar.tsx',
      ],
    },
    docs: ['docs/regex-builder.md'],
  },
  {
    id: 'school-mode',
    label: 'School mode',
    files: ['src/core/school-mode.ts'],
    contentChecks: [['src/core/school-mode.ts', 'export class SchoolModeStore']],
    settingsSection: 'school-mode',
    docs: ['docs/school-mode.md'],
  },
  {
    id: 'personal-vocabulary',
    label: 'Personal-vocabulary JSON upload',
    files: ['src/renderer/lib/personalVocabulary/useVocabularyText.ts'],
    contentChecks: [['src/renderer/lib/personalVocabulary/useVocabularyText.ts', 'export function useVocabularyText']],
    settingsSection: 'vocabulary',
    docs: ['docs/personal-vocabulary.md'],
  },
  {
    id: 'narrator',
    label: 'Narrator',
    files: ['src/renderer/lib/narrator.ts'],
    contentChecks: [['src/renderer/lib/narrator.ts', 'NarratorTrack']],
    settingsSection: 'narrator',
    docs: ['docs/narrator.md'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    files: ['src/main/notifications.ts'],
    contentChecks: [['src/main/notifications.ts', 'MAX_RETAINED_NOTIFICATIONS']],
    settingsSection: 'notifications',
    docs: ['docs/notifications.md'],
  },
  {
    id: 'notification-centre',
    label: 'Notification centre',
    files: ['src/renderer/components/NotificationCenter.tsx'],
    contentChecks: [['src/renderer/components/NotificationCenter.tsx', 'export function NotificationCenter']],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'NotificationCenter' },
    docs: [['docs/notifications.md', '## The notification centre']],
  },
  {
    id: 'command-palette',
    label: 'Command palette',
    files: ['src/renderer/components/CommandPalette.tsx'],
    contentChecks: [['src/renderer/components/CommandPalette.tsx', 'export function CommandPalette']],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'CommandPalette' },
    docs: ['docs/command-palette.md'],
  },
  {
    id: 'destructive-confirmation',
    label: 'Destructive-action confirmation gate',
    files: ['src/renderer/components/DestructiveConfirmGate.tsx'],
    contentChecks: [['src/renderer/components/DestructiveConfirmGate.tsx', 'export function DestructiveConfirmGate']],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'DestructiveConfirmGate' },
    docs: ['docs/destructive-confirmation.md'],
  },
  {
    id: 'scheduled-settings',
    label: 'Scheduled settings',
    files: ['src/core/scheduled-settings-service.ts'],
    contentChecks: [['src/core/scheduled-settings-service.ts', 'export class ScheduledSettingsService']],
    settingsSection: 'schedule',
    docs: ['docs/scheduled-settings.md'],
  },
  {
    id: 'appearance-editor',
    label: 'Appearance editor',
    files: ['src/renderer/components/appearance/AppearanceEditor.tsx'],
    contentChecks: [['src/renderer/components/appearance/AppearanceEditor.tsx', 'export function AppearanceEditorHost']],
    wired: { file: 'src/renderer/App.tsx', symbol: 'AppearanceEditorHost' },
    settingsSection: 'appearance-editor',
    docs: ['docs/appearance.md'],
  },
  {
    id: 'infinite-colour-picker',
    label: 'Infinite colour picker + translator',
    files: ['src/renderer/components/color/ColorPicker.tsx'],
    contentChecks: [['src/renderer/components/color/ColorPicker.tsx', 'export function ColorPicker']],
    wired: { file: 'src/renderer/components/color/ColorField.tsx', symbol: 'ColorPicker' },
    docs: ['docs/colour-picker.md'],
  },
  {
    id: 'app-rename',
    label: 'App rename',
    files: ['src/shared/appIdentity.ts'],
    contentChecks: [
      ['src/shared/appIdentity.ts', 'SHIPPED_APP_NAME'],
      ['src/shared/appIdentity.ts', 'export function resolveAppDisplayName'],
    ],
    settingsSection: 'app-identity',
    docs: ['docs/app-rename.md'],
  },
  {
    id: 'app-logo',
    label: 'App logo customization',
    files: ['src/renderer/lib/appearance/logoProcess.ts'],
    contentChecks: [['src/renderer/lib/appearance/logoProcess.ts', 'MAX_SOURCE_BYTES']],
    wired: { file: 'src/renderer/components/settings/sections/AppIdentitySection.tsx', symbol: 'processLogoFile' },
    settingsSection: 'app-identity',
    docs: ['docs/app-logo.md'],
  },
  {
    id: 'toy-locks',
    label: 'Toy locks',
    files: ['src/renderer/components/toylocks/LockWizard.tsx'],
    contentChecks: [['src/renderer/components/toylocks/LockWizard.tsx', 'export function LockWizard']],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'LockWizard' },
    settingsSection: 'toylocks',
    docs: ['docs/toy-locks.md'],
  },
  {
    id: 'authenticator',
    label: 'Built-in authenticator',
    files: ['src/core/toylocks/authenticator-service.ts'],
    contentChecks: [['src/core/toylocks/authenticator-service.ts', 'export function startAuthenticatorService']],
    settingsSection: 'authenticator',
    docs: ['docs/authenticator.md'],
  },
  {
    id: 'support-tickets',
    label: 'Support Tickets',
    files: ['src/renderer/components/settings/sections/SupportTicketsSection.tsx'],
    settingsSection: 'support',
    // Support Tickets is deliberately documented as a SECTION of the toy-locks
    // article (it is the recovery route for a forgotten toy-lock credential,
    // per CLAUDE.md's "Support Tickets" contract), not as a standalone file —
    // so the required content lives in docs/toy-locks.md, not a separate doc.
    docs: [['docs/toy-locks.md', '## Support Tickets']],
  },
  {
    id: 'exports',
    label: 'Export everything, in every format',
    files: ['src/renderer/components/ExportMenu.tsx'],
    contentChecks: [['src/renderer/components/ExportMenu.tsx', 'export function ExportMenu']],
    wired: { file: 'src/renderer/components/LocalHistoryPanel.tsx', symbol: 'ExportMenu' },
    docs: ['docs/exports.md'],
  },
  {
    id: 'bulk-actions',
    label: 'Bulk actions everywhere',
    files: ['src/renderer/components/BulkActionBar.tsx', 'src/renderer/lib/bulkSelection.ts'],
    contentChecks: [['src/renderer/components/BulkActionBar.tsx', 'export function BulkActionBar']],
    wired: { file: 'src/renderer/components/LocalHistoryPanel.tsx', symbol: 'BulkActionBar' },
    docs: ['docs/bulk-actions.md'],
  },
  {
    id: 'local-history',
    label: 'Local version control (history)',
    files: ['src/renderer/components/LocalHistoryPanel.tsx'],
    contentChecks: [['src/renderer/components/LocalHistoryPanel.tsx', 'export function LocalHistoryPanel']],
    wired: { file: 'src/renderer/components/settings/sections/LocalHistorySection.tsx', symbol: 'LocalHistoryPanel' },
    settingsSection: 'history',
    docs: ['docs/local-history.md'],
  },
  {
    id: 'file-converter',
    label: 'Universal file converter',
    files: ['src/renderer/components/converter/FileConverterPanel.tsx', 'src/core/converter/registry.ts'],
    contentChecks: [['src/renderer/components/converter/FileConverterPanel.tsx', 'export function FileConverterPanel']],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'FileConverterPanel' },
    docs: ['docs/file-converter.md'],
  },
  {
    id: 'ollama-manager',
    label: 'Universal local Ollama suite manager',
    files: ['src/renderer/components/ollama/OllamaManagerPanel.tsx', 'src/core/ollama/client.ts'],
    contentChecks: [['src/renderer/components/ollama/OllamaManagerPanel.tsx', 'export function OllamaManagerPanel']],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'OllamaManagerPanel' },
    docs: ['docs/ollama-manager.md'],
  },
  {
    // The unlock ladder. Asserted on the two things that would silently gut it: the ladder's own
    // module, and the fact that the server actually SERVES it — a ladder nobody can reach from a
    // lockout screen is a passing unit test and a countdown the user still has to stare at.
    id: 'unlock-ladder',
    label: 'Unlock ladder (dim sum, sums, whack-a-mole)',
    files: ['src/core/unlock-ladder.ts', 'src/core/unlock-ladder.test.ts', 'src/server/unlock-ladder-routes.test.ts'],
    // EVERY needle here carries a delimiter the symbol's own name cannot supply — a trailing
    // `{`, `(`, or ` =`. A bare substring is toothless against exactly the edit it is meant to
    // catch: `clearLockoutByLadder` matches happily inside `clearLockoutByLadderRENAMED`, and
    // `LADDER_BUDGET` matches inside `LADDER_BUDGET_WINDOW_MS`, so both stayed green through a
    // deliberate rename until this comment existed.
    contentChecks: [
      ['src/core/unlock-ladder.ts', 'export class UnlockLadder {'],
      // The cap is the whole safety story: every rung is machine-solvable, so a ladder without a
      // budget has quietly removed the lockout it decorates.
      ['src/core/unlock-ladder.ts', 'export const LADDER_BUDGET ='],
      // Clearing the ladder must reach exactly this method and no other — see its doc comment.
      // Asserted at the DEFINITION and the CALL, because either half alone is dead.
      ['src/server/auth.ts', 'clearLockoutByLadder(): void {'],
      ['src/server/http.ts', 'auth.clearLockoutByLadder()'],
      ['src/server/http.ts', "pathname === '/auth/unlock/challenge'"],
      ['src/server/http.ts', "pathname === '/auth/unlock/verify'"],
      // School mode removes every dim-sum surface, so the starting rung must be decided from it.
      ['src/server/index.ts', 'auth.setSchoolModeSource('],
      ['src/core/unlock-ladder.ts', 'firstRung(): LadderRung {'],
      // Defined AND called: the lockout screen is what makes the ladder reachable, and a
      // `lockedPage` that exists but is never served is a countdown with a dead function beside
      // it. Asserting the call site rather than an import, since it lives in the same file.
      ['src/server/http.ts', 'lockedPage(auth.lockoutRemainingMs()'],
    ],
    docs: ['docs/unlock-ladder.md'],
  },
]

for (const feature of FEATURES) {
  for (const file of feature.files || []) {
    requireFileExists(file, feature.label)
  }
  for (const [file, needle] of feature.contentChecks || []) {
    requireFileContains(file, needle, feature.label)
  }
  if (feature.settingsSection) {
    requireSettingsSection(feature.settingsSection, feature.label)
  }
  if (feature.wired) {
    requireWiredSymbol(feature.wired.file, feature.wired.symbol, feature.label)
  }
  if (feature.wiredInAny) {
    checkedCount += 1
    const { symbol, files } = feature.wiredInAny
    const hits = files.filter((f) => {
      const text = readText(f)
      return text != null && text.includes(symbol)
    })
    if (hits.length < 2) {
      fail(
        `${feature.label}: expected ${symbol} to be reachable from at least 2 real search surfaces, found it referenced in ${hits.length} of ${files.length} checked (${files.join(', ')})`,
      )
    } else {
      pass(`${feature.label}: ${symbol} reachable from ${hits.length}/${files.length} checked search surfaces`)
    }
  }
  for (const doc of feature.docs || []) {
    if (Array.isArray(doc)) {
      const [docPath, needle] = doc
      const ok = requireFileExists(docPath, `${feature.label}: documentation`)
      if (ok) requireFileContains(docPath, needle, `${feature.label}: documentation covers this feature`)
    } else {
      requireFileExists(doc, `${feature.label}: documentation`)
    }
  }
}

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------
console.log('')
console.log(`Checked ${checkedCount} contract assertions across ${FEATURES.length} features.`)
if (failures > 0) {
  console.error(`\n${failures} FAILURE(S). This is a local tool, not a CI gate — fix these before considering the app change complete.`)
  process.exit(1)
} else {
  console.log('\nAll contract features present and wired. ✓')
  process.exit(0)
}
