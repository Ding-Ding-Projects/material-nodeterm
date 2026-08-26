#!/usr/bin/env node

// Hand-written producer inventory for the renderer's local personal-vocabulary boundary.
// Discovery is intentionally not used: a producer removed from this list must make this check red.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCERS = [
  ['settings-fields', 'src/renderer/components/settings/FieldRow.tsx', 'useVocabularyText('],
  ['settings-sections', 'src/renderer/components/settings/SettingsSection.tsx', 'useVocabularyText('],
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
  ['converter-panel', 'src/renderer/components/converter/FileConverterPanel.tsx', 'useVocabularyMapper()'],
  ['ollama-manager', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'useVocabularyMapper()'],
  ['explorer-panel', 'src/renderer/components/ExplorerPanel.tsx', 'useVocabularyMapper()'],
  ['project-switcher', 'src/renderer/components/ProjectSwitcher.tsx', 'useVocabularyMapper()'],
  ['regex-builder', 'src/renderer/components/regex/RegexBuilder.tsx', 'useVocabularyMapper()'],
  ['anchored-regex-builder', 'src/renderer/components/regex/AnchoredRegexBuilder.tsx', 'useVocabularyMapper()'],
  ['changelog-panel', 'src/renderer/components/changelog/ChangelogPanel.tsx', 'useVocabularyMapper()'],
  ['release-card', 'src/renderer/components/changelog/ReleaseCard.tsx', 'useVocabularyMapper()'],
  ['local-history-panel', 'src/renderer/components/LocalHistoryPanel.tsx', 'useVocabularyMapper()'],
  ['docs-browser', 'src/renderer/components/DocsBrowser.tsx', 'useVocabularyMapper()'],
  ['docs-article-view', 'src/renderer/components/docs/DocsArticleView.tsx', 'useVocabularyMapper()'],
  ['appearance-editor', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'useVocabularyMapper()'],
  ['color-field', 'src/renderer/components/color/ColorField.tsx', 'useVocabularyMapper()'],
  ['color-picker', 'src/renderer/components/color/ColorPicker.tsx', 'useVocabularyMapper()'],
  ['minecraft-backups', 'src/renderer/components/minecraft/MinecraftBackupsPanel.tsx', 'useVocabularyMapper()'],
  ['minecraft-players', 'src/renderer/components/minecraft/MinecraftPlayersPanel.tsx', 'useVocabularyMapper()'],
  ['minecraft-properties', 'src/renderer/components/minecraft/MinecraftPropertiesEditor.tsx', 'useVocabularyMapper()'],
  ['authenticator-settings', 'src/renderer/components/settings/sections/AuthenticatorSection.tsx', 'useVocabularyMapper()'],
  ['speech-settings', 'src/renderer/components/settings/sections/SpeechSection.tsx', 'useVocabularyMapper()'],
  ['toy-lock-wizard', 'src/renderer/components/toylocks/LockWizard.tsx', 'useVocabularyMapper()'],
  ['personal-vocabulary-surface-mapper', 'src/renderer/lib/personalVocabulary/surfaces.ts', 'applyVocabularyToMenuItems'],
  ['personal-vocabulary-application', 'src/renderer/lib/personalVocabulary/apply.ts', 'export function applyVocabulary'],
  ['typed-copy-fact-boundary', 'src/renderer/lib/personalVocabulary/ownedCopy.ts', 'mapOwnedSentence']
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
  ['regex-builder', 'src/renderer/components/regex/RegexBuilder.tsx', 'mapped-callsite'],
  ['anchored-regex-builder', 'src/renderer/components/regex/AnchoredRegexBuilder.tsx', 'mapped-callsite'],
  ['notification-center', 'src/renderer/components/NotificationCenter.tsx', 'mapped-callsite'],
  ['notification-toasts', 'src/renderer/components/NotificationToasts.tsx', 'mapped-callsite'],
  ['changelog-panel', 'src/renderer/components/changelog/ChangelogPanel.tsx', 'mapped-callsite'],
  ['release-card', 'src/renderer/components/changelog/ReleaseCard.tsx', 'mapped-callsite'],
  ['local-history', 'src/renderer/components/LocalHistoryPanel.tsx', 'mapped-callsite'],
  ['docs-browser', 'src/renderer/components/DocsBrowser.tsx', 'mapped-callsite'],
  ['docs-article', 'src/renderer/components/docs/DocsArticleView.tsx', 'mapped-callsite'],
  ['appearance-editor', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'mapped-callsite'],
  ['color-field', 'src/renderer/components/color/ColorField.tsx', 'mapped-callsite'],
  ['color-menu', 'src/renderer/components/color/ColorMenu.tsx', 'colors-only-no-prose'],
  ['color-picker', 'src/renderer/components/color/ColorPicker.tsx', 'mapped-callsite'],
  ['branch-select', 'src/renderer/components/BranchSelect.tsx', 'literal-provider-boundary'],
  ['bulk-action-bar', 'src/renderer/components/BulkActionBar.tsx', 'mapped-callsite'],
  ['explorer-panel', 'src/renderer/components/ExplorerPanel.tsx', 'mapped-callsite'],
  ['project-switcher', 'src/renderer/components/ProjectSwitcher.tsx', 'mapped-callsite'],
  ['ollama-manager', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'mapped-callsite'],
  ['converter-panel', 'src/renderer/components/converter/FileConverterPanel.tsx', 'mapped-callsite'],
  ['pty-pressure', 'src/renderer/components/PtyPressureBanner.tsx', 'unmapped-callsite-pending'],
  ['update-card', 'src/renderer/components/UpdateCard.tsx', 'unmapped-callsite-pending'],
  ['resume-card', 'src/renderer/components/ResumeCard.tsx', 'unmapped-callsite-pending']
]
const FIELD_BOUNDARIES = [
  ['bulk-preview-segments', 'src/renderer/components/BulkActionPreview.tsx', 'messageSegments={messageSegments}'],
  ['bulk-preview-single-title-map', 'src/renderer/components/BulkActionBar.tsx', 'title={vocab(pending.label)}'],
  ['project-storage-segments', 'src/renderer/components/ProjectSwitcher.tsx', 'messageSegments={'],
  ['project-other-unread-fact', 'src/renderer/components/ProjectSwitcher.tsx', 'mapOwnedSentence(vocab, [fact(String(otherUnread))'],
  ['converter-detection-note-fact', 'src/renderer/components/converter/FileConverterPanel.tsx', 'f.detection.note'],
  ['converter-adapter-id-corpus', 'src/renderer/components/converter/AdapterCatalog.tsx', 'row.id} ${row.label}'],
  ['ollama-staleness-segments', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'mapOwnedSentence(vocab, staleness)'],
  ['ollama-completeness-segments', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'catalogHeadlineText(vocab, catalog)'],
  ['ollama-completeness-reason-fact', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'mapOwnedSentence(vocab, [fact(reason)]'],
  ['ollama-queue-phase-fact', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'item.digestPhase ?? vocab(item.status)'],
  ['ollama-fit-evidence-fact', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', "vocab('Evidence:')"],
  ['appearance-weight-segments', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'w.label.indexOf'],
  ['appearance-font-preview-fact', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'quoteFamily(primary ||'],
  ['docs-section-copy', 'src/renderer/components/DocsBrowser.tsx', 'vocab(section.label)'],
  ['history-restore-segments', 'src/renderer/components/LocalHistoryPanel.tsx', 'messageSegments={[']
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
for (const [id, file, marker] of FIELD_BOUNDARIES) {
  check(id + ': field-level implementation exists', read(file) !== null)
  check(id + ': exact production field boundary', hasMarker(read(file), marker))
  const docText = read(DOC) || ''
  check(id + ': field-level audit row', docText.includes('| ' + String.fromCharCode(96) + id + String.fromCharCode(96) + ' |'))
}
const pendingProductionSurfaces = PRODUCTION_SURFACES.filter(([, , reason]) => reason === 'unmapped-callsite-pending')
check('all listed production surfaces are mapper-covered', pendingProductionSurfaces.length === 0)
if (pendingProductionSurfaces.length > 0) {
  console.error('Open producer boundaries: ' + pendingProductionSurfaces.map(([id]) => id).join(', '))
}
check('producer inventory has no duplicate identifiers', errors.length === 0)

// Deliberate red regressions, all in memory: remove a row, a mapper call, and the documentation row.
const originalRows = PRODUCERS.map((row) => row.join('|')).join('\n')
check('negative regression catches a removed producer row', !PRODUCERS.slice(1).some(([id]) => id === PRODUCERS[0][0]))
const mutationTarget = PRODUCERS.find(([id]) => id === 'tooltip')
check('negative regression catches a removed mapper call', mutationTarget !== undefined && !hasMarker(read(mutationTarget[1]).replace(mutationTarget[2], ''), mutationTarget[2]))
check('negative regression catches a removed audit row', !(read(DOC) || '').replace('| ' + String.fromCharCode(96) + PRODUCERS[0][0] + String.fromCharCode(96) + ' |', '').includes('| ' + String.fromCharCode(96) + PRODUCERS[0][0] + String.fromCharCode(96) + ' |'))
check('negative regression fixture is non-empty', originalRows.length > 0)

// Mutate copies of real producer and documentation files, then verify the same exact predicates
// reject the missing evidence. This is intentionally filesystem-backed, not a self-referential
// array-only assertion.
const mutationRoot = mkdtempSync(join(tmpdir(), 'nodeterm-vocabulary-audit-'))
try {
  const target = PRODUCERS.find(([id]) => id === 'tooltip')
  if (target) {
    const sourcePath = join(mutationRoot, 'Tooltip.tsx')
    copyFileSync(join(ROOT, target[1]), sourcePath)
    writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').replace(target[2], ''), 'utf8')
    check('real-file mapper mutation is rejected', !hasMarker(readFileSync(sourcePath, 'utf8'), target[2]))
  }
  const docPath = join(mutationRoot, 'audit.md')
  copyFileSync(join(ROOT, DOC), docPath)
  const quote = String.fromCharCode(96)
  const docLines = readFileSync(docPath, 'utf8').split(/\r?\n/)
  writeFileSync(docPath, docLines.filter((line) => !line.startsWith('| ' + quote + 'tooltip' + quote + ' |')).join('\n'), 'utf8')
  check('real-file producer-row mutation is rejected', !readFileSync(docPath, 'utf8').split(/\r?\n/).some((line) => line.startsWith('| ' + quote + 'tooltip' + quote + ' |')))
  const surfaceCopy = join(mutationRoot, 'App.tsx')
  copyFileSync(join(ROOT, PRODUCTION_SURFACES[0][1]), surfaceCopy)
  rmSync(surfaceCopy)
  check('real-file production-surface mutation is rejected', !existsSync(surfaceCopy))
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
