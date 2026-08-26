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
  ['personal-vocabulary-upload', 'src/renderer/components/settings/sections/PersonalVocabularySection.tsx', 'usePersonalVocabulary('],
  ['command-palette', 'src/renderer/components/CommandPalette.tsx', 'useVocabularyCommands'],
  ['context-menus', 'src/renderer/components/menu/VocabularyContextMenu.tsx', 'useVocabularyMenuItems'],
  ['confirm-dialog', 'src/renderer/components/ConfirmDialog.tsx', 'useVocabularyMapper()'],
  ['input-dialog', 'src/renderer/components/InputDialog.tsx', 'useVocabularyMapper()'],
  ['notifications', 'src/renderer/components/NotificationToasts.tsx', 'useVocabularyMapper()'],
  ['tooltip', 'src/renderer/components/Tooltip.tsx', 'useVocabularyMapper()'],
  ['conflict-banner', 'src/renderer/components/ConflictBar.tsx', 'useVocabularyMapper()'],
  ['canvas-prose', 'src/renderer/canvas/Canvas.tsx', 'useLocalizedVocabularyText'],
  ['fab-menu', 'src/renderer/components/FabMenu.tsx', 'useVocabularyMapper()'],
  ['kanban-view', 'src/renderer/components/kanban/KanbanView.tsx', '<VocabularyContextMenu'],
  ['kanban-column', 'src/renderer/components/kanban/KanbanColumn.tsx', 'useLocalizedVocabularyText()'],
  ['kanban-session-card', 'src/renderer/components/kanban/SessionCard.tsx', 'useLocalizedVocabularyText()'],
  ['kanban-card-modal', 'src/renderer/components/kanban/CardModal.tsx', 'useLocalizedVocabularyText()'],
  ['source-control', 'src/renderer/components/SourceControlPanel.tsx', '<VocabularyContextMenu'],
  ['worktree-dialog', 'src/renderer/components/WorktreeDialog.tsx', 'useVocabularyMapper()'],
  ['onboarding', 'src/renderer/components/onboarding/OnboardingFlow.tsx', 'useVocabularyMapper()'],
  ['dim-sum-surprise', 'src/renderer/components/DimSumSurprise.tsx', 'useVocabularyMapper()'],
  ['publish-dialog', 'src/renderer/components/PublishDialog.tsx', 'useVocabularyMapper()'],
  ['find-bar', 'src/renderer/components/FindBar.tsx', 'useVocabularyMapper()'],
  ['remote-picker', 'src/renderer/components/RemotePicker.tsx', 'useVocabularyMapper()'],
  ['browser-profile-picker', 'src/renderer/nodes/BrowserProfilePicker.tsx', 'useVocabularyMapper()'],
  ['password-manager', 'src/renderer/components/passwordManager/PasswordManagerPanel.tsx', 'const vocab = useVocabularyMapper()'],
  ['converter-adapter-catalog', 'src/renderer/components/converter/AdapterCatalog.tsx', 'useVocabularyMapper()'],
  ['converter-upload-limit', 'src/renderer/components/converter/FileConverterPanel.tsx', 'mapLocalVocabularyText('],
  ['minecraft-backups', 'src/renderer/components/minecraft/MinecraftBackupsPanel.tsx', 'useVocabularyMapper()'],
  ['minecraft-players', 'src/renderer/components/minecraft/MinecraftPlayersPanel.tsx', 'useVocabularyMapper()'],
  ['minecraft-properties', 'src/renderer/components/minecraft/MinecraftPropertiesEditor.tsx', 'useVocabularyMapper()'],
  ['authenticator-settings', 'src/renderer/components/settings/sections/AuthenticatorSection.tsx', 'const vocab = useVocabularyMapper()'],
  ['speech-settings', 'src/renderer/components/settings/sections/SpeechSection.tsx', 'useVocabularyMapper()'],
  ['toy-lock-wizard', 'src/renderer/components/toylocks/LockWizard.tsx', 'useVocabularyMapper()'],
  ['personal-vocabulary-surface-mapper', 'src/renderer/lib/personalVocabulary/surfaces.ts', 'applyVocabularyToMenuItems'],
  ['personal-vocabulary-application', 'src/renderer/lib/personalVocabulary/apply.ts', 'export function applyVocabulary'],
  ['personal-vocabulary-host-message', 'src/renderer/lib/personalVocabulary/hostMessage.ts', 'formatHostMessage('],
  ['widget-entrypoint', 'src/renderer/widget/WidgetApp.tsx', 'useVocabularyMapper()'],
  ['hud-entrypoint', 'src/renderer/hud/main.ts', 'mapLocalVocabularyText('],
  ['dialog-picker-root', 'src/renderer/bridge/dialog-picker.tsx', 'useVocabularyMapper()'],
  ['ws-reconnect-overlay', 'src/renderer/bridge/ws-bridge.ts', 'mapLocalVocabularyText('],
  ['browser-bridge-stubs', 'src/renderer/bridge/stubs.ts', 'formatHostMessage('],
  ['notification-body-classification', 'src/renderer/state/notifications.ts', 'bodyKind'],
  ['site-vocabulary-json', 'site/app/features/vocabulary.js', 'validateVocabularyJson('],
  ['site-vocabulary-cache', 'site/app/shared/vocabulary-state.js', 'validateVocabularyCacheJson('],
  ['native-notification-canvas', 'src/renderer/canvas/Canvas.tsx', 'mapNativeNotification('],
  ['native-notification-onboarding', 'src/renderer/components/onboarding/OnboardingFlow.tsx', 'mapNativeNotification('],
  ['native-notification-settings', 'src/renderer/components/settings/sections/NotificationsSection.tsx', 'mapNativeNotification(']
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
  ['resume-card', 'src/renderer/components/ResumeCard.tsx', 'unmapped-callsite-pending'],
  ['widget-entrypoint', 'src/renderer/widget/WidgetApp.tsx', 'mapped-callsite'],
  ['hud-entrypoint', 'src/renderer/hud/main.ts', 'mapped-callsite'],
  ['dialog-picker-root', 'src/renderer/bridge/dialog-picker.tsx', 'mapped-callsite'],
  ['ws-reconnect-overlay', 'src/renderer/bridge/ws-bridge.ts', 'mapped-callsite'],
  ['browser-bridge-stubs', 'src/renderer/bridge/stubs.ts', 'mapped-callsite']
]

// Independent hand-written manifests. The mutable rows above are implementation evidence; these
// lists are the required universe, so deleting a row cannot delete its own requirement too.
const CANONICAL_PRODUCER_IDS = `settings-fields settings-sections personal-vocabulary-upload command-palette context-menus confirm-dialog input-dialog notifications tooltip conflict-banner canvas-prose fab-menu kanban-view kanban-column kanban-session-card kanban-card-modal source-control worktree-dialog onboarding dim-sum-surprise publish-dialog find-bar remote-picker browser-profile-picker password-manager converter-adapter-catalog converter-upload-limit minecraft-backups minecraft-players minecraft-properties authenticator-settings speech-settings toy-lock-wizard personal-vocabulary-surface-mapper personal-vocabulary-application personal-vocabulary-host-message widget-entrypoint hud-entrypoint dialog-picker-root ws-reconnect-overlay browser-bridge-stubs notification-body-classification site-vocabulary-json site-vocabulary-cache native-notification-canvas native-notification-onboarding native-notification-settings`.split(/\s+/)
const CANONICAL_SURFACE_IDS = `app-shell welcome top-app-bar status-surface sessions-sidebar session-row terminal-node sticky-node group-node editor-node diff-node browser-node web-node video-node loop-node service-node wsl-dialog regex-builder anchored-regex-builder notification-center notification-toasts changelog-panel release-card local-history docs-browser docs-article appearance-editor color-field color-menu color-picker branch-select bulk-action-bar pty-pressure update-card resume-card widget-entrypoint hud-entrypoint dialog-picker-root ws-reconnect-overlay browser-bridge-stubs`.split(/\s+/)
const CANONICAL_CANVAS_NOTIFY_CALL_IDS = `terminal-profile-create-unavailable explorer-folder-drop-stale explorer-agent-drop-missing explorer-folder-open-stale terminal-profile-restart-disabled terminal-profile-restart-failed branch-failed transfer-not-ready transfer-failed explorer-terminal-profile-unavailable project-save-busy project-save-progress project-save-success project-save-cancelled project-save-failed project-password-mismatch project-open-busy project-open-cancelled project-open-password-check project-open-success project-open-failed test-notification`.split(/\s+/)
// Keep the expected title evidence independent from the mutable callsite count. A replacement
// notification with the same number of arguments must not make the inventory look complete.
const CANONICAL_CANVAS_NOTIFY_TITLE_MARKERS = [
  ['terminalProfiles.common.unavailableHereTitle', 2],
  ['Folder drop cancelled', 2],
  ['Agent drop cancelled', 1],
  ['terminalProfiles.restart.failedTitle', 2],
  ['Branch failed', 1],
  ['Conversation not ready to transfer yet.', 1],
  ['Transfer failed', 1],
  ['Project save already running', 1],
  ['Saving project…', 1],
  ['Protected project saved as one file', 1],
  ['Project saved as one file', 1],
  ['Project save cancelled', 1],
  ['Project save failed', 1],
  ['The passwords did not match', 1],
  ['Project open already running', 1],
  ['Project open cancelled', 1],
  ['Unlocking project file…', 1],
  ['Project opened from file', 1],
  ['Project open failed', 1],
  ['Test notification', 1]
]
let failures = 0
let checked = 0
const read = (file) => existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : null
const noComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')

// Source predicates must not pass because a marker survived inside a comment. Markers are
// whole-line or call-boundary phrases, so the exact boundary check below is the same predicate
// used by the production inventory and does not accept a bare substring rename.
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
const producerIds = PRODUCERS.map(([id]) => id)
const surfaceIds = PRODUCTION_SURFACES.map(([id]) => id)
function inventoryMatchesCanonical(ids, canonical) {
  return ids.length === canonical.length && canonical.every((id, i) => ids[i] === id)
}

function callArguments(source, name) {
  const calls = []
  const needle = name + '('
  let from = 0
  while (from < source.length) {
    const start = source.indexOf(needle, from)
    if (start < 0) break
    const before = source[start - 1] || ''
    if (before && /[A-Za-z0-9_.$]/.test(before)) {
      from = start + needle.length
      continue
    }
    let depth = 1
    let quote = ''
    let escaped = false
    let end = start + needle.length
    for (; end < source.length; end += 1) {
      const ch = source[end]
      if (quote) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === quote) quote = ''
      } else if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch
      } else if (ch === '(' || ch === '{' || ch === '[') {
        depth += 1
      } else if (ch === ')' || ch === '}' || ch === ']') {
        depth -= 1
        if (depth === 0) {
          calls.push(source.slice(start + needle.length, end))
          break
        }
      }
    }
    from = end + 1
  }
  return calls
}
check('canonical producer manifest matches implementation rows', inventoryMatchesCanonical(producerIds, CANONICAL_PRODUCER_IDS))
check('canonical surface manifest matches implementation rows', inventoryMatchesCanonical(surfaceIds, CANONICAL_SURFACE_IDS))
const canvasNotifyCalls = callArguments(read('src/renderer/canvas/Canvas.tsx') || '', 'notify')
  // Keep only production object payloads. This excludes comments and the two native
  // `window.nodeTerminal.notify` calls while retaining multiline object literals.
  .filter((args) => /\bkind\s*:/.test(args) && /\btitle\s*:/.test(args))
check('canonical Canvas notification inventory is independent and complete', canvasNotifyCalls.length === CANONICAL_CANVAS_NOTIFY_CALL_IDS.length)
check('every Canvas notification has explicit title ownership', canvasNotifyCalls.length === CANONICAL_CANVAS_NOTIFY_CALL_IDS.length && canvasNotifyCalls.every((args) => /\btitleKind\s*:/.test(args)))
check('every Canvas notification body has explicit ownership', canvasNotifyCalls.length === CANONICAL_CANVAS_NOTIFY_CALL_IDS.length && canvasNotifyCalls.filter((args) => /\bbody\s*:/.test(args)).every((args) => /\bbodyKind\s*:/.test(args)))
for (const [marker, expected] of CANONICAL_CANVAS_NOTIFY_TITLE_MARKERS) {
  const actual = canvasNotifyCalls.filter((args) => args.includes(marker)).length
  check(`Canvas notification title marker ${marker} appears exactly ${expected} time(s)`, actual === expected)
}
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
  if (reason === 'mapped-callsite') {
    const mapperMarkers = [
      'useVocabularyMapper()',
      'useLocalizedVocabularyText()',
      'mapLocalVocabularyText(',
      'formatHostMessage('
    ]
    check(id + ': mapper call is present', mapperMarkers.some((marker) => hasMarker(read(file), marker)))
  }
}
const pendingProductionSurfaces = PRODUCTION_SURFACES.filter(([, , reason]) => reason === 'unmapped-callsite-pending')
check('all listed production surfaces are mapper-covered', pendingProductionSurfaces.length === 0)
if (pendingProductionSurfaces.length > 0) {
  console.error('Open producer boundaries: ' + pendingProductionSurfaces.map(([id]) => id).join(', '))
}
check('producer inventory has no duplicate identifiers', errors.length === 0)

// Deliberate red regressions use the same production predicate against copies of every real
// producer. Removing all occurrences catches a missing boundary even when a file has multiple
// calls, while codeOnly prevents a comment or quoted fixture from satisfying the predicate.
const originalRows = PRODUCERS.map((row) => row.join('|')).join('\n')
check('negative regression fixture is non-empty', originalRows.length > 0)
const producerRowsWithoutFirst = PRODUCERS.slice()
producerRowsWithoutFirst.splice(0, 1)
const surfaceRowsWithoutFirst = PRODUCTION_SURFACES.slice()
surfaceRowsWithoutFirst.splice(0, 1)
check('negative regression catches a removed canonical producer row', !inventoryMatchesCanonical(producerRowsWithoutFirst.map(([id]) => id), CANONICAL_PRODUCER_IDS))
check('negative regression catches a removed canonical surface row', !inventoryMatchesCanonical(surfaceRowsWithoutFirst.map(([id]) => id), CANONICAL_SURFACE_IDS))
for (const [id, file, marker] of PRODUCERS) {
  const source = read(file)
  check(`${id}: removed boundary is rejected`, source !== null && !hasMarker(source.split(marker).join(''), marker))
}
const auditRow = '| ' + String.fromCharCode(96) + PRODUCERS[0][0] + String.fromCharCode(96) + ' |'
check('negative regression catches a removed audit row', !(read(DOC) || '').split(auditRow).join('').includes(auditRow))

// Mutate copies of real producer and documentation files, then verify the same exact predicates
// reject the missing evidence. This is intentionally filesystem-backed, not a self-referential
// array-only assertion.
const mutationRoot = mkdtempSync(join(tmpdir(), 'nodeterm-vocabulary-audit-'))
try {
  for (const [id, file, marker] of PRODUCERS) {
    const sourcePath = join(mutationRoot, id.replace(/[^a-z0-9]+/gi, '_') + '.fixture')
    copyFileSync(join(ROOT, file), sourcePath)
    writeFileSync(sourcePath, readFileSync(sourcePath, 'utf8').split(marker).join(''), 'utf8')
    check(`${id}: real-file boundary mutation is rejected`, !hasMarker(readFileSync(sourcePath, 'utf8'), marker))
  }
  const docPath = join(mutationRoot, 'audit.md')
  copyFileSync(join(ROOT, DOC), docPath)
  const quote = String.fromCharCode(96)
  const docLines = readFileSync(docPath, 'utf8').split(/\r?\n/)
  writeFileSync(docPath, docLines.filter((line) => !line.startsWith('| ' + quote + 'tooltip' + quote + ' |')).join('\n'), 'utf8')
  check('real-file producer-row mutation is rejected', !readFileSync(docPath, 'utf8').split(/\r?\n/).some((line) => line.startsWith('| ' + quote + 'tooltip' + quote + ' |')))
  const surfaceCopy = join(mutationRoot, 'App.tsx')
  copyFileSync(join(ROOT, PRODUCTION_SURFACES[0][1]), surfaceCopy)
  writeFileSync(surfaceCopy, '', 'utf8')
  check('real-file missing-source predicate is rejected', !hasMarker(readFileSync(surfaceCopy, 'utf8'), 'export default function App'))
  const canvasCopy = join(mutationRoot, 'Canvas.tsx')
  copyFileSync(join(ROOT, 'src/renderer/canvas/Canvas.tsx'), canvasCopy)
  const canvasOriginal = readFileSync(canvasCopy, 'utf8')
  writeFileSync(canvasCopy, canvasOriginal.replace(/\btitleKind\s*:\s*['"](?:authored|fact)['"],?/g, ''), 'utf8')
  const titleMutationCalls = callArguments(readFileSync(canvasCopy, 'utf8'), 'notify').filter((args) => /\bkind\s*:/.test(args) && /\btitle\s*:/.test(args))
  check('real-file Canvas title ownership mutation is rejected', !titleMutationCalls.every((args) => /\btitleKind\s*:/.test(args)))
  writeFileSync(canvasCopy, canvasOriginal.replace(/\bbodyKind\s*:\s*['"](?:authored|fact)['"],?/g, ''), 'utf8')
  const bodyMutationCalls = callArguments(readFileSync(canvasCopy, 'utf8'), 'notify').filter((args) => /\bkind\s*:/.test(args) && /\btitle\s*:/.test(args))
  check('real-file Canvas body ownership mutation is rejected', !bodyMutationCalls.filter((args) => /\bbody\s*:/.test(args)).every((args) => /\bbodyKind\s*:/.test(args)))
  const titleMarkerMutation = join(mutationRoot, 'Canvas-title-marker.tsx')
  writeFileSync(titleMarkerMutation, canvasOriginal.split('Folder drop cancelled').join(''), 'utf8')
  const markerMutationCalls = callArguments(readFileSync(titleMarkerMutation, 'utf8'), 'notify').filter((args) => /\bkind\s*:/.test(args) && /\btitle\s*:/.test(args))
  check('real-file Canvas title inventory mutation is rejected', markerMutationCalls.filter((args) => args.includes('Folder drop cancelled')).length !== 2)
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
