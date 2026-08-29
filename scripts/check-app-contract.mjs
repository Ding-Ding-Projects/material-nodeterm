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
// check. Every row in FEATURES below names its real implementation and docs,
// plus the focused tests, localized copy, persistence, built-artifact
// interaction, captures, and settings wiring its contract needs. A pending
// required evidence field is red, not silently accepted. When a new canonical
// feature is added to the desktop app, add its row here in the same change, or
// this guard will not know to look for it, and a codebase with that feature
// silently removed would keep passing.
//
// Each settings-backed feature is also checked for being WIRED, not just
// existing: its section id must be reachable from a *visible* settings
// group (per nav.ts's visibleSettingsGroups on both platforms), and its
// section component must be referenced from the settings tree the same way
// every other section is. A settings section file that exists on disk but
// was deleted from SETTINGS_GROUPS is invisible to a user and must fail here
// exactly as if the file did not exist.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { isExcluded, listDocsMarkdown } from './build-docs-bundle.mjs'

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
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT_RE = /(^|[^:])\/\/[^\r\n]*/gm

function sourceWithoutImportsAndComments(text) {
  const withoutComments = text
    .replace(BLOCK_COMMENT_RE, '')
    .replace(LINE_COMMENT_RE, '$1')
  return {
    importStatements: withoutComments.match(IMPORT_STATEMENT_RE) || [],
    executableSource: withoutComments.replace(IMPORT_STATEMENT_RE, ''),
  }
}

function requireWiredSymbol(relPath, symbol, label) {
  checkedCount += 1
  const text = readText(relPath)
  if (text == null) {
    fail(`${label}: cannot read consumer file ${relPath} to verify ${symbol} is wired in`)
    return false
  }
  const { importStatements, executableSource } = sourceWithoutImportsAndComments(text)
  const symbolPattern = new RegExp(`\\b${symbol}\\b`)
  const hasImport = importStatements.some((stmt) => symbolPattern.test(stmt))
  const realUses = (executableSource.match(new RegExp(`\\b${symbol}\\b`, 'g')) || []).length
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
//   - every focused behavioural test listed exists and keeps its named suite boundary
//   - (optional) the settings section id + sidebar icon are wired
//   - (optional) a component is actually referenced from its real consumer,
//     not merely present on disk
//   - the documentation article exists and contains the required content
// ---------------------------------------------------------------------
const FEATURES = [
  {
    id: 'browser-extensions',
    label: 'Browser extensions (unpacked) + WebAuthn',
    files: [
      'src/main/browser-extensions.ts',
      'src/main/browser-extensions-core.ts',
      'src/main/browser-extensions-store.ts',
      'src/renderer/nodes/BrowserExtensionsPanel.tsx',
    ],
    contentChecks: [
      ['src/main/browser-extensions-core.ts', 'export function browserExtensionsKeyFor('],
      ['src/renderer/nodes/BrowserExtensionsPanel.tsx', 'export function BrowserExtensionsPanel('],
    ],
    docs: ['docs/features/browser/extensions-and-webauthn.md'],
  },
  {
    id: 'password-manager',
    label: 'Per-project password managers',
    files: [
      'src/shared/password-manager.ts',
      'src/core/password-manager/crypto.ts',
      'src/core/password-manager/vault.ts',
      'src/core/password-manager/vault-store.ts',
      'src/core/password-manager/password-manager-handlers.ts',
      'src/renderer/components/passwordManager/PasswordManagerPanel.tsx',
    ],
    contentChecks: [
      ['src/core/password-manager/crypto.ts', 'export function deriveVaultKey('],
      ['src/core/password-manager/vault.ts', 'export function releaseGroupBinding('],
    ],
    docs: ['docs/features/projects/password-manager.md'],
  },
  {
    id: 'canvas-widget-mode',
    label: 'Canvas widget mode (escape to widget)',
    files: [
      'src/main/canvas-widget-window.ts',
      'src/renderer/terminal/widget-escape.ts',
      'src/core/canvas-widget.ts',
    ],
    contentChecks: [
      ['src/renderer/terminal/widget-escape.ts', 'export function canEscapeToWidget('],
    ],
    docs: ['docs/features/terminals/canvas-widget.md'],
  },
  {
    id: 'browser-node-tabs',
    label: 'Browser node tabs',
    files: ['src/renderer/nodes/BrowserNode.tsx'],
    contentChecks: [
      ['src/renderer/nodes/BrowserNode.tsx', 'defaultBrowserTabs'],
    ],
    docs: ['docs/features/browser/browser-tabs.md'],
  },
  {
    id: 'minecraft-backups',
    label: 'Minecraft world backups',
    files: [
      'src/core/minecraft/backups.ts',
      'src/renderer/components/minecraft/MinecraftBackupsPanel.tsx',
    ],
    contentChecks: [
      ['src/core/minecraft/backups.ts', 'export async function restoreBackup('],
    ],
    docs: ['docs/features/integrations/minecraft-backups.md'],
  },
  {
    id: 'group-picker',
    label: 'Group picker (move into group)',
    files: ['src/renderer/components/canvas/GroupPickerDialog.tsx'],
    contentChecks: [
      ['src/renderer/components/canvas/GroupPickerDialog.tsx', 'export function GroupPickerDialog('],
    ],
    docs: ['docs/features/canvas/group-picker.md'],
  },
  {
    id: 'terminal-sessions-tmux',
    label: 'Terminal sessions + tmux continuity',
    files: ['src/core/pty-manager.ts'],
    contentChecks: [['src/core/pty-manager.ts', 'export function tmuxConf']],
    settingsSection: 'tmux',
    docs: ['docs/features/terminals/session-continuity.md'],
  },
  {
    id: 'terminal-word-separators',
    label: 'Terminal word separators',
    files: ['src/shared/word-separators.ts', 'src/core/pty-manager.ts', 'src/shared/ssh.ts'],
    contentChecks: [
      ['src/shared/word-separators.ts', 'export function resolveWordSeparators('],
      ['src/shared/word-separators.ts', 'export function tmuxWordSeparatorsLine('],
    ],
    docs: ['docs/features/terminals/word-separators.md'],
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
    id: 'windows-terminal-profiles',
    label: 'First-class Windows terminal profiles',
    implementation: {
      files: [
        'src/core/windows-terminal-profiles.ts',
        'src/renderer/components/settings/sections/ShellSection.tsx',
        'src/renderer/lib/terminal-profile-actions.ts',
        'src/renderer/lib/terminal-creation-surfaces.ts',
        'src/renderer/canvas/Canvas.tsx',
        'src/shared/node-exec.ts',
      ],
      contentChecks: [
        ['src/core/windows-terminal-profiles.ts', /^export class WindowsTerminalProfileService\b/m],
        ['src/renderer/components/settings/sections/ShellSection.tsx', /^export function ShellSection\b/m],
        ['src/renderer/lib/terminal-profile-actions.ts', /^export async function recycleThenApplyTerminalProfile\b/m],
        ['src/renderer/lib/terminal-creation-surfaces.ts', /^export function terminalProfileCreationActions\b/m],
        ['src/renderer/canvas/Canvas.tsx', /^function terminalCreationOptionsFor\b/m],
        ['src/shared/node-exec.ts', /^\s*terminalProfileId\?: string\s*$/m],
      ],
    },
    localizedCopy: {
      status: 'verified',
      files: [
        'src/shared/i18n/catalog.ts',
        'src/renderer/lib/personalVocabulary/useLocalizedVocabularyText.ts',
        'src/renderer/components/settings/sections/ShellSection.tsx',
        'src/renderer/components/FabMenu.tsx',
        'src/renderer/components/kanban/KanbanView.tsx',
        'src/renderer/components/kanban/SessionCard.tsx',
        'src/renderer/nodes/TerminalNode.tsx',
      ],
      contentChecks: [
        ['src/shared/i18n/catalog.ts', /^\s*'terminalProfiles\.restart\.confirmDescription':\s*\{/m],
        ['src/renderer/components/settings/sections/ShellSection.tsx', /useLocalizedVocabularyText\(\)/],
        ['src/renderer/components/FabMenu.tsx', /terminalProfiles\.create\.menuLabel/],
        ['src/renderer/components/kanban/KanbanView.tsx', /terminalProfiles\.restart\.progress/],
        ['src/renderer/components/kanban/SessionCard.tsx', /terminalProfiles\.header\.ariaLabelWithHint/],
        ['src/renderer/nodes/TerminalNode.tsx', /terminalProfiles\.error\.nodeRecovery/],
      ],
      tests: [
        ['src/shared/i18n/catalog.terminal-profiles.test.ts', /^\s*describe\((['"])Windows terminal-profile localization catalog\1,\s*\(\)\s*=>\s*\{/m],
        ['src/renderer/components/FabMenu.terminal-profiles.test.tsx', /^\s*it\((['"])renders profile controls in Cantonese through the shipped language catalog\1,/m],
        ['src/renderer/components/FabMenu.terminal-profiles.test.tsx', /^\s*it\((['"])applies personal vocabulary to localized profile prose without rewriting profile facts\1,/m],
        ['src/renderer/components/kanban/SessionCard.terminal-profile.test.tsx', /^\s*it\((['"])shows a localized accessible profile chip on an agent card without rewriting its dynamic label\1,/m],
      ],
    },
    persistence: {
      files: [
        'src/core/settings-store.ts',
        'src/shared/node-exec.ts',
        'src/renderer/state/settings.ts',
        'src/renderer/components/settings/sections/ShellSection.tsx',
      ],
      contentChecks: [
        ['src/core/settings-store.ts', 'defaultTerminalProfileId'],
        ['src/shared/node-exec.ts', /^\s*terminalProfileId\?: string\s*$/m],
        ['src/renderer/state/settings.ts', /^\s*update\(patch\)\s*\{/m],
        ['src/renderer/components/settings/sections/ShellSection.tsx', /await refresh\(useSettings\.getState\(\)\.settings\.defaultShell\)/],
      ],
      tests: [
        ['src/core/settings-store.test.ts', /^\s*describe\((['"])legacy defaultShell migration to Windows terminal profiles\1,\s*\(\)\s*=>\s*\{/m],
        ['src/renderer/state/workspace.terminal-profiles.test.ts', /^\s*describe\((['"])terminal profile workspace propagation\1,\s*\(\)\s*=>\s*\{/m],
        ['src/shared/node-exec.test.ts', /^\s*it\((['"])removes shell, terminal profile, pending launch, and ssh\.extraArgs before a project file is written\1,\s*\(\)\s*=>\s*\{/m],
      ],
    },
    focusedTests: [
      ['src/core/windows-terminal-profiles.test.ts', /^\s*describe\((['"])WindowsTerminalProfileService built-in resolution\1,\s*\(\)\s*=>\s*\{/m],
      ['src/core/pty-terminal-profiles.test.ts', /^\s*describe\((['"])PtyManager trusted Windows profile spawn boundary\1,\s*\(\)\s*=>\s*\{/m],
      ['src/renderer/components/settings/sections/ShellSection.test.tsx', /^\s*describe\((['"])ShellSection Windows terminal profiles\1,\s*\(\)\s*=>\s*\{/m],
      ['src/renderer/state/workspace.terminal-profiles.test.ts', /^\s*describe\((['"])terminal profile snapshots on node creation\1,\s*\(\)\s*=>\s*\{/m],
      ['src/renderer/lib/terminal-profile-actions.test.ts', /^\s*describe\((['"])terminal profile UI actions\1,\s*\(\)\s*=>\s*\{/m],
      ['src/renderer/lib/terminal-creation-surfaces.test.ts', /^\s*describe\((['"])terminal creation surface funnels\1,\s*\(\)\s*=>\s*\{/m],
      ['src/renderer/components/CommandPalette.terminal-creation.test.tsx', /^\s*describe\((['"])CommandPalette terminal creation funnel\1,\s*\(\)\s*=>\s*\{/m],
      ['src/renderer/components/ContextMenu.terminal-creation.test.tsx', /^\s*describe\((['"])ContextMenu terminal creation funnel\1,\s*\(\)\s*=>\s*\{/m],
      ['src/renderer/components/SessionsSidebar.terminal-creation.test.tsx', /^\s*describe\((['"])SessionsSidebar terminal creation\1,\s*\(\)\s*=>\s*\{/m],
      // `\s*` after the paren, unlike its siblings above, because this title is long enough that
      // the formatter puts it on its own line. The pattern was written for a single-line call that
      // has never existed on disk — the row and the suite landed in the same commit and the row has
      // never passed — so the shape, not the name, was the stale half. Everything that makes this a
      // BOUNDARY assertion is unchanged: the title is still matched literally, still anchored to the
      // start of a line, and still has to be a `suite(...)` call with an arrow-function body.
      ['src/core/windows-terminal-profiles.realwindows.test.ts', /^\s*suite\(\s*(['"])REAL Windows terminal profiles \(explicit Electron-as-Node acceptance\)\1,\s*\(\)\s*=>\s*\{/m],
    ],
    builtArtifactInteraction: {
      // Verified by `npm run check:wired` against the REAL built artifact: the three
      // `terminal-profile-*` cases in that harness drive the Settings picker, an explicit-profile
      // spawn, the fail-closed refusal of an unknown id, and a whole Restart with profile… through
      // the two-key destructive gate. Each was watched failing first — the picker id, the header
      // chip, the gate slider and the resolver were broken one at a time in the built bundles and
      // every case went red for the right reason. They are win32-only and declare a skip with its
      // reason elsewhere, so this row is evidence about the delivery target, not about every host.
      status: 'verified',
      files: ['scripts/check-app-wired.mjs'],
      contentChecks: [
        ['scripts/check-app-wired.mjs', /^\s*id: 'terminal-profile-picker',/m],
        ['scripts/check-app-wired.mjs', /^\s*id: 'terminal-profile-spawn',/m],
        ['scripts/check-app-wired.mjs', /^\s*id: 'terminal-profile-restart',/m],
        // Never the ids alone: three cases renamed down to nothing would still carry them. And
        // never a bare substring either — `completeDestructiveGate()` as plain text is satisfied by
        // the line that DEFINES the helper, so deleting the call that drives it left this row
        // green (watched, on this file). Every needle below is anchored to the start of the line
        // that actually performs the step, which a comment-out or a rename cannot survive.
        ['scripts/check-app-wired.mjs', /^\s*const listed = await settle\('__wiredProfileList',/m],
        ['scripts/check-app-wired.mjs', /^\s*const stuck = await settingFromMain\('defaultTerminalProfileId', chosen\)/m],
        ['scripts/check-app-wired.mjs', /^\s*const submenu = await openMenuSubmenu\('New terminal with profile…'\)/m],
        ['scripts/check-app-wired.mjs', /^\s*const submenu = await openMenuSubmenu\('Restart with profile…'\)/m],
        ['scripts/check-app-wired.mjs', /^\s*const gate = await completeDestructiveGate\(\)/m],
        ['scripts/check-app-wired.mjs', /^\s*const bogus = await settle\(/m],
        ['scripts/check-app-wired.mjs', /^\s*if \(bogus\.ok\) \{/m],
        ['scripts/check-app-wired.mjs', /^\s*const relaunched = await until\(/m],
      ],
    },
    captures: {
      status: 'verified',
      // NOT docs/assets/shots/capture-manifest.json, and the distinction is the whole reason this
      // row stayed stuck. capture-shots.mjs rewrites that file wholesale on every `npm run shots`,
      // so a hand-added entry is erased by the next capture run with nothing to warn you; and one
      // manifest declares one `method`, which there is the unpackaged Electron+CDP sweep. Packaged
      // evidence living in that file would have to sit under a method string describing a different
      // route against a different artifact — a false provenance claim in the exact field this
      // checker reads to prevent one. So packaged evidence gets its own committed manifest, written
      // only by scripts/promote-packaged-captures.mjs, at a path the capture sweep never touches.
      manifest: 'docs/assets/shots/packaged-capture-manifest.json',
      requiredIds: [
        'windows-terminal-profile-picker',
        'windows-terminal-profile-terminal',
        'windows-terminal-profile-unavailable',
        'windows-terminal-profile-reattached',
        'windows-terminal-profile-restart-warning',
      ],
      reason: 'promoted from a real packaged cheap-Lowlevel-headless run at a8a0d3bb: all five required ids, five profiles (auto, windows-powershell, cmd, git-bash, wsl:docker-desktop) each verified on input/output, unicode, cwd and terminal size, plus session-host continuity across an app relaunch. Two blockers remain declared rather than hidden — copy-paste-lossless-clipboard-restore and installed-squirrel-artifact-proof — and the run reports them itself.',
    },
    settingsSection: 'shell',
    wired: {
      file: 'src/renderer/components/settings/SettingsPage.tsx',
      symbol: 'ShellSection',
    },
    docs: [
      ['docs/features/terminals/windows-shell-profiles.md', '## Verification status'],
      // Interaction is no longer pending, so the article no longer disclaims it. One needle per
      // LINE — the article wraps at ~100 columns and its line endings are CRLF, so a needle that
      // spans the wrap matches nothing while looking perfectly correct.
      ['docs/features/terminals/windows-shell-profiles.md', 'does not claim that the pending capture'],
      ['docs/features/terminals/windows-shell-profiles.md', 'Packaged-app interaction **is** exercised, by `npm run check:wired` against the real built'],
    ],
  },
  {
    id: 'projects-tabs',
    label: 'Projects (tabs)',
    files: ['src/renderer/state/projects.ts'],
    contentChecks: [['src/renderer/state/projects.ts', 'useProjects']],
    docs: ['docs/features/projects/projects-and-tabs.md'],
  },
  {
    id: 'global-project-settings',
    label: 'Global and project settings overlays',
    files: ['src/renderer/state/settings.ts', 'src/renderer/components/settings/SettingsPage.tsx'],
    contentChecks: [
      ['src/renderer/state/settings.ts', 'export const useSettings ='],
      ['src/renderer/components/settings/SettingsPage.tsx', 'Reset all to Global'],
    ],
    docs: ['docs/features/global-and-project-settings.md'],
  },
  {
    // Ownership is the whole feature. The canvas gate and the core gate are deliberately separate
    // implementations of one refusal, because the first can be bypassed and the second is what
    // holds when it is -- so both are asserted here rather than one standing in for the other.
    id: 'wsl-instances',
    label: 'WSL instances bound to canvas frames',
    files: [
      'src/core/wsl/ownership.ts',
      'src/core/wsl/lifecycle.ts',
      'src/core/wsl/service.ts',
      'src/shared/wsl-binding.ts',
      'src/shared/wsl.ts',
    ],
    contentChecks: [
      ['src/core/wsl/ownership.ts', 'export function fileWslOwnershipStore('],
      // The refusal itself, by its reason string: a rename of the check would not carry this.
      ['src/core/wsl/lifecycle.ts', "reason: 'not-owned-by-app'"],
      ['src/core/wsl/service.ts', 'export function startWslService('],
      ['src/shared/wsl-binding.ts', 'export function canManageWslDistro('],
      // A failed enumeration must reach the renderer as a rejection, never as an empty machine.
      ['src/core/wsl/service.ts', 'if (!enumeration.ok) throw new Error('],
    ],
    docs: ['docs/features/wsl/wsl-instances.md'],
  },
  {
    id: 'nsis-installer-node',
    label: 'NSIS installer authoring node',
    files: [
      'src/renderer/nodes/NsisInstallerNode.tsx',
      'src/shared/nsis/render.ts',
      'src/shared/node-exec.ts',
    ],
    contentChecks: [
      ['src/shared/nsis/render.ts', 'export function renderNsis('],
      // Reachability: the row that makes the node creatable at all. It shipped registered and
      // unreachable once, which is indistinguishable from working until somebody looks for it.
      ['src/renderer/canvas/Canvas.tsx', "label: 'New NSIS installer…'"],
      ['src/renderer/state/workspace.ts', 'export function createNsisNode('],
      // The machine-local half must be stripped before the shared project file is written.
      ['src/shared/node-exec.ts', /^\s*delete out\.nsisLocalPaths\s*$/m],
    ],
    docs: ['docs/features/packaging/nsis-installer-node.md'],
  },
  {
    id: 'approved-relay-peers',
    label: 'Approved relay peers (list and revoke)',
    files: ['src/main/remote/approved-devices.ts', 'src/renderer/components/settings/sections/PhoneSection.tsx'],
    contentChecks: [
      ['src/main/remote/approved-devices.ts', 'export function mutateApprovedDevices('],
      ['src/preload/index.ts', /^\s*relayPeers: \{/m],
      // Local-only, both ways: a peer may neither read nor edit the list of who can reach here.
      // Anchored with the trailing comma: a bare name is satisfied by any rename that merely
      // APPENDS to it (`IPC.remoteRevokePeerV2` contains `IPC.remoteRevokePeer`), which is one of
      // the standard ways a guard reports green while the thing it guards has gone.
      ['src/main/platform-electron.ts', /^\s*IPC\.remoteRevokePeer,?\s*$/m],
      ['src/main/platform-electron.ts', /^\s*IPC\.remoteListApprovedPeers,?\s*$/m],
    ],
    docs: ['docs/features/remote/approved-relay-peers.md'],
  },
  {
    id: 'project-history-archives',
    label: 'Project history and single-file archives',
    files: ['src/core/project-archive.ts', 'src/core/project-archive-container.ts'],
    contentChecks: [
      ['src/core/project-archive.ts', 'export class ProjectArchiveService'],
      ['src/core/project-archive-container.ts', 'export function packContainer('],
    ],
    docs: [
      'docs/features/projects/project-history-and-archives.md',
      // The password half of the same container: a protected `.nodeterm-project` is still the
      // single-file save this row covers, so it belongs here rather than in a row of its own.
      'docs/protected-project-files.md',
    ],
  },
  {
    // The sessions-sidebar project-header right-click menu and the project switcher's per-row
    // actions panel are two independently-typed menus that drifted apart (the switcher had no
    // archive save/open, the sidebar menu had no appearance editor). Both must consume the one
    // shared label/id module rather than re-typing the label, or the drift comes back the moment
    // either file is edited without the other.
    id: 'project-menu-actions-shared-source',
    label: 'Project menu actions (sidebar + switcher share one source)',
    files: ['src/renderer/lib/projectMenuActions.ts'],
    contentChecks: [
      ['src/renderer/lib/projectMenuActions.ts', 'export const SHARED_PROJECT_ACTIONS'],
      ['src/renderer/canvas/Canvas.tsx', "from '../lib/projectMenuActions'"],
      ['src/renderer/components/ProjectSwitcher.tsx', "from '../lib/projectMenuActions'"],
    ],
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
    id: 'service-nodes',
    label: 'Service manager nodes',
    files: ['src/renderer/nodes/ServiceNode.tsx', 'src/renderer/state/workspace.ts', 'src/shared/types.ts'],
    contentChecks: [
      ['src/renderer/nodes/ServiceNode.tsx', 'export function ServiceNode('],
      ['src/renderer/state/workspace.ts', 'export function createServiceNode('],
      ['src/shared/types.ts', 'export const SERVICE_NODE_KINDS ='],
    ],
    docs: ['docs/features/integrations/service-nodes.md'],
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
    id: 'docker-host',
    label: 'Docker-hosted encrypted project sharing',
    files: ['src/main/remote/docker-host-runtime.ts', 'src/main/remote/relay-host-service.ts'],
    contentChecks: [
      ['src/main/remote/docker-host-runtime.ts', 'export async function startDockerHostRuntime('],
      ['src/main/remote/relay-host-service.ts', 'export function initRelayHost('],
    ],
    docs: ['docs/features/remote/docker-host.md'],
  },
  {
    id: 'offline-docs-browser',
    label: 'In-app offline documentation browser',
    files: [
      'src/shared/docs.ts',
      'src/renderer/components/docs/DocsArticleView.tsx',
      'src/renderer/components/docs/useDocsBundle.ts',
    ],
    contentChecks: [
      ['src/shared/docs.ts', 'export function searchArticles('],
      ['src/renderer/components/docs/DocsArticleView.tsx', 'export function DocsArticleView('],
      ['src/renderer/components/docs/useDocsBundle.ts', 'export function useDocsBundle('],
    ],
    docs: ['docs/features/help/in-app-documentation.md'],
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
      ['src/renderer/components/regex/AnchoredRegexBuilder.tsx', 'export function AnchoredRegexBuilder(']
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
    // Shipped: docs/team-presence.md records "Stage 1, Stage 2 and Stage 3 landed".
    id: 'team-presence',
    label: 'Team presence',
    files: [
      'src/core/presence/hub.ts',
      'src/renderer/components/PresenceLayer.tsx',
      'src/renderer/components/PresenceChips.tsx',
    ],
    contentChecks: [
      ['src/renderer/components/PresenceLayer.tsx', 'export function PresenceLayer'],
      ['src/renderer/components/PresenceChips.tsx', 'export function PresenceChips'],
    ],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'PresenceLayer' },
    docs: ['docs/team-presence.md'],
  },
  {
    // macOS-only by nature, but a shipped surface with its own settings section — so it is a
    // contract like any other. A feature that exists on only one platform still has to exist.
    id: 'notch-hud',
    label: 'Notch HUD (macOS)',
    files: ['src/main/notch-hud.ts', 'src/renderer/components/settings/sections/NotchSection.tsx'],
    contentChecks: [['src/main/notch-hud.ts', 'export function initNotchHud']],
    settingsSection: 'notch',
    docs: ['docs/notch-hud.md'],
  },
  {
    id: 'agent-mascots',
    label: 'Walking agent mascots',
    files: ['src/renderer/nodes/AgentMascot.tsx'],
    contentChecks: [['src/renderer/nodes/AgentMascot.tsx', 'export function AgentMascot']],
    docs: ['docs/mascot-sprites.md'],
  },
  {
    // Named in the shared instructions as mandatory and explicitly NOT opt-out-able, and it had
    // code and a doc but no row here for the entire time this guard has existed. That is the exact
    // failure the header comment warns about: a list that only validates what it already knows
    // about cannot notice a canonical feature nobody added to it.
    id: 'dim-sum-surprise',
    label: 'Dim sum surprise',
    files: ['src/renderer/components/DimSumSurprise.tsx'],
    contentChecks: [
      ['src/renderer/components/DimSumSurprise.tsx', 'export function DimSumSurprise'],
      // The contract is that there is no off switch. A settings toggle appearing here would be a
      // violation, not a feature, so the guard asserts the absence.
      ['docs/dim-sum.md', 'no setting'],
    ],
    wired: { file: 'src/renderer/App.tsx', symbol: 'DimSumSurprise' },
    docs: ['docs/dim-sum.md'],
  },
  {
    id: 'session-memory',
    label: 'Session memory (RAM pill + per-session panel)',
    files: [
      'src/renderer/components/SystemResourcePill.tsx',
      'src/renderer/components/SessionMemoryPanel.tsx',
      'src/core/session-memory.ts',
    ],
    contentChecks: [
      ['src/renderer/components/SystemResourcePill.tsx', 'export function SystemResourcePill'],
      ['src/renderer/components/SessionMemoryPanel.tsx', 'export function SessionMemoryPanel'],
      // "could not measure" and "there is nothing here" must stay distinguishable — the rule the
      // whole feature exists to honour.
      ['src/core/session-memory.ts', /^\s*return \{ ok: true, rows, mem \}\s*$/m],
      ['src/core/session-memory.ts', /^\s*if \(!bin\) return \{ ok: false, rows: \[\], mem \}\s*$/m],
    ],
    docs: ['docs/session-memory.md'],
  },
  {
    id: 'atomic-writes',
    label: 'Atomic writes that survive Windows',
    files: ['src/core/fs-atomic.ts', 'src/core/fs-atomic.guard.test.ts'],
    contentChecks: [
      ['src/core/fs-atomic.ts', 'export async function renameAtomic'],
      ['src/core/fs-atomic.ts', 'export async function writeFileAtomic'],
      // The scan is the enforcement — without it the helper is a convention, and a convention is
      // exactly what failed here for 23 stores. Needle carries a delimiter so a rename of the
      // test's internals cannot satisfy it by substring.
      ['src/core/fs-atomic.guard.test.ts', 'no bare rename, in ANY spelling, outside the helper'],
    ],
    docs: ['docs/atomic-writes.md'],
  },
  {
    id: 'destructive-confirmation',
    label: 'Destructive-action confirmation gate',
    files: [
      'src/renderer/components/DestructiveConfirmGate.tsx',
      'src/renderer/components/DestructiveGateHost.tsx',
      'src/renderer/state/destructiveGate.ts',
    ],
    contentChecks: [
      ['src/renderer/components/DestructiveConfirmGate.tsx', 'export function DestructiveConfirmGate'],
      // The gate is reached through a store, so it is available to every surface — not only the
      // canvas. This row used to assert the component was imported by Canvas.tsx, which pinned
      // WHERE the gate lived rather than THAT it works, and stayed green for the whole period in
      // which three of the five guarded actions could not reach it at all.
      ['src/renderer/state/destructiveGate.ts', 'export function openDestructiveGate'],
      ['src/renderer/components/DestructiveGateHost.tsx', '<DestructiveConfirmGate'],
    ],
    // Mounted at the app root, so an open gate is not inside a subtree a project switch
    // re-renders out from under the person confirming.
    wired: { file: 'src/renderer/App.tsx', symbol: 'DestructiveGateHost' },
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
    // Terminal text sharpness on a fractional device-pixel ratio — Windows at 125% / 150%, which
    // is the delivery platform's normal state. Two independent causes, both MEASURED on real
    // pixels rather than reasoned about: PHASE (an arbitrary pan lands the fixed-resolution
    // terminal raster between device pixels, and bilinear resampling smears every glyph) and
    // SCALE (the raster is built at dpr and displayed at dpr × zoom, so any zoom ≠ 1 resamples).
    //
    // This row exists because the recursive docs sweep flagged the article the moment the lane
    // landed — which is the sweep working. Before it recursed, a feature documented under
    // docs/features/ was invisible to the completeness mechanism while the identical feature
    // documented at docs/ top level went red.
    //
    // Needles anchor to declarations, never bare identifiers. RASTER_SCALE_MIN_FACTOR is the floor
    // that currently forbids supersampling, and it is pinned deliberately: it is the reason the
    // zoom-out case is still open, so a renamed RASTER_SCALE_MIN_FACTOR_V2 must not satisfy the
    // row that documents the trade-off it represents.
    id: 'terminal-sharpness',
    label: 'Terminal text sharpness (device-pixel phase and raster scale)',
    files: [
      'src/renderer/terminal/device-pixel-fit.ts',
      'src/renderer/terminal/raster-scale.ts',
      'src/renderer/terminal/renderer-mode.ts',
    ],
    contentChecks: [
      ['src/renderer/terminal/device-pixel-fit.ts', 'export const RASTER_SCALE_STEP'],
      ['src/renderer/terminal/device-pixel-fit.ts', 'export const RASTER_SCALE_MIN_FACTOR'],
      ['src/renderer/terminal/raster-scale.ts', 'export function patchTerminalRasterScale('],
      ['src/renderer/terminal/raster-scale.ts', 'export function resyncRasterScales('],
      // The PHASE half, wired at the viewport: snapped on gesture END, never per-frame, because
      // fighting d3-zoom mid-drag stutters the pan.
      // Anchored to the CALL, not the bare name. Written loose first, and the break test caught
      // it immediately: renaming the symbol to devicePixelSnapOffsetREMOVED left the substring
      // intact and the row stayed green over a deleted wiring. The trailing ( is what a rename
      // cannot carry with it — the same trap this file's own header records.
      ['src/renderer/canvas/Canvas.tsx', 'devicePixelSnapOffset('],
    ],
    tests: [
      ['src/renderer/terminal/device-pixel-fit.test.ts', "describe('terminalRasterScale'"],
      ['src/renderer/terminal/raster-scale.test.ts', "describe('patchTerminalRasterScale'"],
      // The wiring guard specifically: deleting the raster patch used to stay green.
      ['src/renderer/terminal/raster-scale-wired.test.ts', 'raster'],
    ],
    docs: [
      ['docs/features/canvas/terminal-sharpness.md', '## The two causes'],
      ['docs/features/canvas/terminal-sharpness.md', '## What the app does about each'],
    ],
  },
  {
    // The Status surface — the Status rail destination between History and Alerts. Every datum it
    // renders is committed repository data bundled at build time (the capture manifest, the
    // generated changelog, package.json), so there is no main-process read and no CorePlatform
    // seam that could silently not exist server-side: the same built bundle behaves identically
    // on Desktop and in the Server Edition. Hence no settingsSection either — this is a rail
    // destination, not a settings page.
    //
    // Every needle carries a delimiter (a trailing `(`, a `:`, or a line-anchored `<`), because a
    // bare substring is toothless against exactly the edit it is meant to catch. Probed on this
    // file: delete the `<AnchoredRegexBuilder …/>` render and keep the import, and the plain
    // string `AnchoredRegexBuilder` still matches — the module path inside the import line
    // supplies it all on its own, which is trap 1 from this file's own header, one level down.
    //
    // The honesty rule is asserted by name rather than by counting cards: a gate whose verdict
    // the repository does not record must render UNRUN, so the hand-written UNRECORDED_GATES list
    // and the ❔ that must never be traded for a friendlier glyph are both pinned. A card-count
    // assertion stays green through precisely the edit that upgrades an unverified state.
    //
    // No `captures` column, deliberately — matching every row here except the Windows terminal
    // profiles one. docs/assets/shots/capture-manifest.json does record `app-status-surface`, but
    // its method is plain CDP against the unpackaged out/ build, which is the exact route that
    // row's pending reason says cannot stand as packaged headless capture evidence.
    id: 'status-surface',
    label: 'Status surface (project gates + recorded evidence)',
    files: [
      'src/renderer/components/StatusSurface.tsx',
      'src/shared/project-status.ts',
    ],
    contentChecks: [
      ['src/renderer/components/StatusSurface.tsx', 'export function StatusSurface('],
      ['src/shared/project-status.ts', 'export function buildProjectStatus('],
      // Malformed evidence is never half-parsed into a friendlier verdict.
      ['src/shared/project-status.ts', 'export function parseCaptureManifest('],
      // The gates nobody records a verdict for are UNRUN by construction, and the emoji beside a
      // state is scanability, never authority.
      ['src/shared/project-status.ts', 'export const UNRECORDED_GATES:'],
      ['src/shared/project-status.ts', "unrun: { emoji: '❔', label: 'Unrun' }"],
      // The card search is a real search bar, so it carries its own anchored builder like every
      // other one in the app. Anchored to the RENDER, not the import — see the note above.
      ['src/renderer/components/StatusSurface.tsx', /^\s*<AnchoredRegexBuilder /m],
      // Reachable as a rail destination: a surface no destination opens is invisible to a user,
      // which is the same as absent. `id: 'status',` occurs exactly once in Canvas.tsx. No `$`
      // anchor — every file in this tree is CRLF, so a trailing anchor matches nothing while
      // looking perfectly correct.
      ['src/renderer/canvas/Canvas.tsx', /^\s*id: 'status',/m],
    ],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'StatusSurface' },
    tests: [
      ['src/shared/project-status.test.ts', "describe('buildProjectStatus'"],
      ['src/renderer/components/status/StatusSurface.test.tsx', "describe('StatusSurface'"],
    ],
    docs: [
      ['docs/status-surface.md', '## Verification'],
      // One needle per LINE — the article is CRLF and wraps at ~100 columns, so a needle that
      // spans the wrap matches nothing.
      ['docs/status-surface.md', 'A check that has not run is UNRUN, not passed.'],
    ],
  },
  {
    id: 'changelog-viewer',
    label: 'Changelog viewer (third History tab)',
    files: [
      'src/shared/changelog.ts',
      'src/shared/changelog-data.ts',
      'scripts/build-changelog.mjs',
      'scripts/check-changelog.mjs',
      'src/renderer/components/changelog/ChangelogPanel.tsx',
      'src/renderer/components/changelog/ReleaseCard.tsx',
      'src/renderer/components/HistoryScreen.tsx',
    ],
    contentChecks: [
      ['src/shared/changelog.ts', 'export function parseChangelog'],
      ['src/shared/changelog-data.ts', 'export const CHANGELOG_RELEASES'],
      ['scripts/check-changelog.mjs', 'renderChangelogModule'],
      ['src/renderer/components/changelog/ChangelogPanel.tsx', 'export function ChangelogPanel'],
    ],
    wired: { file: 'src/renderer/components/HistoryScreen.tsx', symbol: 'ChangelogPanel' },
    tests: [['src/shared/changelog.test.ts', "describe('parseChangelog'"]],
    docs: ['docs/changelog-viewer.md'],
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
    id: 'minecraft-server-manager',
    label: 'Local Minecraft server create-and-manage',
    files: [
      'src/renderer/components/minecraft/MinecraftServerPanel.tsx',
      'src/core/minecraft/server-manager.ts',
      'src/core/minecraft/version-resolve.ts',
      'src/core/minecraft/java.ts',
      'src/core/minecraft/register-ipc.ts',
    ],
    contentChecks: [
      ['src/renderer/components/minecraft/MinecraftServerPanel.tsx', 'export function MinecraftServerPanel'],
      ['src/core/minecraft/server-manager.ts', 'export class MinecraftServerManager'],
      // The EULA is only ever accepted by the user's own explicit call — never by create().
      ['src/core/minecraft/server-manager.ts', 'eulaFileContent(false)'],
    ],
    wired: { file: 'src/renderer/nodes/ServiceNode.tsx', symbol: 'MinecraftServerPanel' },
    docs: ['docs/minecraft-server-manager.md'],
  },
  {
    id: 'cloudflare-tunnel-wizard',
    label: 'One-click Cloudflare Tunnel wizard',
    files: [
      'src/shared/cloudflare-tunnel.ts',
      'src/core/cloudflare/tunnel-service.ts',
      'src/core/cloudflare/register-ipc.ts',
      'src/main/cloudflare-runtime.ts',
      'src/renderer/nodes/CloudflareTunnelNode.tsx',
    ],
    contentChecks: [
      ['src/core/cloudflare/tunnel-service.ts', 'ensureDenyFirstAccess('],
      ['src/core/cloudflare/tunnel-service.ts', 'rollbackInternal('],
      ['src/main/cloudflare-runtime.ts', 'CONNECTOR_IMAGE ='],
      ['src/renderer/nodes/CloudflareTunnelNode.tsx', 'Run preflight'],
    ],
    wired: { file: 'src/renderer/canvas/Canvas.tsx', symbol: 'CloudflareTunnelNode' },
    docs: ['docs/features/remote/cloudflare-tunnel.md'],
    tests: [],
    focusedTests: [],
    localizedCopy: { status: 'pending', reason: 'Ultra-speed lane did not add focused localization evidence.' },
    builtArtifactInteraction: { status: 'pending', reason: 'Ultra-speed lane did not run built-artifact interaction.' },
    captures: { status: 'pending', reason: 'Ultra-speed lane did not capture the new surface.' },
  },
  {
    id: 'adhd-modes',
    label: 'ADHD modes',
    docs: ['docs/adhd-modes.md'],
    files: [
      'src/renderer/lib/adhdModes.ts',
      'src/renderer/lib/adhdModes.test.ts',
      'src/renderer/lib/adhdNotify.ts',
      'src/renderer/lib/adhdNotify.test.ts',
      'src/renderer/lib/nodeActivity.ts',
      'src/renderer/components/AdhdNodeSurfaces.tsx',
      'src/renderer/components/AdhdNodeSurfaces.test.tsx',
      'src/renderer/components/settings/sections/AdhdModesSection.tsx'
    ],
    contentChecks: [
      // Five INDEPENDENT modes. A master switch would defeat the whole design, so each one is
      // named here: losing any single field is a red row rather than a quietly smaller feature.
      ['src/renderer/lib/adhdModes.ts', /focus:\s*false/],
      ['src/renderer/lib/adhdModes.ts', /lowStimulation:\s*false/],
      ['src/renderer/lib/adhdModes.ts', /timeAwareness:\s*false/],
      ['src/renderer/lib/adhdModes.ts', /oneThing:\s*false/],
      ['src/renderer/lib/adhdModes.ts', /momentum:\s*false/],
      // FOCUS DIMS, IT NEVER HIDES — the cap is that rule as a number.
      ['src/renderer/lib/adhdModes.ts', 'export const FOCUS_DIM_MAX'],
      // Low stimulation must never silence a notification that costs real work to miss.
      ['src/renderer/lib/adhdModes.ts', 'export function allowsNotification'],
      // Hand-editable settings.json reaches a CSS opacity and a timer comparison.
      ['src/renderer/lib/adhdModes.ts', 'export function normalizeAdhdModes'],
      // The section must actually be registered and rendered, not merely written.
      ['src/renderer/components/settings/nav.ts', "id: 'adhd-modes'"],
      ['src/renderer/components/settings/SettingsPage.tsx', /^\s*<AdhdModesSection isActive=/m],
      // Published on <html> by App, or none of the CSS applies.
      ['src/renderer/App.tsx', /^\s*const modes = normalizeAdhdModes\(adhdModes\)/m],
      // Not medical, said on the surface rather than only in the docs.
      ['src/renderer/components/settings/sections/AdhdModesSection.tsx', 'not a diagnosis'],
      // WIRED, not merely decided. Two of these modes shipped as switches connected to nothing:
      // the decision functions existed, the CSS was finished, and the renderer between them was
      // never written, so the docs described behaviour no code executed. Every needle below carries
      // a delimiter (`(`, `<`, `/>`) so a rename or a commented-out line cannot satisfy it.
      //
      // Time awareness renders where the work is — on the node, and in the card modal, which is the
      // same live session seen twice.
      ['src/renderer/nodes/TerminalNode.tsx', '<AdhdElapsedChip nodeId={id} />'],
      ['src/renderer/components/kanban/CardModal.tsx', '<AdhdElapsedChip nodeId={session.id} />'],
      // Momentum reaches a render, and its "not now" writes a real timestamp.
      ['src/renderer/nodes/TerminalNode.tsx', '<AdhdMomentumNote nodeId={id} />'],
      ['src/renderer/components/AdhdNodeSurfaces.tsx', 'momentumNudge('],
      ['src/renderer/components/AdhdNodeSurfaces.tsx', 'snoozeUntil('],
      // ONE shared minute ticker for the whole canvas, fed by the PTY data path.
      ['src/renderer/lib/nodeActivity.ts', 'export function subscribeActivityTick'],
      ['src/renderer/nodes/TerminalNode.tsx', 'markNodeActivity(id)'],
      // Low stimulation's notification half: Canvas raises notifications through the funnel that
      // applies allowsNotification(), never the raw store push.
      ['src/renderer/canvas/Canvas.tsx', /^import \{ notify \} from '\.\.\/lib\/adhdNotify'$/m],
      ['src/renderer/lib/adhdNotify.ts', 'allowsNotification('],
      // …and the OS notification for a blocked agent is gated on the kind the call site already
      // carries, so 'needs-you' is threaded through rather than re-decided.
      ['src/renderer/canvas/Canvas.tsx', /sound === 'needsYou' \? 'needs-you' : 'done'/],
      // A quietable info/success notification must be reachable without an OS dialog, or low
      // stimulation's quieted state can never be captured.
      ['src/renderer/canvas/Canvas.tsx', "id: 'show-test-notification'"],
      // A quieted delivery must render distinguishably from an ordinary user dismissal — both set
      // dismissedAt, so the field that actually separates them is the one to look for here.
      ['src/renderer/state/notifications.ts', /deliveredSilently: input\.silent === true/],
      ['src/renderer/components/NotificationCenter.tsx', "n.deliveredSilently ? ' quieted' : ''"]
    ]
  },
  {
    // Kids mode. The needles carry delimiters for the usual reason, and the BOTH-SHELLS rows are
    // the important ones: this repo has shipped a one-shell core change three times, and the
    // boundary tests cannot tell you a feature is missing from the other shell — only that what
    // is there compiles.
    id: 'kids-mode',
    label: 'Kids mode (separate from School mode)',
    files: [
      'src/core/kids-mode.ts',
      'src/shared/kids-mode-policy.ts',
      'src/core/kids-mode.test.ts',
      'src/shared/kids-mode-policy.test.ts',
      'src/renderer/state/kidsMode.ts',
      'src/shared/kids-mode-name.ts'
    ],
    contentChecks: [
      ['src/core/kids-mode.ts', /^export class KidsModeStore \{/m],
      // The honesty line is the reason this feature is defensible at all.
      ['src/shared/kids-mode-policy.ts', /^export const KIDS_DISCLOSURE =/m],
      ['src/shared/kids-mode-policy.ts', 'does NOT sandbox'],
      // bypassPermissions must stay refused, and the refusal must carry a reason.
      ['src/shared/kids-mode-policy.ts', 'bypassPermissions:'],
      // Separate files from School mode — a shared one would let either PIN open both.
      ['src/core/kids-mode.ts', "'kids-mode.json'"],
      ['src/core/kids-mode.ts', "'kids-mode.credential.json'"],
      // Booted by BOTH shells, or the Server Edition silently lacks the feature.
      //
      // LINE-ANCHORED regexes, not substrings. Commenting a call out leaves the substring
      // perfectly intact, so `// kidsModeStore.registerIpc()` sailed past the plain-string
      // version of these two rows — verified by doing exactly that and watching the guard stay
      // green. Commenting out is how a wiring line actually dies.
      ['src/main/index.ts', /^\s*kidsModeStore\.registerIpc\(\)/m],
      ['src/server/index.ts', /^\s*kidsModeStore\.registerIpc\(\)/m],
      ['src/main/index.ts', /^\s*await kidsModeStore\.init\(\)/m],
      ['src/server/index.ts', /^\s*await kidsModeStore\.init\(\)/m],
      // A real bridge implementation, not a stub.
      ['src/renderer/bridge/ws-bridge.ts', /^\s*const kidsMode: KidsModeApi = \{/m],
      ['src/renderer/App.tsx', /^\s*void useKidsMode\.getState\(\)\.init\(\)/m],
      // The disclosure is RENDERED from the shared constant, not retyped. A second copy of that
      // wording is one edit away from promising more than the mode delivers.
      //
      // These four were left as bare substrings when the two registerIpc rows above were anchored,
      // and the comment three lines up already spelled out why that is unsafe. Commenting out the
      // real Settings render of {KIDS_DISCLOSURE} — the honesty line, on the surface where a
      // parent enables the mode — left this whole scan green. Watched, on this file. Anchoring one
      // pair and leaving its neighbours is how the same trap survives its own fix.
      ['src/renderer/components/settings/sections/KidsModeSection.tsx', /^\s*<p className="md3-kids-disclosure[^"]*">\{KIDS_DISCLOSURE\}<\/p>/m],
      ['src/renderer/components/settings/SettingsPage.tsx', /^\s*<KidsModeSection isActive=/m]
    ],
    // Asserts the section is reachable from a VISIBLE settings group and has a sidebar icon — a
    // section file on disk that no group lists is invisible to a user, which is the same as absent.
    settingsSection: 'kids-mode',
    docs: ['docs/kids-mode.md'],
  },
  {
    // The unlock ladder. Asserted on the two things that would silently gut it: the ladder's own
    // module, and the fact that the server actually SERVES it — a ladder nobody can reach from a
    // lockout screen is a passing unit test and a countdown the user still has to stare at.
    id: 'unlock-ladder',
    label: 'Unlock ladder (dim sum, sums, whack-a-mole)',
    files: [
      'src/core/unlock-ladder.ts',
      'src/core/unlock-ladder.test.ts',
      'src/server/auth.test.ts',
      'src/server/unlock-ladder-routes.test.ts',
    ],
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
      ['src/core/unlock-ladder.ts', 'export const MAX_LADDER_CHALLENGES_GLOBAL ='],
      ['src/server/auth.ts', 'budget: this.ladderBudget,'],
      ['src/server/auth.ts', 'challengeBudget: this.ladderChallengeBudget,'],
      // Clearing the ladder must reach exactly this method and no other — see its doc comment.
      // Asserted at the DEFINITION and the CALL, because either half alone is dead.
      ['src/server/auth.ts', 'clearLockoutByLadder(clientKey: string = DEFAULT_CLIENT_KEY): void {'],
      ['src/server/http.ts', 'auth.clearLockoutByLadder(clientKey)'],
      ['src/server/http.ts', "pathname === '/auth/unlock/challenge'"],
      ['src/server/http.ts', "pathname === '/auth/unlock/verify'"],
      // School mode removes every dim-sum surface, so the starting rung must be decided from it.
      ['src/server/index.ts', 'auth.setSchoolModeSource('],
      ['src/core/unlock-ladder.ts', 'firstRung(): LadderRung {'],
      // Defined AND called: the lockout screen is what makes the ladder reachable, and a
      // `lockedPage` that exists but is never served is a countdown with a dead function beside
      // it. Asserting the call site rather than an import, since it lives in the same file.
      ['src/server/http.ts', 'lockedPage(auth.lockoutRemainingMs(clientKey)'],
    ],
    docs: ['docs/unlock-ladder.md'],
  },
  {
    // The extracted MD3 component library — one definition per shape (button, chip, menu
    // surface, …) instead of the same recipe re-authored per feature lane. See the doc for why
    // `mdx-` and not `md3-`, and which pieces reuse an already-shipped class instead of a new one.
    id: 'md3-primitives',
    label: 'MD3 shared primitive components',
    files: [
      'src/renderer/ui/md3/index.ts',
      'src/renderer/ui/md3/primitives.css',
      'src/renderer/ui/md3/Button.tsx',
      'src/renderer/ui/md3/IconButton.tsx',
      'src/renderer/ui/md3/Fab.tsx',
      'src/renderer/ui/md3/Switch.tsx',
      'src/renderer/ui/md3/TextField.tsx',
      'src/renderer/ui/md3/Chip.tsx',
      'src/renderer/ui/md3/StatusChip.tsx',
      'src/renderer/ui/md3/Card.tsx',
      'src/renderer/ui/md3/ListRow.tsx',
      'src/renderer/ui/md3/Menu.tsx',
      'src/renderer/ui/md3/Dialog.tsx',
      'src/renderer/ui/md3/Badge.tsx',
      'src/renderer/ui/md3/SegmentedButton.tsx',
      'src/renderer/ui/md3/Divider.tsx',
    ],
    contentChecks: [
      ['src/renderer/ui/md3/Button.tsx', 'export const Button = forwardRef<'],
      ['src/renderer/ui/md3/Switch.tsx', "export { Switch } from '../Switch'"],
      ['src/renderer/ui/SegmentedPill.tsx', "export { SegmentedButton as SegmentedPill } from './md3/SegmentedButton'"],
    ],
    docs: ['docs/md3-primitives.md'],
  },
]

// A feature-row check is only fail-closed if removing the whole row, or one of its required
// evidence columns, is an error. Keep this list independent of the row itself: deriving the
// requirements from FEATURES would make a deleted field disappear from both the product and the
// checklist that was supposed to notice it.
const REQUIRED_EXACT_FEATURE_BOUNDARIES = new Map([
  ['windows-terminal-profiles', [
    'implementation',
    'docs',
    'localizedCopy',
    'persistence',
    'focusedTests',
    'builtArtifactInteraction',
    'captures',
  ]],
])

function exactFeatureBoundaryFailures(features) {
  const errors = []
  for (const [id, fields] of REQUIRED_EXACT_FEATURE_BOUNDARIES) {
    const rows = features.filter((feature) => feature.id === id)
    if (rows.length !== 1) {
      errors.push(`${id}: expected exactly one feature row, found ${rows.length}`)
      continue
    }
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(rows[0], field) || rows[0][field] == null) {
        errors.push(`${id}: missing exact evidence boundary ${field}`)
      }
    }
  }
  return errors
}

function checkExactFeatureBoundaries() {
  checkedCount += 1
  const liveErrors = exactFeatureBoundaryFailures(FEATURES)
  if (liveErrors.length > 0) {
    fail(`Exact feature inventory boundary: ${liveErrors.join('; ')}`)
  } else {
    pass('Exact feature inventory boundary: every required row and evidence column is present exactly once')
  }

  // Executable negative mutation self-test: remove the row, then each exact evidence column in
  // memory. Every mutant must be rejected by the same validator used above. This proves the guard
  // does not merely congratulate the fields it happened to discover in the live row.
  const escapedMutants = []
  for (const [id, fields] of REQUIRED_EXACT_FEATURE_BOUNDARIES) {
    const withoutRow = FEATURES.filter((feature) => feature.id !== id)
    if (exactFeatureBoundaryFailures(withoutRow).length === 0) escapedMutants.push(`${id}:row`)

    for (const field of fields) {
      const withoutField = FEATURES.map((feature) => {
        if (feature.id !== id) return feature
        const mutant = { ...feature }
        delete mutant[field]
        return mutant
      })
      if (exactFeatureBoundaryFailures(withoutField).length === 0) {
        escapedMutants.push(`${id}:${field}`)
      }
    }
  }

  checkedCount += 1
  if (escapedMutants.length > 0) {
    fail(`Exact feature inventory negative self-test: mutant(s) escaped: ${escapedMutants.join(', ')}`)
  } else {
    pass('Exact feature inventory negative self-test: removing every required row/column is rejected')
  }
}

function requireFocusedTests(tests, label) {
  for (const [file, needle] of tests || []) {
    const ok = requireFileExists(file, `${label}: focused behavioural test`)
    if (ok) {
      requireFileContains(file, needle, `${label}: focused behavioural test keeps its exact suite boundary`)
    }
  }
}

function requireEvidenceStatus(evidence, label) {
  checkedCount += 1
  if (!evidence || evidence.status !== 'verified') {
    const state = evidence?.status || 'missing'
    const reason = evidence?.reason ? ` — ${evidence.reason}` : ''
    fail(`${label}: ${state}${reason}`)
    return false
  }
  pass(`${label}: verified evidence is registered`)
  for (const file of evidence.files || []) requireFileExists(file, label)
  for (const [file, needle] of evidence.contentChecks || []) requireFileContains(file, needle, label)
  requireFocusedTests(evidence.tests, label)
  return true
}

function requireCaptureEvidence(evidence, label) {
  if (!requireEvidenceStatus(evidence, label)) return
  const manifestPath = evidence.manifest
  const manifestText = manifestPath ? readText(manifestPath) : null
  checkedCount += 1
  if (manifestText == null) {
    fail(`${label}: cannot read capture manifest ${manifestPath || '(missing path)'}`)
    return
  }

  let manifest
  try {
    manifest = JSON.parse(manifestText)
  } catch (_err) {
    fail(`${label}: ${manifestPath} is not valid JSON`)
    return
  }

  const capturedIds = new Set(
    Array.isArray(manifest.captured)
      ? manifest.captured.map((entry) => entry?.id).filter((id) => typeof id === 'string')
      : [],
  )
  const missingIds = (evidence.requiredIds || []).filter((id) => !capturedIds.has(id))
  const methodMatches = typeof manifest.method === 'string'
    && manifest.method.includes(evidence.methodNeedle || 'cheap Lowlevel MCP headless')
  if (missingIds.length > 0 || !methodMatches) {
    const problems = []
    if (missingIds.length > 0) problems.push(`missing exact capture id(s): ${missingIds.join(', ')}`)
    if (!methodMatches) problems.push(`method does not name ${evidence.methodNeedle || 'cheap Lowlevel MCP headless'}`)
    fail(`${label}: ${problems.join('; ')}`)
  } else {
    pass(`${label}: required exact capture ids and cheap headless method are recorded`)
  }

  // The manifest is a CLAIM about files. Verify the files.
  //
  // Caught by breaking it: with the row freshly flipped to `verified`, deleting a promoted PNG
  // outright left this check completely green, because it only ever read ids and a method string
  // out of the JSON. A manifest asserting captures that are not on disk is precisely the
  // decorative evidence this whole row exists to refuse, and it would have shipped as "verified".
  //
  // promote-packaged-captures.mjs already checks all of this at promotion time — but promotion
  // happens once and the tree lives on, so a later delete, a truncation or a corrupt copy would
  // go unnoticed forever. Re-checking here costs five file reads.
  const manifestDir = manifestPath.split('/').slice(0, -1).join('/')
  for (const entry of Array.isArray(manifest.captured) ? manifest.captured : []) {
    if (!entry || typeof entry.id !== 'string') continue
    if (!(evidence.requiredIds || []).includes(entry.id)) continue
    checkedCount += 1
    const rel = `${manifestDir}/packaged/${String(entry.file || '').split('/').pop()}`
    let bytes = null
    try {
      bytes = readFileSync(join(REPO_ROOT, rel))
    } catch {
      fail(`${label}: ${entry.id} claims ${rel}, which cannot be read`)
      continue
    }
    // Real PNG signature, not merely a file with the right extension.
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(signature)) {
      fail(`${label}: ${entry.id} at ${rel} is not a PNG`)
      continue
    }
    // A blank or near-blank frame is the failure mode a screenshot harness produces when it
    // photographs the wrong thing, so the floor is a real assertion rather than a formality.
    if (bytes.length < 6000) {
      fail(`${label}: ${entry.id} at ${rel} is ${bytes.length} bytes — below the blank-frame floor`)
      continue
    }
    if (typeof entry.sha256 === 'string' && entry.sha256) {
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== entry.sha256) {
        fail(`${label}: ${entry.id} at ${rel} does not match its recorded sha256`)
      }
    }
  }
}

checkExactFeatureBoundaries()

for (const feature of FEATURES) {
  const implementationFiles = [...(feature.files || []), ...(feature.implementation?.files || [])]
  const implementationChecks = [
    ...(feature.contentChecks || []),
    ...(feature.implementation?.contentChecks || []),
  ]
  for (const file of implementationFiles) {
    requireFileExists(file, feature.label)
  }
  for (const [file, needle] of implementationChecks) {
    requireFileContains(file, needle, feature.label)
  }
  requireFocusedTests(feature.tests, feature.label)
  requireFocusedTests(feature.focusedTests, feature.label)
  if (feature.persistence) {
    for (const file of feature.persistence.files || []) {
      requireFileExists(file, `${feature.label}: persistence`)
    }
    for (const [file, needle] of feature.persistence.contentChecks || []) {
      requireFileContains(file, needle, `${feature.label}: persistence`)
    }
    requireFocusedTests(feature.persistence.tests, `${feature.label}: persistence`)
  }
  if (Object.prototype.hasOwnProperty.call(feature, 'localizedCopy')) {
    requireEvidenceStatus(feature.localizedCopy, `${feature.label}: localized copy`)
  }
  if (Object.prototype.hasOwnProperty.call(feature, 'builtArtifactInteraction')) {
    requireEvidenceStatus(feature.builtArtifactInteraction, `${feature.label}: built-artifact interaction`)
  }
  if (Object.prototype.hasOwnProperty.call(feature, 'captures')) {
    requireCaptureEvidence(feature.captures, `${feature.label}: real capture evidence`)
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
      if (text == null) return false
      const { executableSource } = sourceWithoutImportsAndComments(text)
      return new RegExp(`\\b${symbol}\\b`).test(executableSource)
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
// Material Design 3 token foundation (src/renderer/styles.css) — CLAUDE.md
// requires the app to conform fully to M3, with zero legacy/original design
// elements remaining. This checks three ways that exact foundation can
// regress WITHOUT the build noticing:
//
//   1. No CDN font/icon link anywhere under src/renderer. The renderer's
//      CSP is `font-src 'self' data:` (src/renderer/index.html) — a <link>
//      or `@import` pulling a font/icon face from an external host does not
//      error, it is SILENTLY blocked: system font fallback, tofu glyphs
//      where icons should be. Nothing in the source would look wrong; only
//      the running app would, and only to someone looking at it.
//   2. The stylesheet actually DEFINES the hand-written inventory of M3
//      colour/shape roles — not merely that a comment says it intends to.
//   3. Those roles are defined for BOTH themes. The dark defaults live on
//      bare `:root`; a role whose value does not auto-theme (a literal
//      hex/rgba rather than an alias onto an already-theming token, or a
//      pure `--tint-rgb` mix) has to be independently restated under
//      `:root[data-theme='light']`, or a light-mode user silently keeps
//      the dark value forever — no error, no difference in the dark
//      theme, just a wrong colour nobody notices until someone switches
//      themes and knows what to look for.
//   4. `data-md-theme` (the imported design file's own selector) never
//      appears in styles.css — this app's theme switch has always been
//      `data-theme` (App.tsx / lib/appTheme.ts), and every existing rule
//      in the sheet, M3 block included, keys off it. A stray
//      `data-md-theme` rule copied in from the design defines tokens
//      nobody's <html> attribute will ever match: no build error, no
//      runtime error, just a light theme that silently keeps rendering
//      the dark M3 values forever.
//
// This deliberately duplicates part of what
// src/renderer/styles.theme.test.ts's "Material 3 token foundation" +
// "the theme selector uses this app's convention" describe blocks already
// check — that is a vitest suite (`npm test`), this is a zero-dependency
// script anyone can run standalone (`node scripts/check-app-contract.mjs`)
// without a test runner. Two independent checks of the same fact, in two
// different tools, is the point — see this file's own header on why a
// guard that only validates what it already expects to find is worthless.
//
// EVERY needle below carries a delimiter its own name cannot supply — a
// trailing `:` immediately after the property name, which every CSS custom
// property declaration has. Without it `--md-primary` would match happily
// inside `--md-primary-container`, exactly the "renamed/removed symbol
// still matches" trap this file's own header (the requireWiredSymbol
// comment above) already warns about.
// ---------------------------------------------------------------------

const STYLES_FILE = 'src/renderer/styles.css'

function listRendererFiles(dir) {
  const out = []
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...listRendererFiles(rel))
    } else if (/\.(html|css|ts|tsx|js|jsx)$/i.test(entry.name)) {
      out.push(rel)
    }
  }
  return out
}
const RENDERER_FILES = listRendererFiles('src/renderer')

// --- 1. No CDN font/icon link -------------------------------------------
const FORBIDDEN_FONT_ICON_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'fonts.google.com',
  'use.typekit.net',
  'use.fontawesome.com',
  'fontawesome.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
]
// A <link> whose href is external, or an @import pulling from one — the two
// shapes that actually load a stylesheet/font-face over the network, as
// opposed to a plain string mentioning a host in passing.
const EXTERNAL_LINK_RE = /<link\b[^>]*\bhref\s*=\s*['"]https?:\/\//i
const EXTERNAL_IMPORT_RE = /@import\s+(?:url\()?['"]?https?:\/\//i
const cdnHits = []
for (const file of RENDERER_FILES) {
  const text = readText(file) || ''
  for (const host of FORBIDDEN_FONT_ICON_HOSTS) {
    if (text.includes(host)) cdnHits.push(`${file}: references ${host}`)
  }
  if (EXTERNAL_LINK_RE.test(text)) cdnHits.push(`${file}: <link> with an external href`)
  if (EXTERNAL_IMPORT_RE.test(text)) cdnHits.push(`${file}: @import from an external URL`)
}
checkedCount += 1
if (cdnHits.length > 0) {
  fail(
    `M3 foundation: found ${cdnHits.length} CDN font/icon reference(s) under src/renderer — the CSP (font-src 'self' data:) blocks these SILENTLY at runtime, with no build error:`,
  )
  for (const hit of cdnHits) console.error(`    - ${hit}`)
} else {
  pass(`M3 foundation: no CDN font/icon link found across ${RENDERER_FILES.length} scanned files under src/renderer`)
}

// --- 2 & 3. M3 roles defined, and defined for both themes ---------------
// Same block-boundary extraction as styles.theme.test.ts, CRLF guard
// included: this file is CRLF on a Windows checkout with core.autocrlf=true,
// so a literal '\n}\n' search silently returns -1 and slices the wrong
// text (or an empty tail) with no error. `\r?` matches the LF-only case
// identically, so this is not a platform branch — it is the version of the
// search that is correct on both platforms.
const stylesText = readText(STYLES_FILE) || ''
const lightStartMatch = /^:root\[data-theme=['"]light['"]\]\s*\{/m.exec(stylesText)
const darkBlockStart = stylesText.indexOf(':root {')
const darkBlock =
  lightStartMatch && darkBlockStart !== -1 ? stylesText.slice(darkBlockStart, lightStartMatch.index) : ''
let lightBlock = ''
if (lightStartMatch) {
  const closeMatch = /\r?\n\}\r?\n/.exec(stylesText.slice(lightStartMatch.index))
  if (closeMatch) {
    lightBlock = stylesText.slice(lightStartMatch.index, lightStartMatch.index + closeMatch.index + closeMatch[0].length)
  }
}

// Hand-written on purpose — a role dropped from the sheet entirely is
// exactly the case a scan-and-check approach can't see, because it would
// just stop finding the name and never flag its absence. Mirrors the
// inventory in styles.theme.test.ts's M3_ROLES; kept as an independent
// hand-typed list rather than imported, so the two checks cannot both go
// blind to the same accidental deletion at once.
//
// Extended (2026-08, the M3-baseline re-seed) with the eight roles
// design/v2/md3/tokens.css ships that the original 38-role landing did
// not: the bare `--md-surface-container` step, `--md-surface-bright`,
// the three "text/icon on a SOLID fill" pairs the app only needed on
// primary before (`--md-on-secondary`, `--md-on-tertiary`,
// `--md-on-error`), and the inverse triad.
const M3_ROLES = [
  '--md-surface-container-lowest',
  '--md-surface-dim',
  '--md-surface-bright',
  '--md-surface-container-low',
  '--md-surface',
  '--md-surface-container',
  '--md-surface-container-high',
  '--md-surface-container-highest',
  '--md-on-surface',
  '--md-on-surface-variant',
  '--md-outline-variant',
  '--md-outline',
  '--md-primary',
  '--md-on-primary',
  '--md-primary-container',
  '--md-on-primary-container',
  '--md-secondary',
  '--md-on-secondary',
  '--md-secondary-container',
  '--md-on-secondary-container',
  '--md-tertiary',
  '--md-on-tertiary',
  '--md-tertiary-container',
  '--md-on-tertiary-container',
  '--md-error',
  '--md-on-error',
  '--md-error-container',
  '--md-on-error-container',
  '--md-success',
  '--md-success-container',
  '--md-on-success-container',
  '--md-warning',
  '--md-warning-container',
  '--md-on-warning-container',
  '--md-inverse-surface',
  '--md-inverse-on-surface',
  '--md-inverse-primary',
  '--md-scrim',
  '--md-shadow',
  '--md-shape-none',
  '--md-shape-extra-small',
  '--md-shape-small',
  '--md-shape-medium',
  '--md-shape-large',
  '--md-shape-extra-large',
  '--md-shape-full',
]

// Declared at all (value not inspected). Anchored to the START of a
// (possibly indented) line — so a role name mentioned mid-sentence in a
// comment can't count — and to an immediately following `:`, which is the
// delimiter that keeps `--md-primary` from matching inside
// `--md-primary-container` (see this section's header comment).
function declaredIn(block, name) {
  return new RegExp(`^\\s*${name}\\s*:`, 'm').test(block)
}

checkedCount += 1
const missingFromDark = M3_ROLES.filter((name) => !declaredIn(darkBlock, name))
if (missingFromDark.length > 0) {
  fail(`M3 foundation: role(s) missing from the dark :root block in ${STYLES_FILE}: ${missingFromDark.join(', ')}`)
} else {
  pass(`M3 foundation: all ${M3_ROLES.length} M3 roles declared in the dark :root block of ${STYLES_FILE}`)
}

checkedCount += 1
const brokenForLight = []
for (const name of M3_ROLES) {
  if (declaredIn(lightBlock, name)) continue // restated for light directly
  const declMatch = new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, 'm').exec(darkBlock)
  if (!declMatch) {
    brokenForLight.push(name) // no dark declaration either — also caught above
    continue
  }
  const value = declMatch[1].trim()
  const isAlias = /^var\(--[a-z0-9-]+\)$/i.test(value)
  const isTintMix = /^rgba?\(\s*var\(--tint-rgb\)[^)]*\)$/.test(value)
  if (!isAlias && !isTintMix) brokenForLight.push(name)
}
if (brokenForLight.length > 0) {
  fail(
    `M3 foundation: role(s) not defined for the light theme in ${STYLES_FILE} — neither restated under :root[data-theme='light'], nor an alias/--tint-rgb mix that auto-flips with it: ${brokenForLight.join(', ')}`,
  )
} else {
  pass(`M3 foundation: all ${M3_ROLES.length} M3 roles are defined for both themes (restated, alias, or a --tint-rgb mix) in ${STYLES_FILE}`)
}

// --- 4. The design file's selector must never appear --------------------
// Scoped to styles.css alone, deliberately: styles.theme.test.ts's own test
// for this fact necessarily contains the literal string 'data-md-theme' in
// its source (to assert the CSS does NOT contain it) — scanning the whole
// src/renderer tree would make that correct, passing test file a permanent
// false failure of this exact check.
checkedCount += 1
if (stylesText.includes('data-md-theme')) {
  fail(`M3 foundation: 'data-md-theme' (the design file's selector, not this app's) found in ${STYLES_FILE} — this app's theme switch is 'data-theme'`)
} else {
  pass(`M3 foundation: 'data-md-theme' does not appear in ${STYLES_FILE} (this app uses 'data-theme')`)
}


// ---------------------------------------------------------------------
// The stylesheet is structurally sound.
// ---------------------------------------------------------------------
//
// Cheap, and it catches a class of damage that every other signal misses. A dangling `*/` left by
// an edit that replaced one line of a two-line comment broke the stylesheet outright — and tsc was
// clean, 5,142 tests passed, and this guard was green over it, because none of them parse CSS.
// Only `npm run build` failed, ~40 seconds later.
//
// These three checks take milliseconds and fail on exactly that, so the feedback arrives before a
// build does. They do not replace the build; they front-run it.
{
  const cssPath = 'src/renderer/styles.css'
  const css = readText(cssPath)
  checkedCount += 1
  if (css == null) {
    fail(`Stylesheet: cannot read ${cssPath}`)
  } else {
    const opens = (css.match(/\/\*/g) || []).length
    const closes = (css.match(/\*\//g) || []).length
    const braceOpen = (css.match(/\{/g) || []).length
    const braceClose = (css.match(/\}/g) || []).length
    // Strip complete comments, then any surviving terminator is an orphan.
    const stray = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\*\//g) || []).length
    const problems = []
    if (opens !== closes) problems.push(`${opens} \`/*\` vs ${closes} \`*/\``)
    if (stray > 0) problems.push(`${stray} dangling \`*/\` outside any comment`)
    if (braceOpen !== braceClose) problems.push(`${braceOpen} \`{\` vs ${braceClose} \`}\``)
    if (problems.length) {
      fail(`Stylesheet is structurally broken (${problems.join('; ')}) — it will fail the build, which is the only other thing that would notice`)
    } else {
      pass(`Stylesheet: ${opens} comments and ${braceOpen} rules all balanced, no dangling terminators`)
    }
  }
}

// ---------------------------------------------------------------------
// The inventory's OWN completeness
// ---------------------------------------------------------------------
//
// Everything above checks that each listed feature is present. Nothing checked that the LIST is
// complete — and it was not: dim-sum (named in the shared instructions as mandatory and not
// opt-out-able), session memory, team presence, the notch HUD and the agent mascots all had code,
// a doc, and no row. The guard passed the whole time, because a list that only validates what it
// already knows about cannot notice what nobody added to it. That is the failure this file's own
// header warns about, one level up.
//
// So: every `docs/*.md` must either be referenced by a feature row, or be named below as
// deliberately not a feature contract, WITH a reason. A new feature doc goes red until someone
// decides which it is. That is the whole mechanism — it cannot spot a feature that has no doc
// either, but this project documents features as it ships them, so a doc is the earliest artifact
// a scan can catch.
const NON_FEATURE_DOCS = new Map([
  ['downstream-fork-report.md', 'a point-in-time comparison against upstream, not a shipped surface'],
  ['fork-vs-upstream.md', 'a point-in-time comparison against upstream, not a shipped surface'],
  [
    'paste-frame-vendoring.md',
    'why one file is a deliberate vendored duplicate of a sibling repository — an internals note ' +
      'behind the terminal row, with its own drift guard, not a surface of its own',
  ],
  ['agent-working-conventions.md', 'contributor session-discipline guide (session-finishing passes, cleanup order), not a user-facing app surface'],
  ['app-contract.md', 'this guard\'s own documentation'],
  ['app-design-tokens.md', 'design-token reference, not a user-facing surface'],
  ['building.md', 'build process'],
  ['ci-and-releases.md', 'release process'],
  ['codex-shared-identity.md', 'agent internals — the agent-support row covers the surface'],
  ['gemini-agent.md', 'per-agent write-up — see the agent-support row'],
  ['grok-agent.md', 'per-agent write-up — see the agent-support row'],
  ['hook-reply-approvals.md', 'agent hook internals'],
  ['node-identity.md', 'agent hook credential internals'],
  ['ssh-agent-skills.md', 'agent internals on the remote-ssh surface'],
  ['shared-codex-node-identity.md', 'agent internals — the shared Codex app-server sharing/identity boundary behind the agent-support row, same class as codex-shared-identity.md'],
  ['github-issues-kanban.md', 'workflow note for maintainers, not an app surface'],
  ['md3-render-verification.md', 'a one-time built-artifact render-verification report for the MD3 rewrite, not a shipped feature with its own implementation files'],
  ['ios-protocol-migration.md', 'the mobile companion lives in a separate repo'],
  ['mobile-usage-inbox.md', 'the mobile companion lives in a separate repo'],
  ['remote-sessions.md', 'design notes behind the remote-ssh row'],
  ['site.md', 'the Pages site has its own guard: scripts/check-site-contract.mjs'],
  ['site-features.md', 'the Pages site has its own guard: scripts/check-site-contract.mjs'],
  ['troubleshooting-codex-snap.md', 'troubleshooting note'],
  ['uh-feature-inventory.md', 'the canonical-feature inventory itself — a register OF the contracts, not one of them; guarded by scripts/check-uh-inventory.mjs'],
  ['windows.md', 'platform guide for users'],
  ['windows-support.md', 'platform guide for contributors'],
  ['features/README.md', 'feature-documentation category index, not an individual feature contract'],
  ['features/agents/README.md', 'agent-feature category index; the agent-support article is inventoried separately'],
  ['features/appearance/README.md', 'appearance-documentation category index, not an individual feature contract'],
  ['features/appearance/material-3-migration-status.md', 'measured migration report and historical design analysis, not a standalone shipped feature'],
  ['features/canvas/README.md', 'canvas-feature category index; its linked feature articles are inventoried separately'],
  ['features/help/README.md', 'help-documentation category index; the offline documentation browser article is inventoried separately'],
  ['features/integrations/README.md', 'integration category index and planning status, not an individual feature contract'],
  ['features/integrations/minecraft-server.md', 'research-only constraints for an unimplemented integration, not the shipped Minecraft manager contract'],
  ['features/integrations/research-findings.md', 'research notes and implementation cautions, not a user-facing feature contract'],
  ['features/kanban/README.md', 'kanban-documentation category index; the board article is inventoried separately'],
  ['features/packaging/README.md', 'packaging-documentation category index; packaging and update behavior is inventoried separately'],
  ['features/projects/README.md', 'project-feature category index; project tabs and archives are inventoried separately'],
  ['features/remote/README.md', 'remote-feature category index; SSH, server, and Docker-host articles are inventoried separately'],
  ['features/source-control/README.md', 'source-control documentation category index; the worktree article is inventoried separately'],
  ['features/speech/README.md', 'speech-documentation category index; dictation is inventoried separately'],
  ['features/terminals/README.md', 'terminal-feature category index; continuity, profiles, and word separators are inventoried separately']
])

{
  const referenced = new Set()
  for (const f of FEATURES) for (const d of f.docs ?? []) {
    referenced.add((Array.isArray(d) ? d[0] : d).replace(/^docs\//, ''))
  }
  let docFiles = []
  try {
    docFiles = listDocsMarkdown(REPO_ROOT)
      .filter((f) => !isExcluded(f))
      .map((f) => f.replace(/^docs\//, ''))
  } catch {
    fail('Inventory completeness: cannot read docs/ — the scan below would pass vacuously')
  }
  checkedCount += 1
  if (docFiles.length < 20) {
    // A scan that finds almost nothing reports clean. Same class of silent failure as the bug.
    fail(`Inventory completeness: only ${docFiles.length} docs found — that is not the docs/ tree`)
  } else {
    const orphans = docFiles.filter((d) => !referenced.has(d) && !NON_FEATURE_DOCS.has(d))
    if (orphans.length) {
      fail(
        `Inventory completeness: ${orphans.length} doc(s) describe something with no feature row ` +
          `and no stated reason — ${orphans.join(', ')}. Add a FEATURES row, or add it to ` +
          `NON_FEATURE_DOCS with why it is not a contract.`,
      )
    } else {
      pass(
        `Inventory completeness: all ${docFiles.length} docs are either a feature row or explicitly not a contract`,
      )
    }
    // A stale exemption is its own drift: it stops anyone noticing the doc was deleted.
    checkedCount += 1
    const goneExemptions = [...NON_FEATURE_DOCS.keys()].filter((d) => !docFiles.includes(d))
    if (goneExemptions.length) {
      fail(`Inventory completeness: NON_FEATURE_DOCS names ${goneExemptions.join(', ')}, which no longer exist`)
    } else {
      pass(`Inventory completeness: no stale entries in NON_FEATURE_DOCS`)
    }
  }
}

// ---------------------------------------------------------------------
// Server Edition one-click deployment packaging (ServerDeploymentService)
//
// The bug this guards: host.bat, docker-compose.yml and Dockerfile all live at the repo root
// and were never in `build.files` or `build.extraResources`, so `startOnce()` in
// server-deployment.ts always found no host.bat in a packaged install and reported "The Server
// Edition deployment files are missing." A JSON.parse of package.json rather than a regex is
// deliberate here: `build.extraResources` is structured config, and a regex anchored on
// "server-deployment" would pass on an entry that merely mentions the string without actually
// shipping the files host.bat/docker-compose.yml/Dockerfile need.
// ---------------------------------------------------------------------
{
  let manifest = null
  try {
    manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  } catch (err) {
    fail(`Server Edition deployment packaging: cannot read/parse package.json (${err.message})`)
  }
  if (manifest) {
    checkedCount += 1
    const extraResources = Array.isArray(manifest.build?.extraResources) ? manifest.build.extraResources : []
    // Each deployment asset gets its OWN entry, and this guard asserts them one by one rather
    // than accepting a single root-scoped one.
    //
    // The first version shipped { from: '.', to: 'server-deployment', filter: [...] }, which
    // packages nothing at all: a root-scoped extraResources pattern set bleeds into the APP file
    // set, package.json stopped being packed into app.asar, and electron-builder aborted with
    // 'Application "package.json" in the ... app.asar is corrupted'. Every dist:win failed from
    // the moment that entry landed, and it was not caught because the lane that wrote it was
    // forbidden from running a build — a real cost of that constraint, recorded here.
    //
    // Explicit froms cannot reach the app file set, so the shape IS the fix, and asserting the
    // shape is what stops it coming back.
    const requiredAssets = [
      'host.bat',
      'docker-compose.yml',
      'Dockerfile',
      '.dockerignore',
      'package.json',
      'package-lock.json',
      'src'
    ]
    const rootScoped = extraResources.filter(
      (e) => e && typeof e === 'object' && (e.from === '.' || e.from === 'package.json')
    )
    if (rootScoped.length > 0) {
      fail(
        'Server Edition deployment packaging: build.extraResources contains a root-scoped ' +
          '{ from: "." } or { from: "package.json" } entry — either corrupts app.asar by dropping package.json from the app ' +
          'file set, and every dist:win fails. Give each asset its own explicit from.'
      )
    } else {
      pass('Server Edition deployment packaging: no root-scoped extraResources entry (which would corrupt app.asar)')
    }
    checkedCount += 1
    // Keyed on the DESTINATION, not the source. package.json must be shipped from a STAGED copy
    // (scripts/before-pack.cjs) rather than referenced in place — electron-builder excludes an
    // extraResources source from the app package, so naming the real package.json here deletes it
    // from app.asar. What this guard cares about is that server-deployment/<asset> arrives.
    const shipped = new Set(
      extraResources
        .filter((e) => e && typeof e === 'object' && typeof e.to === 'string' && e.to.startsWith('server-deployment/'))
        .map((e) => e.to.slice('server-deployment/'.length))
    )
    const missingAssets = requiredAssets.filter((needed) => !shipped.has(needed))
    if (missingAssets.length) {
      fail(
        'Server Edition deployment packaging: build.extraResources ships no server-deployment/ entry for ' +
          missingAssets.join(', ') +
          ' — host.bat/docker-compose.yml/Dockerfile need these, and without host.bat ' +
          'ServerDeploymentService always reports the deployment files missing'
      )
    } else {
      pass('Server Edition deployment packaging: every asset those scripts reference has its own extraResources entry')
    }
  }

  // The three files the filter above claims to ship must actually exist at the repo root, or the
  // filter entry is packaging nothing (electron-builder silently skips a from-pattern match with
  // zero hits rather than failing the build).
  for (const rel of ['host.bat', 'docker-compose.yml', 'Dockerfile', '.dockerignore']) {
    requireFileExists(rel, 'Server Edition deployment packaging')
  }

  // The writable-state redirect (docs/features/remote — a packaged install's project directory
  // is a Squirrel version folder replaced wholesale on every update, so the generated .env and
  // TOTP secret must not live beside host.bat there). Line-anchored/delimited needles so a
  // rename cannot leave a toothless substring match, per this file's own stated discipline.
  requireFileContains(
    'host.bat',
    /^if defined NODETERM_SERVER_ENV_DIR \($/m,
    'Server Edition deployment packaging (writable state)'
  )
  requireFileContains(
    'docker-compose.yml',
    /\$\{NODETERM_TOTP_SECRET_FILE_HOST:-\.\/\.nodeterm-server-totp\}/,
    'Server Edition deployment packaging (writable state)'
  )
  requireFileContains(
    'src/main/server-deployment.ts',
    /^export function resolveServerDeploymentRoot\(/m,
    'Server Edition deployment packaging (resourcesPath/repoRoot resolver)'
  )
}

// ---------------------------------------------------------------------
// The Docker build must not depend on paths .dockerignore excludes
//
// Measured drift, not a hypothetical. On 2026-07-16 .dockerignore was written excluding
// scripts/, docs/, test/ and *.md, and `npm run build` was exactly `electron-vite build` — so the
// exclusions were correct. Over the following month `build` grew four repo-hygiene prefixes
// (check-vocabulary / check-changelog / check-docs-bundle / check-uh-inventory), every one of them
// under scripts/, and check-uh-inventory additionally reads docs/uh-feature-inventory.md. Nobody
// connected the two, so the Server Edition image — its primary distribution path — could not build
// from a clean clone: `RUN npm run build` dies on its FIRST token with
// "Cannot find module '/app/scripts/check-vocabulary.mjs'".
//
// Each change was correct in isolation and the combination was broken, which is exactly the class
// of defect no reviewer of either diff can see. So the check is mechanical: resolve every script
// the Dockerfile actually runs (following `npm run X` chains) and refuse any path token under a
// directory the build context throws away.
// ---------------------------------------------------------------------
{
  let dockerfile = null
  let dockerignore = null
  let pkg = null
  try {
    dockerfile = readFileSync(join(REPO_ROOT, 'Dockerfile'), 'utf8')
    dockerignore = readFileSync(join(REPO_ROOT, '.dockerignore'), 'utf8')
    pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  } catch (err) {
    fail(`Docker build context: cannot read Dockerfile/.dockerignore/package.json (${err.message})`)
  }

  if (dockerfile && dockerignore && pkg) {
    // Top-level directories the context throws away. A leading "/" only anchors the pattern to the
    // context root, which for a bare directory name means the same thing here; a "!" line is a
    // re-include and must NOT be treated as an exclusion.
    const excluded = new Set()
    const reincluded = new Set()
    for (const raw of dockerignore.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      if (line.startsWith('!')) {
        // A `!` line is a re-include and is the ONLY reason a path under an excluded directory can
        // still reach the build context. Recording them is what keeps the import scan below from
        // reporting a deliberate exception as a break.
        reincluded.add(line.slice(1).replace(/^\/+/, ''))
        continue
      }
      const first = line.replace(/^\/+/, '').split('/')[0]
      // Only whole-name directory entries can be resolved this cheaply; a glob like *.md cannot be
      // matched against a path token without reimplementing Docker's matcher, and guessing there
      // would produce false failures that get the guard disabled rather than the build fixed.
      if (first && !first.includes('*') && !first.includes('?')) excluded.add(first)
    }

    // Resolve `npm run X` transitively so a one-line indirection cannot hide the dependency.
    const seen = new Set()
    const resolve = (name, trail) => {
      if (seen.has(name)) return []
      seen.add(name)
      const body = pkg.scripts?.[name]
      if (typeof body !== 'string') return []
      const here = [{ script: name, body, trail }]
      for (const m of body.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
        here.push(...resolve(m[1], `${trail} -> ${m[1]}`))
      }
      return here
    }

    const invoked = [...dockerfile.matchAll(/^RUN .*?\bnpm run ([A-Za-z0-9:_-]+)/gm)].map((m) => m[1])
    checkedCount += 1
    if (invoked.length === 0) {
      fail('Docker build context: the Dockerfile runs no `npm run` script — this guard has stopped guarding anything')
    }

    // An OUTPUT path is written, not read, so excluding it from the context is correct — the
    // container creates it. `host:build` writes --outfile=out/session-host/host.cjs, and .dockerignore
    // rightly throws away a stale local out/. Strip output flags before scanning rather than
    // blocklisting directory names: a blocklist would also hide a genuine READ of out/, whereas a
    // missed output flag here fails LOUDLY (a false positive somebody fixes) instead of silently.
    const inputsOnly = (body) => body.replace(/--(?:outfile|outdir|out-dir)[= ]\S+/g, ' ')

    for (const entry of invoked.flatMap((name) => resolve(name, name))) {
      const readTokens = inputsOnly(entry.body).split(/[\s'"=(),;|&]+/).filter(Boolean)
      for (const dir of excluded) {
        checkedCount += 1
        // Delimited on both sides: a bare "docs" would match "docs-data" and a bare "test" would
        // match "testing", turning a real guard into noise that gets it switched off.
        // NO dynamically-built RegExp here. The first version of this line was
        //     new RegExp(`(^|[\s'"=(])${dir}/`)
        // written with ONE backslash, and `\s` is not a recognised escape in a template literal,
        // so JS dropped the backslash and the character class became [s'"=(] — a literal "s". The
        // guard then matched nothing, ran clean, and was completely inert. It read as correct and
        // was caught ONLY by deliberately breaking the Dockerfile and watching it stay green.
        // Splitting on a regex LITERAL (single backslashes survive there) and comparing plain
        // strings removes the whole failure mode.
        // A token must carry a real separator to count as a path. `electron-vite build` yields the
        // bare word "build", and .dockerignore excludes a build/ DIRECTORY — matching that word
        // reported a subcommand as a missing path. A guard that cries wolf gets switched off, which
        // costs more than the bare-token case it would have caught (`rimraf docs`, and similar).
        if (readTokens.some((t) => t.startsWith(`${dir}/`))) {
          fail(
            `Docker build context: the Dockerfile runs \`npm run ${entry.trail}\`, whose script ` +
              `"${entry.script}" reads ${dir}/ — but .dockerignore excludes ${dir}, so that path is ` +
              `not in the build context and the image cannot build from a clean clone. Either move ` +
              `the dependency out of the container build, or stop excluding ${dir}.`
          )
        }
      }
    }

    // A SECOND way the container build breaks, and the one the first masks completely: production
    // renderer/main source importing a path under an excluded directory. StatusSurface.tsx does a
    // Vite `?raw` import of docs/assets/shots/capture-manifest.json, reached from Canvas.tsx, so
    // `electron-vite build` cannot resolve it inside the container — but `npm run build` died on a
    // missing scripts/ gate long before bundling, so nobody ever saw it. Same shape as this repo's
    // recorded "the locked DLL hid the missing Spectre libs": fixing the loud break is what makes
    // the quiet one reachable, which is exactly when a guard has to already exist.
    //
    // Test files are excluded deliberately — they are not bundled, so their scripts/ imports are
    // correct and flagging them would be noise that gets this switched off.
    // listRendererFiles joins with the platform separator, so on Windows it hands back a path
    // whose separators are backslashes, which can never match a POSIX .dockerignore entry.
    // Normalise once here rather than at each comparison, and keep the ORIGINAL native path for
    // the actual file read.
    const productionSources = listRendererFiles('src').filter(
      (rel) => /\.(ts|tsx)$/.test(rel) && !/\.test\.(ts|tsx)$/.test(rel)
    )
    // A THIRD way in, and the most direct: a COPY whose source the context throws away.
    // Docker does error loudly on a missing COPY source, but that failure arrives minutes into a
    // build on a machine that is not this one, so catching it at desk cost is worth ten lines.
    // `--from=<stage>` copies read a previous STAGE, not the build context, and are out of scope.
    for (const line of dockerfile.split(/\r?\n/)) {
      const instruction = line.trim()
      if (!/^(COPY|ADD)\s/i.test(instruction)) continue
      if (/--from=/i.test(instruction)) continue
      const args = instruction
        .split(/\s+/)
        .slice(1)
        .filter((a) => !a.startsWith('--'))
      // The last argument is the destination inside the image, never a context path.
      for (const src of args.slice(0, -1)) {
        const clean = src.replace(/^\.\//, '')
        if (clean === '.' || clean === '') continue
        const top = clean.split('/')[0]
        checkedCount += 1
        if (excluded.has(top) && !reincluded.has(clean)) {
          fail(
            `Docker build context: the Dockerfile copies ${src}, but .dockerignore excludes ` +
              `${top} — that path is not in the build context, so the COPY has nothing to copy.`
          )
        }
      }
    }

    // Tripwire: an empty list makes this whole scan vanish silently while still reporting clean,
    // the same shape as an it.each([]) that generates no tests. Assert it found something.
    checkedCount += 1
    if (productionSources.length < 100) {
      fail(
        `Docker build context: the production-source scan found only ${productionSources.length} ` +
          'files under src/ — the walker has broken and this guard is no longer guarding anything'
      )
    }

    for (const nativeRel of productionSources) {
      const rel = nativeRel.split(sep).join('/')
      let body = ''
      try {
        body = readFileSync(join(REPO_ROOT, nativeRel), 'utf8')
      } catch {
        continue
      }
      for (const m of body.matchAll(/from '((?:\.\.\/)+[^']+)'/g)) {
        // Resolve the relative specifier against the importing file to a repo-root path.
        const resolved = posixResolve(rel, m[1]).replace(/\?.*$/, '')
        const top = resolved.split('/')[0]
        if (!excluded.has(top)) continue
        if (reincluded.has(resolved)) continue
        checkedCount += 1
        fail(
          `Docker build context: ${rel} imports ${resolved}, but .dockerignore excludes ` +
            `${top} and there is no \`!${resolved}\` re-include — the container build cannot ` +
            `resolve that import. Either add the exception or move the file under src/.`
        )
      }
    }
    checkedCount += 1
  }
}

/** Resolve a relative import specifier against the importing file, POSIX-style. Deliberately does
 *  not use node:path — the repo-root paths compared here are always POSIX, and path.win32 would
 *  produce backslashes that never match a .dockerignore entry. */
function posixResolve(fromFile, specifier) {
  const parts = fromFile.split('/').slice(0, -1)
  for (const seg of specifier.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------
console.log('')
// ---------------------------------------------------------------------
// Every stylesheet's braces balance
//
// Measured, and self-inflicted. Resolving a merge in styles.md3.css by "keeping both sides" was
// correct in intent — the two lanes' selector sets were completely disjoint — but the conflict
// boundary fell MID-RULE, so the resolution spliced the head of one rule onto the body of another
// and left two rules unterminated. Checking the selector lists is what made it look safe; nothing
// typechecks CSS, so the file shipped into a commit.
//
// The damage did surface, but as styles.split.test.ts reporting two "stale exceptions" — because
// its parser desynced at the break and stopped seeing every selector after it. That is a true
// symptom pointing at completely the wrong cause, and it cost a real detour. One brace count says
// the actual thing.
// ---------------------------------------------------------------------
{
  for (const rel of ['src/renderer/styles.css', 'src/renderer/styles.md3.css']) {
    checkedCount += 1
    let css = ''
    try {
      css = readFileSync(join(REPO_ROOT, rel), 'utf8')
    } catch (err) {
      fail(`Stylesheet brace balance: cannot read ${rel} (${err.message})`)
      continue
    }
    let depth = 0
    let line = 1
    let firstNegativeLine = null
    for (const ch of css) {
      if (ch === '\n') line += 1
      else if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth < 0 && firstNegativeLine === null) firstNegativeLine = line
      }
    }
    if (firstNegativeLine !== null) {
      fail(`Stylesheet brace balance: ${rel} closes a rule that was never opened, at line ${firstNegativeLine}`)
    } else if (depth !== 0) {
      fail(
        `Stylesheet brace balance: ${rel} ends with ${depth} unterminated rule(s). A merge ` +
          'resolution that split a rule is the usual cause — every selector after the break stops ' +
          'being parsed, so the symptom shows up somewhere unrelated.'
      )
    }
  }
}

// ---------------------------------------------------------------------
// No unresolved merge-conflict marker reaches a commit
//
// Measured, and it reached one: resolving two lane merges with a regex anchored on `^=======\n`
// left the marker in place on a CRLF checkout, because the line is actually `=======\r\n`. The
// sibling `<<<<<<<`/`>>>>>>>` patterns absorbed the \r through `[^\n]*` and were removed, so the
// file LOOKED resolved. types.ts failed typecheck immediately — but styles.md3.css carried two of
// them into a commit silently, because nothing typechecks CSS and `=======` in a stylesheet is
// just an ignored parse error.
//
// One `git grep` would have caught it in a second, which is exactly why it is worth a permanent
// check rather than a resolution habit nobody can enforce.
// ---------------------------------------------------------------------
{
  const MARKER = /^(?:<{7} |={7}$|>{7} )/m
  const scanRoots = ['src', 'scripts']
  let scanned = 0
  for (const root of scanRoots) {
    const walk = (dir) => {
      let entries = []
      try {
        entries = readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const rel = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) walk(rel)
          continue
        }
        if (!/\.(ts|tsx|js|jsx|mjs|cjs|css|html|json|md|yml|yaml)$/i.test(entry.name)) continue
        scanned += 1
        let body = ''
        try {
          body = readFileSync(join(REPO_ROOT, rel), 'utf8')
        } catch {
          continue
        }
        if (MARKER.test(body)) {
          checkedCount += 1
          fail(`Unresolved merge conflict: ${rel.split(sep).join('/')} still contains a conflict marker`)
        }
      }
    }
    walk(root)
  }
  // Tripwire: a broken walk would make this report clean while scanning nothing.
  checkedCount += 1
  if (scanned < 200) {
    fail(`Merge-conflict scan reached only ${scanned} files — the walker has broken and this guard is inert`)
  }
}

console.log(`Checked ${checkedCount} contract assertions across ${FEATURES.length} features.`)
if (failures > 0) {
  console.error(`\n${failures} FAILURE(S). This is a local tool, not a CI gate — fix these before considering the app change complete.`)
  process.exit(1)
} else {
  console.log('\nAll contract features present and wired. ✓')
  process.exit(0)
}

