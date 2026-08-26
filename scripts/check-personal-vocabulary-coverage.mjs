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
const dropSectionIndex = scriptArgs.indexOf('--drop-section')
const PRODUCERS = [
  ['settings-fields', 'src/renderer/components/settings/FieldRow.tsx', 'useVocabularyText('],
  ['settings-sections', 'src/renderer/components/settings/SettingsSection.tsx', 'useVocabularyText('],
  ['settings-page', 'src/renderer/components/settings/SettingsPage.tsx', 'useLocalizedVocabularyText()'],
  ['settings-page-registration', 'src/renderer/components/settings/SettingsPage.tsx', '<PersonalVocabularySection'],
  ['settings-sidebar', 'src/renderer/components/settings/SettingsSidebar.tsx', 'useI18n()'],
  ['settings-sidebar-registration', 'src/renderer/components/settings/SettingsSidebar.tsx', 'visibleSettingsGroups('],
  ['settings-search-corpus', 'src/renderer/components/settings/SearchableRow.tsx', 'useVocabularyMapper()'],
  ['settings-inline-copy', 'src/renderer/components/settings/SettingsText.tsx', 'useVocabularyMapper()'],
  ['settings-reset', 'src/renderer/components/settings/SectionReset.tsx', 'useVocabularyMapper()'],
  ['settings-font-picker', 'src/renderer/components/settings/FontPicker.tsx', 'useVocabularyMapper()'],
  ['settings-theme-picker', 'src/renderer/components/settings/ThemeSelect.tsx', 'useVocabularyMapper()'],
  ['settings-section-inline-copy', 'src/renderer/components/settings/SettingsText.tsx', 'export function SettingsText'],
  ['settings-search-policy', 'src/renderer/components/settings/vocabulary.ts', 'export function settingsSidebarSearchEntry'],
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
  ['authenticator-settings', 'src/renderer/components/settings/sections/AuthenticatorSection.tsx', 'SettingsText'],
  ['speech-settings', 'src/renderer/components/settings/sections/SpeechSection.tsx', 'SettingsText'],
  ['school-mode-settings', 'src/renderer/components/settings/sections/SchoolModeSection.tsx', 'useVocabularyMapper()'],
  ['kids-mode-settings', 'src/renderer/components/settings/sections/KidsModeSection.tsx', 'useVocabularyMapper()'],
  ['usage-settings', 'src/renderer/components/settings/sections/UsageSection.tsx', 'useVocabularyMapper()'],
  ['toy-lock-wizard', 'src/renderer/components/toylocks/LockWizard.tsx', 'useVocabularyMapper()'],
  ['ui-input', 'src/renderer/ui/Input.tsx', 'useVocabularyMapper()'],
  ['ui-button-wrapper-delegation', 'src/renderer/ui/Button.tsx', '<Md3Button'],
  ['ui-md3-button', 'src/renderer/ui/md3/Button.tsx', 'useVocabularyMapper()'],
  ['ui-chip', 'src/renderer/ui/md3/Chip.tsx', 'useVocabularyMapper()'],
  ['ui-menu', 'src/renderer/ui/md3/Menu.tsx', 'useVocabularyMapper()'],
  ['ui-status-chip', 'src/renderer/ui/md3/StatusChip.tsx', 'useVocabularyMapper()'],
  ['ui-switch', 'src/renderer/ui/Switch.tsx', 'useVocabularyTemplate('],
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
// Every Settings section is listed explicitly. The shared FieldRow/SettingsSection funnels cover
// their ordinary rows, while SettingsText marks standalone inline prose and the shared primitives
// cover labels/options. Keeping this list hand-written means deleting a section cannot make its
// vocabulary audit disappear with it.
const SETTINGS_SECTION_INVENTORY = [
  ['settings-accounts', 'src/renderer/components/settings/sections/AccountsSection.tsx', 'accounts'],
  ['settings-adhd', 'src/renderer/components/settings/sections/AdhdModesSection.tsx', 'adhd-modes'],
  ['settings-agents', 'src/renderer/components/settings/sections/AgentsSection.tsx', 'agents'],
  ['settings-appearance', 'src/renderer/components/settings/sections/AppearanceSection.tsx', 'appearance'],
  ['settings-appearance-editor', 'src/renderer/components/settings/sections/AppearanceEditorSection.tsx', 'appearance-editor'],
  ['settings-authenticator', 'src/renderer/components/settings/sections/AuthenticatorSection.tsx', 'authenticator'],
  ['settings-behavior', 'src/renderer/components/settings/sections/BehaviorSection.tsx', 'behavior'],
  ['settings-commit', 'src/renderer/components/settings/sections/CommitSection.tsx', 'commit'],
  ['settings-custom-agents', 'src/renderer/components/settings/sections/CustomAgentsSection.tsx', 'custom-agents'],
  ['settings-github-issues', 'src/renderer/components/settings/sections/GitHubIssuesSection.tsx', 'github-issues'],
  ['settings-kids', 'src/renderer/components/settings/sections/KidsModeSection.tsx', 'kids-mode'],
  ['settings-language', 'src/renderer/components/settings/sections/LanguageSection.tsx', 'language'],
  ['settings-license', 'src/renderer/components/settings/sections/LicenseSection.tsx', 'license'],
  ['settings-local-history', 'src/renderer/components/settings/sections/LocalHistorySection.tsx', 'history'],
  ['settings-narrator', 'src/renderer/components/settings/sections/NarratorSection.tsx', 'narrator'],
  ['settings-notch', 'src/renderer/components/settings/sections/NotchSection.tsx', 'notch'],
  ['settings-notifications', 'src/renderer/components/settings/sections/NotificationsSection.tsx', 'notifications'],
  ['settings-personal-vocabulary', 'src/renderer/components/settings/sections/PersonalVocabularySection.tsx', 'vocabulary'],
  ['settings-phone', 'src/renderer/components/settings/sections/PhoneSection.tsx', 'phone'],
  ['settings-presence', 'src/renderer/components/settings/sections/PresenceIdentitySection.tsx', 'presence'],
  ['settings-privacy', 'src/renderer/components/settings/sections/PrivacySection.tsx', 'privacy'],
  ['settings-remote', 'src/renderer/components/settings/sections/RemoteSection.tsx', 'remote'],
  ['settings-schedule', 'src/renderer/components/settings/sections/ScheduleSection.tsx', 'schedule'],
  ['settings-school', 'src/renderer/components/settings/sections/SchoolModeSection.tsx', 'school-mode'],
  ['settings-shell', 'src/renderer/components/settings/sections/ShellSection.tsx', 'shell'],
  ['settings-shortcuts', 'src/renderer/components/settings/sections/ShortcutsSection.tsx', 'shortcuts'],
  ['settings-speech', 'src/renderer/components/settings/sections/SpeechSection.tsx', 'speech'],
  ['settings-ssh', 'src/renderer/components/settings/sections/SshSection.tsx', 'ssh'],
  ['settings-support', 'src/renderer/components/settings/sections/SupportTicketsSection.tsx', 'support'],
  ['settings-team', 'src/renderer/components/settings/sections/TeamAccessSection.tsx', 'team-access'],
  ['settings-terminal', 'src/renderer/components/settings/sections/TerminalSection.tsx', 'terminal'],
  ['settings-tmux', 'src/renderer/components/settings/sections/TmuxSection.tsx', 'tmux'],
  ['settings-toy-locks', 'src/renderer/components/settings/sections/ToyLocksSection.tsx', 'toylocks'],
  ['settings-updates', 'src/renderer/components/settings/sections/UpdatesSection.tsx', 'updates'],
  ['settings-usage', 'src/renderer/components/settings/sections/UsageSection.tsx', 'usage'],
  ['settings-workspace', 'src/renderer/components/settings/sections/WorkspaceStorageSection.tsx', 'workspace-storage']
]
const FOCUSED_TEST_INVENTORY = [
  ['settings-template-test', 'src/renderer/lib/personalVocabulary/apply.test.ts'],
  ['settings-field-boundary-test', 'src/renderer/components/settings/FieldRow.vocabulary.test.tsx'],
  ['settings-i18n-boundary-test', 'src/renderer/lib/i18n.test.tsx'],
  ['settings-control-intent-test', 'src/renderer/ui/personalVocabulary.test.tsx']
]
const expectedSettingsSectionCount = 36
if (dropSectionIndex >= 0 && scriptArgs[dropSectionIndex + 1]) {
  const dropped = scriptArgs[dropSectionIndex + 1]
  const index = SETTINGS_SECTION_INVENTORY.findIndex(([id]) => id === dropped)
  if (index >= 0) SETTINGS_SECTION_INVENTORY.splice(index, 1)
}
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
for (const [id, file, sectionId] of SETTINGS_SECTION_INVENTORY) {
  const source = read(file)
  check(id + ': exact settings section exists', source !== null)
  check(id + ': exact Material/settings audit row', (read(DOC) || '').includes('| ' + String.fromCharCode(96) + id + String.fromCharCode(96) + ' |'))
  check(id + ': section registration boundary', hasMarker(source, `id="${sectionId}"`))
  check(id + ': active-state boundary', (source || '').includes('isActive'))
  const uncommented = noComments(source || '')
  // These are classification notes, not existence checks. The exact required boundary above is
  // the registered section id, while these clauses record which shared funnel the section owns.
  check(id + ': authored prose boundary', /FieldRow|SettingsText|SettingsSection/.test(uncommented))
  check(id + ': accessible-control classification', /aria-label|ariaLabel|htmlFor|placeholder|SettingsSection/.test(uncommented))
  check(id + ': option-or-fact classification', /<option|options\s*[:=]|formatText|profileText|value\s*=|SettingsSection/.test(uncommented))
}
for (const [id, file] of FOCUSED_TEST_INVENTORY) check(id + ': focused test exists', read(file) !== null)
check('settings section inventory is complete', SETTINGS_SECTION_INVENTORY.length === expectedSettingsSectionCount)
check('settings section inventory has unique ids', new Set(SETTINGS_SECTION_INVENTORY.map(([id]) => id)).size === SETTINGS_SECTION_INVENTORY.length)
const pendingProductionSurfaces = PRODUCTION_SURFACES.filter(([, , reason]) => reason === 'unmapped-callsite-pending')
if (!fixtureRun) check('all listed production surfaces are mapper-covered', pendingProductionSurfaces.length === 0)
if (!fixtureRun && pendingProductionSurfaces.length > 0) {
  console.error('Open producer boundaries: ' + pendingProductionSurfaces.map(([id]) => id).join(', '))
}
check('producer inventory has no duplicate identifiers', errors.length === 0)

// Mutate a complete fixture and execute this checker against it, rather than only invoking one
// predicate in memory. This catches a broken checker that accidentally passes its own miniature
// assertion while the real inventory path would still accept a missing producer.
const mutationRoot = mkdtempSync(join(tmpdir(), 'nodeterm-vocabulary-audit-'))
try {
  if (!fixtureRun) {
    for (const [, file] of [...PRODUCERS, ...PRODUCTION_SURFACES, ...SETTINGS_SECTION_INVENTORY, ...FOCUSED_TEST_INVENTORY, ['audit-doc', DOC, '']]) {
      const source = join(ROOT, file)
      const target = join(mutationRoot, file)
      mkdirSync(dirname(target), { recursive: true })
      if (existsSync(source)) copyFileSync(source, target)
    }
    const baselineResult = spawnSync(process.execPath, [SCRIPT_PATH, '--root', mutationRoot, '--fixture-run'], {
      encoding: 'utf8'
    })
    if (baselineResult.status !== 0) {
      console.error('Fixture baseline output:\n' + baselineResult.stdout + baselineResult.stderr)
    }
    check('complete fixture passes before mutation', baselineResult.status === 0)
    const target = PRODUCERS.find(([id]) => id === 'tooltip')
    if (target) {
      const sourcePath = join(mutationRoot, target[1])
      writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').replace(target[2], ''), 'utf8')
      const result = spawnSync(process.execPath, [SCRIPT_PATH, '--root', mutationRoot, '--fixture-run'], {
        encoding: 'utf8'
      })
      check('full checker rejects a removed mapper call', result.status !== 0)
    }
    const inlineTarget = PRODUCERS.find(([id]) => id === 'settings-inline-copy')
    if (inlineTarget) {
      const inlinePath = join(mutationRoot, inlineTarget[1])
      writeFileSync(inlinePath, readFileSync(inlinePath, 'utf8').replace(inlineTarget[2], ''), 'utf8')
      const inlineResult = spawnSync(process.execPath, [SCRIPT_PATH, '--root', mutationRoot, '--fixture-run'], {
        encoding: 'utf8'
      })
      check('full checker rejects a removed SettingsText mapper', inlineResult.status !== 0)
    }
    for (const id of ['settings-page-registration', 'settings-sidebar-registration']) {
      const registrationTarget = PRODUCERS.find((row) => row[0] === id)
      if (!registrationTarget) continue
      const registrationPath = join(mutationRoot, registrationTarget[1])
      writeFileSync(registrationPath, readFileSync(registrationPath, 'utf8').replace(registrationTarget[2], ''), 'utf8')
      const registrationResult = spawnSync(process.execPath, [SCRIPT_PATH, '--root', mutationRoot, '--fixture-run'], {
        encoding: 'utf8'
      })
      check('full checker rejects removed ' + id, registrationResult.status !== 0)
      const original = readFileSync(join(ROOT, registrationTarget[1]), 'utf8')
      writeFileSync(registrationPath, original, 'utf8')
    }
    const sectionResult = spawnSync(process.execPath, [SCRIPT_PATH, '--root', mutationRoot, '--fixture-run', '--drop-section', 'settings-accounts'], {
      encoding: 'utf8'
    })
    check('full checker rejects a removed settings section registration', sectionResult.status !== 0)
    const templateTestPath = join(mutationRoot, 'src/renderer/lib/personalVocabulary/apply.test.ts')
    rmSync(templateTestPath)
    const templateResult = spawnSync(process.execPath, [SCRIPT_PATH, '--root', mutationRoot, '--fixture-run'], {
      encoding: 'utf8'
    })
    check('full checker rejects a removed fact-template test', templateResult.status !== 0)
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
