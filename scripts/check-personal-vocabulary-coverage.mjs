#!/usr/bin/env node

// Hand-written producer inventory for the renderer's local personal-vocabulary boundary.
// Discovery is intentionally not used: a producer removed from this list must make this check red.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const scriptArgs = process.argv.slice(2)
const rootIndex = scriptArgs.indexOf('--root')
const ROOT = rootIndex >= 0 && scriptArgs[rootIndex + 1]
  ? scriptArgs[rootIndex + 1]
  : join(dirname(SCRIPT_PATH), '..')
const fixtureRun = scriptArgs.includes('--fixture-run')
const PRODUCERS = [
  ['settings-fields', 'src/renderer/components/settings/FieldRow.tsx', 'useVocabularyText('],
  ['settings-sections', 'src/renderer/components/settings/SettingsSection.tsx', 'useVocabularyText('],
  ['settings-page', 'src/renderer/components/settings/SettingsPage.tsx', 'useLocalizedVocabularyText()'],
  ['settings-sidebar', 'src/renderer/components/settings/SettingsSidebar.tsx', 'useI18n()'],
  ['settings-search-corpus', 'src/renderer/components/settings/SearchableRow.tsx', 'useVocabularyMapper()'],
  ['personal-vocabulary-upload', 'src/renderer/components/settings/sections/PersonalVocabularySection.tsx', 'usePersonalVocabulary'],
  ['command-palette', 'src/renderer/components/CommandPalette.tsx', 'useVocabularyCommands'],
  ['context-menus', 'src/renderer/components/menu/VocabularyContextMenu.tsx', 'useVocabularyMenuItems'],
  ['confirm-dialog', 'src/renderer/components/ConfirmDialog.tsx', 'useVocabularyMapper()'],
  ['input-dialog', 'src/renderer/components/InputDialog.tsx', 'useVocabularyMapper()'],
  ['notifications', 'src/renderer/components/NotificationToasts.tsx', 'useVocabularyMapper()'],
  ['tooltip', 'src/renderer/components/Tooltip.tsx', 'useVocabularyMapper()'],
  ['conflict-banner', 'src/renderer/components/ConflictBar.tsx', 'useVocabularyMapper()'],
  ['canvas-prose', 'src/renderer/canvas/Canvas.tsx', 'useLocalizedVocabularyText'],
  ['fab-menu', 'src/renderer/components/FabMenu.tsx', 'useVocabularyMapper()'],
  ['kanban-view', 'src/renderer/components/kanban/KanbanView.tsx', 'VocabularyContextMenu'],
  ['kanban-column', 'src/renderer/components/kanban/KanbanColumn.tsx', 'useLocalizedVocabularyText()'],
  ['kanban-session-card', 'src/renderer/components/kanban/SessionCard.tsx', 'useLocalizedVocabularyText()'],
  ['kanban-card-modal', 'src/renderer/components/kanban/CardModal.tsx', 'useLocalizedVocabularyText()'],
  ['source-control', 'src/renderer/components/SourceControlPanel.tsx', 'VocabularyContextMenu'],
  ['worktree-dialog', 'src/renderer/components/WorktreeDialog.tsx', 'useVocabularyMapper()'],
  ['onboarding', 'src/renderer/components/onboarding/OnboardingFlow.tsx', 'useVocabularyMapper()'],
  ['dim-sum-surprise', 'src/renderer/components/DimSumSurprise.tsx', 'useVocabularyMapper()'],
  ['publish-dialog', 'src/renderer/components/PublishDialog.tsx', 'useVocabularyMapper()'],
  ['find-bar', 'src/renderer/components/FindBar.tsx', 'useVocabularyMapper()'],
  ['remote-picker', 'src/renderer/components/RemotePicker.tsx', 'useVocabularyMapper()'],
  ['browser-profile-picker', 'src/renderer/nodes/BrowserProfilePicker.tsx', 'useVocabularyMapper()'],
  ['password-manager', 'src/renderer/components/passwordManager/PasswordManagerPanel.tsx', 'useVocabularyMapper()'],
  ['converter-adapter-catalog', 'src/renderer/components/converter/AdapterCatalog.tsx', 'useVocabularyMapper()'],
  ['minecraft-backups', 'src/renderer/components/minecraft/MinecraftBackupsPanel.tsx', 'useVocabularyMapper()'],
  ['minecraft-players', 'src/renderer/components/minecraft/MinecraftPlayersPanel.tsx', 'useVocabularyMapper()'],
  ['minecraft-properties', 'src/renderer/components/minecraft/MinecraftPropertiesEditor.tsx', 'useVocabularyMapper()'],
  ['authenticator-settings', 'src/renderer/components/settings/sections/AuthenticatorSection.tsx', 'useVocabularyMapper()'],
  ['speech-settings', 'src/renderer/components/settings/sections/SpeechSection.tsx', 'useVocabularyMapper()'],
  ['toy-lock-wizard', 'src/renderer/components/toylocks/LockWizard.tsx', 'useVocabularyMapper()'],
  ['ui-input', 'src/renderer/ui/Input.tsx', 'useVocabularyMapper()'],
  ['ui-md3-button', 'src/renderer/ui/md3/Button.tsx', 'useVocabularyMapper()'],
  ['ui-chip', 'src/renderer/ui/md3/Chip.tsx', 'useVocabularyMapper()'],
  ['ui-menu', 'src/renderer/ui/md3/Menu.tsx', 'useVocabularyMapper()'],
  ['ui-status-chip', 'src/renderer/ui/md3/StatusChip.tsx', 'useVocabularyMapper()'],
  ['ui-switch', 'src/renderer/ui/Switch.tsx', 'useVocabularyMapper()'],
  ['ui-select', 'src/renderer/ui/Select.tsx', 'useVocabularyMapper()'],
  ['ui-number-field', 'src/renderer/ui/NumberField.tsx', 'useVocabularyMapper()'],
  ['ui-text-area', 'src/renderer/ui/md3/TextArea.tsx', 'useVocabularyMapper()'],
  ['ui-text-field', 'src/renderer/ui/md3/TextField.tsx', 'useVocabularyMapper()'],
  ['ui-fab', 'src/renderer/ui/md3/Fab.tsx', 'useVocabularyMapper()'],
  ['ui-icon-button', 'src/renderer/ui/md3/IconButton.tsx', 'useVocabularyMapper()'],
  ['ui-segmented-button', 'src/renderer/ui/md3/SegmentedButton.tsx', 'useVocabularyMapper()'],
  ['ui-dialog', 'src/renderer/ui/md3/Dialog.tsx', 'useVocabularyMapper()'],
  ['ui-list-row', 'src/renderer/ui/md3/ListRow.tsx', 'useVocabularyMapper()'],
  ['ui-tabs', 'src/renderer/ui/md3/Tabs.tsx', 'useVocabularyMapper()'],
  ['ui-slider', 'src/renderer/ui/md3/Slider.tsx', 'useVocabularyMapper()'],
  ['ui-checkbox', 'src/renderer/ui/md3/Checkbox.tsx', 'useVocabularyMapper()'],
  ['ui-radio', 'src/renderer/ui/md3/Radio.tsx', 'useVocabularyMapper()'],
  ['filterable-menu', 'src/renderer/components/menu/FilterableMenu.tsx', 'useVocabularyMapper()'],
  ['editable-node-title', 'src/renderer/components/EditableNodeTitle.tsx', 'useVocabularyMapper()'],
  ['destructive-confirm-gate', 'src/renderer/components/DestructiveConfirmGate.tsx', 'useVocabularyMapper()'],
  ['personal-vocabulary-surface-mapper', 'src/renderer/lib/personalVocabulary/surfaces.ts', 'applyVocabularyToMenuItems'],
  ['personal-vocabulary-application', 'src/renderer/lib/personalVocabulary/apply.ts', 'export function applyVocabulary'],
  ['personal-vocabulary-template', 'src/renderer/lib/personalVocabulary/apply.ts', 'export function applyVocabularyToTemplate']
]

const DOC = 'docs/features/appearance/material-3-audit.md'
const PRODUCTION_SURFACES = [
  ['app-shell', 'src/renderer/App.tsx', 'unmapped-callsite-pending'],
  ['welcome', 'src/renderer/components/WelcomeScreen.tsx', 'unmapped-callsite-pending'],
  ['top-app-bar', 'src/renderer/components/TopAppBar.tsx', 'unmapped-callsite-pending'],
  ['status-surface', 'src/renderer/components/StatusSurface.tsx', 'mapped-callsite'],
  ['sessions-sidebar', 'src/renderer/components/SessionsSidebar.tsx', 'unmapped-callsite-pending'],
  ['session-row', 'src/renderer/components/SessionRow.tsx', 'unmapped-callsite-pending'],
  ['terminal-node', 'src/renderer/nodes/TerminalNode.tsx', 'mapped-callsite'],
  ['sticky-node', 'src/renderer/nodes/StickyNode.tsx', 'unmapped-callsite-pending'],
  ['group-node', 'src/renderer/nodes/GroupNode.tsx', 'unmapped-callsite-pending'],
  ['editor-node', 'src/renderer/nodes/EditorNode.tsx', 'unmapped-callsite-pending'],
  ['diff-node', 'src/renderer/nodes/DiffNode.tsx', 'unmapped-callsite-pending'],
  ['browser-node', 'src/renderer/nodes/BrowserNode.tsx', 'unmapped-callsite-pending'],
  ['web-node', 'src/renderer/nodes/WebNode.tsx', 'unmapped-callsite-pending'],
  ['video-node', 'src/renderer/nodes/VideoNode.tsx', 'unmapped-callsite-pending'],
  ['loop-node', 'src/renderer/nodes/LoopNode.tsx', 'unmapped-callsite-pending'],
  ['service-node', 'src/renderer/nodes/ServiceNode.tsx', 'unmapped-callsite-pending'],
  ['wsl-dialog', 'src/renderer/wsl/WslCreateDialog.tsx', 'unmapped-callsite-pending'],
  ['regex-builder', 'src/renderer/components/regex/RegexBuilder.tsx', 'unmapped-callsite-pending'],
  ['anchored-regex-builder', 'src/renderer/components/regex/AnchoredRegexBuilder.tsx', 'unmapped-callsite-pending'],
  ['notification-center', 'src/renderer/components/NotificationCenter.tsx', 'mapped-callsite'],
  ['notification-toasts', 'src/renderer/components/NotificationToasts.tsx', 'mapped-callsite'],
  ['changelog-panel', 'src/renderer/components/changelog/ChangelogPanel.tsx', 'unmapped-callsite-pending'],
  ['release-card', 'src/renderer/components/changelog/ReleaseCard.tsx', 'unmapped-callsite-pending'],
  ['local-history', 'src/renderer/components/LocalHistoryPanel.tsx', 'unmapped-callsite-pending'],
  ['docs-browser', 'src/renderer/components/DocsBrowser.tsx', 'unmapped-callsite-pending'],
  ['docs-article', 'src/renderer/components/docs/DocsArticleView.tsx', 'unmapped-callsite-pending'],
  ['appearance-editor', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'unmapped-callsite-pending'],
  ['color-field', 'src/renderer/components/color/ColorField.tsx', 'unmapped-callsite-pending'],
  ['color-menu', 'src/renderer/components/color/ColorMenu.tsx', 'unmapped-callsite-pending'],
  ['color-picker', 'src/renderer/components/color/ColorPicker.tsx', 'unmapped-callsite-pending'],
  ['branch-select', 'src/renderer/components/BranchSelect.tsx', 'literal-provider-boundary'],
  ['bulk-action-bar', 'src/renderer/components/BulkActionBar.tsx', 'unmapped-callsite-pending'],
  ['pty-pressure', 'src/renderer/components/PtyPressureBanner.tsx', 'unmapped-callsite-pending'],
  ['update-card', 'src/renderer/components/UpdateCard.tsx', 'unmapped-callsite-pending'],
  ['resume-card', 'src/renderer/components/ResumeCard.tsx', 'unmapped-callsite-pending']
]
let failures = 0
let checked = 0
const read = (file) => existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : null
const noComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
function hasMarker(source, marker) {
  if (source === null) return false
  const clean = noComments(source)
  let from = 0
  while (from < clean.length) {
    const at = clean.indexOf(marker, from)
    if (at < 0) return false
    const before = clean[at - 1] || ''
    const after = clean[at + marker.length] || ''
    if (' \t\r\n;{('.includes(before) && (' \t\r\n;)}:,('.includes(after) || marker.endsWith('('))) return true
    from = at + marker.length
  }
  return false
}
function check(label, value) {
  checked += 1
  if (!value) {
    failures += 1
    console.error('✗ ' + label)
  } else console.log('✓ ' + label)
}

const errors = []
const ids = new Set()
for (const [id, file, marker] of PRODUCERS) {
  if (ids.has(id)) errors.push('duplicate producer id ' + id)
  ids.add(id)
  check(id + ': implementation exists', read(file) !== null)
  check(id + ': exact mapper/source boundary', hasMarker(read(file), marker))
  const docText = read(DOC) || ''
  check(id + ': hand-written audit row', docText.includes('| ' + String.fromCharCode(96) + id + String.fromCharCode(96) + ' |'))
}
for (const [id, file, reason] of PRODUCTION_SURFACES) {
  check(id + ': production surface exists', read(file) !== null)
  check(id + ': classification reason is explicit', reason.length > 0)
  if (reason === 'mapped-callsite') check(id + ': mapper call is present', hasMarker(read(file), 'useVocabularyMapper()') || hasMarker(read(file), 'useLocalizedVocabularyText()'))
}
const pendingProductionSurfaces = PRODUCTION_SURFACES.filter(([, , reason]) => reason === 'unmapped-callsite-pending')
check('all listed production surfaces are mapper-covered', pendingProductionSurfaces.length === 0)
if (pendingProductionSurfaces.length > 0) {
  console.error('Open producer boundaries: ' + pendingProductionSurfaces.map(([id]) => id).join(', '))
}
check('producer inventory has no duplicate identifiers', errors.length === 0)

// Mutate a complete fixture and execute this checker against it, rather than only invoking one
// predicate in memory. This catches a broken checker that accidentally passes its own miniature
// assertion while the real inventory path would still accept a missing producer.
const mutationRoot = mkdtempSync(join(tmpdir(), 'nodeterm-vocabulary-audit-'))
try {
  if (!fixtureRun) {
    for (const [, file] of [...PRODUCERS, ...PRODUCTION_SURFACES, ['audit-doc', DOC, '']]) {
      const source = join(ROOT, file)
      const target = join(mutationRoot, file)
      mkdirSync(dirname(target), { recursive: true })
      if (existsSync(source)) copyFileSync(source, target)
    }
    const target = PRODUCERS.find(([id]) => id === 'tooltip')
    if (target) {
      const sourcePath = join(mutationRoot, target[1])
      writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').replace(target[2], ''), 'utf8')
      const result = spawnSync(process.execPath, [SCRIPT_PATH, '--root', mutationRoot, '--fixture-run'], {
        encoding: 'utf8'
      })
      check('full checker rejects a removed mapper call', result.status !== 0)
    }
    const docPath = join(mutationRoot, DOC)
    const quote = String.fromCharCode(96)
    const docLines = readFileSync(docPath, 'utf8').split(/\r?\n/)
    writeFileSync(docPath, docLines.filter((line) => !line.startsWith('| ' + quote + 'tooltip' + quote + ' |')).join('\n'), 'utf8')
    const docResult = spawnSync(process.execPath, [SCRIPT_PATH, '--root', mutationRoot, '--fixture-run'], {
      encoding: 'utf8'
    })
    check('full checker rejects a removed audit row', docResult.status !== 0)
  }
} finally {
  rmSync(mutationRoot, { recursive: true, force: true })
}

console.log('check-personal-vocabulary-coverage.mjs: ' + checked + ' assertions checked.')
if (failures) {
  console.error(failures + ' FAILURE(S).')
  process.exitCode = 1
} else {
  console.log('All clear. ✓')
}
