#!/usr/bin/env node

// Hand-written producer inventory for the renderer's local personal-vocabulary boundary.
// Discovery is intentionally not used: a producer removed from this list must make this check red.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const scriptArgs = process.argv.slice(2)
const rootIndex = scriptArgs.indexOf('--root')
const ROOT = rootIndex >= 0 && scriptArgs[rootIndex + 1]
  ? scriptArgs[rootIndex + 1]
  : join(dirname(SCRIPT_PATH), '..')
const manifestModule = await import(pathToFileURL(join(ROOT, 'scripts/personal-vocabulary-producer-manifest.mjs')).href + `?coverage=${Date.now()}-${Math.random()}`)
const {
  PERSONAL_VOCABULARY_DOCS,
  PERSONAL_VOCABULARY_FOCUSED_TESTS,
  PERSONAL_VOCABULARY_POLICIES,
  PERSONAL_VOCABULARY_PRODUCERS
} = manifestModule
const fixtureRun = scriptArgs.includes('--fixture-run')
const quiet = scriptArgs.includes('--summary')
const skipMutations = scriptArgs.includes('--skip-mutations')
const dropSectionIndex = scriptArgs.indexOf('--drop-section')
const PRODUCERS = [
  ['settings-fields', 'src/renderer/components/settings/FieldRow.tsx', 'useVocabularyText('],
  ['settings-sections', 'src/renderer/components/settings/SettingsSection.tsx', 'useVocabularyText('],
  ['personal-vocabulary-upload', 'src/renderer/components/settings/sections/PersonalVocabularySection.tsx', 'usePersonalVocabulary('],
  ['settings-page-vocabulary-boundary', 'src/renderer/components/settings/SettingsPage.tsx', 'useLocalizedVocabularyText()'],
  ['settings-page-registration', 'src/renderer/components/settings/SettingsPage.tsx', '<PersonalVocabularySection'],
  ['settings-sidebar-vocabulary-boundary', 'src/renderer/components/settings/SettingsSidebar.tsx', 'useI18n()'],
  ['settings-sidebar-registration', 'src/renderer/components/settings/SettingsSidebar.tsx', 'visibleSettingsGroups('],
  ['settings-section-registry', 'src/renderer/components/settings/nav.ts', 'SETTINGS_SECTION_REGISTRY'],
  ['settings-search-corpus', 'src/renderer/components/settings/SearchableRow.tsx', 'useVocabularyMapper()'],
  ['settings-inline-copy', 'src/renderer/components/settings/SettingsText.tsx', 'useVocabularyMapper()'],
  ['settings-reset', 'src/renderer/components/settings/SectionReset.tsx', 'useVocabularyMapper()'],
  ['settings-font-picker', 'src/renderer/components/settings/FontPicker.tsx', 'useVocabularyMapper()'],
  ['settings-theme-picker', 'src/renderer/components/settings/ThemeSelect.tsx', 'useVocabularyMapper()'],
  ['settings-section-inline-copy', 'src/renderer/components/settings/SettingsText.tsx', 'export function SettingsText'],
  ['settings-copy-facts', 'src/renderer/components/settings/SettingsText.tsx', 'SettingsTextSegment'],
  ['settings-resolution-ownership', 'src/renderer/components/settings/context.ts', 'resolutionIncludes'],
  ['settings-search-policy', 'src/renderer/components/settings/vocabulary.ts', 'export function settingsSidebarSearchEntry'],
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
  ['wsl-create-dialog', 'src/renderer/wsl/WslCreateDialog.tsx', 'useVocabularyMapper()'],
  ['terminal-node', 'src/renderer/nodes/TerminalNode.tsx', 'useVocabularyMapper()'],
  ['sticky-node', 'src/renderer/nodes/StickyNode.tsx', 'useVocabularyMapper()'],
  ['group-node', 'src/renderer/nodes/GroupNode.tsx', 'useVocabularyMapper()'],
  ['editor-node', 'src/renderer/nodes/EditorNode.tsx', 'useVocabularyMapper()'],
  ['diff-node', 'src/renderer/nodes/DiffNode.tsx', 'useVocabularyMapper()'],
  ['browser-node', 'src/renderer/nodes/BrowserNode.tsx', 'useVocabularyMapper()'],
  ['browser-surface', 'src/renderer/nodes/BrowserSurface.tsx', 'useVocabularyMapper()'],
  ['browser-start-page', 'src/renderer/nodes/BrowserStartPage.tsx', 'useVocabularyMapper()'],
  ['browser-extensions-panel', 'src/renderer/nodes/BrowserExtensionsPanel.tsx', 'useVocabularyMapper()'],
  ['discarded-plate', 'src/renderer/nodes/DiscardedPlate.tsx', 'useVocabularyMapper()'],
  ['video-node', 'src/renderer/nodes/VideoNode.tsx', 'useVocabularyMapper()'],
  ['web-node', 'src/renderer/nodes/WebNode.tsx', 'useVocabularyMapper()'],
  ['loop-node', 'src/renderer/nodes/LoopNode.tsx', 'useVocabularyMapper()'],
  ['native-loop-node', 'src/renderer/nodes/NativeLoopNode.tsx', 'useVocabularyMapper()'],
  ['nsis-node', 'src/renderer/nodes/NsisInstallerNode.tsx', 'useVocabularyMapper()'],
  ['service-node', 'src/renderer/nodes/ServiceNode.tsx', 'useVocabularyMapper()'],
  ['authenticator-node', 'src/renderer/nodes/AuthenticatorNode.tsx', 'useVocabularyMapper()'],
  ['annotation-node', 'src/renderer/nodes/AnnotationNode.tsx', 'useVocabularyMapper()'],
  ['dino-node', 'src/renderer/nodes/DinoNode.tsx', 'useVocabularyMapper()'],
  ['subagent-node', 'src/renderer/nodes/SubagentNode.tsx', 'useVocabularyMapper()'],
  ['chat-panel', 'src/renderer/nodes/ChatPanel.tsx', 'useVocabularyMapper()'],
  ['node-fact-preserving-mapper', 'src/renderer/nodes/nodeVocabulary.ts', 'export function mapAroundExactFacts'],
  ['password-manager', 'src/renderer/components/passwordManager/PasswordManagerPanel.tsx', 'const vocab = useVocabularyMapper()'],
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
  ['bulk-preview-segments', 'src/renderer/components/BulkActionPreview.tsx', 'messageSegments={messageSegments}'],
  ['bulk-preview-single-title-map', 'src/renderer/components/BulkActionBar.tsx', 'titleSegments={[copy(pending.label)]}'],
  ['project-storage-segments', 'src/renderer/components/ProjectSwitcher.tsx', 'messageSegments={'],
  ['project-other-unread-fact', 'src/renderer/components/ProjectSwitcher.tsx', "unreadCountSegments(otherUnread, ' unread in other projects')"],
  ['converter-detection-note-fact', 'src/renderer/components/converter/FileConverterPanel.tsx', 'f.detection.note'],
  ['converter-adapter-id-corpus', 'src/renderer/components/converter/AdapterCatalog.tsx', 'adapterSearchCorpus('],
  ['ollama-staleness-segments', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'catalogStalenessSegments('],
  ['ollama-completeness-segments', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'catalogHeadlineText('],
  ['ollama-completeness-reason-fact', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'mapOwnedSentence(vocab, [fact(reason)]'],
  ['ollama-queue-phase-fact', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'item.digestPhase ??'],
  ['ollama-fit-evidence-fact', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', "vocab('Evidence:')"],
  ['appearance-weight-segments', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'w.label.indexOf'],
  ['appearance-font-preview-fact', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'quoteFamily(primary ||'],
  ['docs-section-copy', 'src/renderer/components/DocsBrowser.tsx', 'vocab(section.label'],
  ['history-restore-segments', 'src/renderer/components/LocalHistoryPanel.tsx', 'messageSegments={historyRestoreMessageSegments('],
  ['converter-upload-limit', 'src/renderer/components/converter/FileConverterPanel.tsx', 'mapLocalVocabularyText('],
  ['minecraft-backups', 'src/renderer/components/minecraft/MinecraftBackupsPanel.tsx', 'useVocabularyMapper()'],
  ['minecraft-players', 'src/renderer/components/minecraft/MinecraftPlayersPanel.tsx', 'useVocabularyMapper()'],
  ['minecraft-properties', 'src/renderer/components/minecraft/MinecraftPropertiesEditor.tsx', 'useVocabularyMapper()'],
  ['authenticator-settings', 'src/renderer/components/settings/sections/AuthenticatorSection.tsx', 'const vocab = useVocabularyMapper()'],
  ['speech-settings', 'src/renderer/components/settings/sections/SpeechSection.tsx', 'useVocabularyMapper()'],
  ['school-mode-settings', 'src/renderer/components/settings/sections/SchoolModeSection.tsx', 'useVocabularyMapper()'],
  ['kids-mode-settings', 'src/renderer/components/settings/sections/KidsModeSection.tsx', 'useVocabularyMapper()'],
  ['usage-settings', 'src/renderer/components/settings/sections/UsageSection.tsx', 'useVocabularyMapper()'],
  ['toy-lock-wizard', 'src/renderer/components/toylocks/LockWizard.tsx', 'useVocabularyMapper()'],
  ['shared-prose-primitives', 'src/renderer/ui/md3/Button.tsx', 'useVocabularyMapper()'],
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
  ['shared-input-controls', 'src/renderer/ui/md3/Slider.tsx', 'useVocabularyMapper()'],
  ['filterable-menu', 'src/renderer/components/menu/FilterableMenu.tsx', 'useVocabularyMapper()'],
  ['editable-node-title', 'src/renderer/components/EditableNodeTitle.tsx', 'useVocabularyMapper()'],
  ['destructive-confirm-gate', 'src/renderer/components/DestructiveConfirmGate.tsx', 'useVocabularyMapper()'],
  ['personal-vocabulary-surface-mapper', 'src/renderer/lib/personalVocabulary/surfaces.ts', 'applyVocabularyToMenuItems'],
  ['personal-vocabulary-application', 'src/renderer/lib/personalVocabulary/apply.ts', 'export function applyVocabulary'],
  ['typed-copy-fact-boundary', 'src/renderer/lib/personalVocabulary/ownedCopy.ts', 'mapOwnedSentence'],
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
  ['native-notification-settings', 'src/renderer/components/settings/sections/NotificationsSection.tsx', 'mapNativeNotification('],
  ['personal-vocabulary-template', 'src/renderer/lib/personalVocabulary/apply.ts', 'export function applyVocabularyToTemplate'],
  ['native-notification-browser', 'src/renderer/bridge/stubs.ts', 'mapNativeNotification('],
  ['native-notification-main', 'src/main/notifications.ts', 'prepareNativeNotification(']
]

const DOC = 'docs/features/appearance/material-3-audit.md'
const PRODUCTION_SURFACES = [
  ['app-shell', 'src/renderer/App.tsx', 'shell-only-no-copy'],
  ['welcome', 'src/renderer/components/WelcomeScreen.tsx', 'mapped-callsite'],
  ['top-app-bar', 'src/renderer/components/TopAppBar.tsx', 'user-display-only'],
  ['status-surface', 'src/renderer/components/StatusSurface.tsx', 'mapped-callsite'],
  ['sessions-sidebar', 'src/renderer/components/SessionsSidebar.tsx', 'mapped-callsite'],
  ['session-row', 'src/renderer/components/SessionRow.tsx', 'mapped-callsite'],
  ['terminal-node', 'src/renderer/nodes/TerminalNode.tsx', 'mapped-callsite'],
  ['sticky-node', 'src/renderer/nodes/StickyNode.tsx', 'mapped-callsite'],
  ['group-node', 'src/renderer/nodes/GroupNode.tsx', 'mapped-callsite'],
  ['editor-node', 'src/renderer/nodes/EditorNode.tsx', 'mapped-callsite'],
  ['diff-node', 'src/renderer/nodes/DiffNode.tsx', 'mapped-callsite'],
  ['browser-node', 'src/renderer/nodes/BrowserNode.tsx', 'mapped-callsite'],
  ['web-node', 'src/renderer/nodes/WebNode.tsx', 'mapped-callsite'],
  ['video-node', 'src/renderer/nodes/VideoNode.tsx', 'mapped-callsite'],
  ['loop-node', 'src/renderer/nodes/LoopNode.tsx', 'mapped-callsite'],
  ['service-node', 'src/renderer/nodes/ServiceNode.tsx', 'mapped-callsite'],
  ['native-loop-node', 'src/renderer/nodes/NativeLoopNode.tsx', 'mapped-callsite'],
  ['nsis-node', 'src/renderer/nodes/NsisInstallerNode.tsx', 'mapped-callsite'],
  ['authenticator-node', 'src/renderer/nodes/AuthenticatorNode.tsx', 'mapped-callsite'],
  ['annotation-node', 'src/renderer/nodes/AnnotationNode.tsx', 'mapped-callsite'],
  ['dino-node', 'src/renderer/nodes/DinoNode.tsx', 'mapped-callsite'],
  ['subagent-node', 'src/renderer/nodes/SubagentNode.tsx', 'mapped-callsite'],
  ['chat-panel', 'src/renderer/nodes/ChatPanel.tsx', 'mapped-callsite'],
  ['browser-surface', 'src/renderer/nodes/BrowserSurface.tsx', 'mapped-callsite'],
  ['browser-start-page', 'src/renderer/nodes/BrowserStartPage.tsx', 'mapped-callsite'],
  ['browser-extensions-panel', 'src/renderer/nodes/BrowserExtensionsPanel.tsx', 'mapped-callsite'],
  ['discarded-plate', 'src/renderer/nodes/DiscardedPlate.tsx', 'mapped-callsite'],
  ['wsl-dialog', 'src/renderer/wsl/WslCreateDialog.tsx', 'mapped-callsite'],
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
  ['pty-pressure', 'src/renderer/components/PtyPressureBanner.tsx', 'mapped-callsite'],
  ['update-card', 'src/renderer/components/UpdateCard.tsx', 'mapped-callsite'],
  ['resume-card', 'src/renderer/components/ResumeCard.tsx', 'mapped-callsite'],
  ['announcement-banner', 'src/renderer/components/AnnouncementBanner.tsx', 'mapped-callsite'],
  ['session-memory', 'src/renderer/components/SessionMemoryPanel.tsx', 'mapped-callsite'],
  ['remote-access-dialog', 'src/renderer/components/RemoteAccessDialog.tsx', 'mapped-callsite'],
  ['ssh-project-dialog', 'src/renderer/components/SshProjectDialog.tsx', 'mapped-callsite'],
  ['phone-pair-popover', 'src/renderer/components/PhonePairPopover.tsx', 'mapped-callsite'],
  ['dictation-overlay', 'src/renderer/components/DictationOverlay.tsx', 'mapped-callsite'],
  ['widget-entrypoint', 'src/renderer/widget/WidgetApp.tsx', 'mapped-callsite'],
  ['hud-entrypoint', 'src/renderer/hud/main.ts', 'mapped-callsite'],
  ['dialog-picker-root', 'src/renderer/bridge/dialog-picker.tsx', 'mapped-callsite'],
  ['ws-reconnect-overlay', 'src/renderer/bridge/ws-bridge.ts', 'mapped-callsite'],
  ['browser-bridge-stubs', 'src/renderer/bridge/stubs.ts', 'mapped-callsite']
]

// Independent hand-written manifests. The mutable rows above are implementation evidence; these
// lists are the required universe, so deleting a row cannot delete its own requirement too.
// Every Settings section is listed explicitly. The shared FieldRow/SettingsSection funnels cover
// their ordinary rows, while SettingsText marks standalone inline prose and the shared primitives
// cover labels/options. Keeping this list hand-written means deleting a section cannot make its
// vocabulary audit disappear with it.
const SETTINGS_SECTION_BOUNDARY_MANIFEST = [
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
  ['settings-sidebar-corpus-test', 'src/renderer/components/settings/vocabulary.test.tsx'],
  ['settings-i18n-boundary-test', 'src/renderer/lib/i18n.test.tsx'],
  ['settings-control-intent-test', 'src/renderer/ui/personalVocabulary.test.tsx']
]
// Explicit mixed-copy callsites called out by the Settings audit. These ids are intentionally
// narrower than a file-level section row: each one names the exact shared boundary expected in the
// cited surface, so moving or deleting that boundary turns this check red.
const MIXED_STRING_BOUNDARY_MANIFEST = [
  ['accounts-mixed-facts', 'src/renderer/components/settings/sections/AccountsSection.tsx', 'SettingsText'],
  ['app-identity-mixed-facts', 'src/renderer/components/settings/sections/AppIdentitySection.tsx', 'SettingsText'],
  ['appearance-mixed-facts', 'src/renderer/components/settings/sections/AppearanceSection.tsx', 'SettingsText'],
  ['narrator-mixed-facts', 'src/renderer/components/settings/sections/NarratorSection.tsx', 'SettingsText'],
  ['phone-mixed-facts', 'src/renderer/components/settings/sections/PhoneSection.tsx', 'SettingsText'],
  ['schedule-mixed-facts', 'src/renderer/components/settings/sections/ScheduleSection.tsx', 'SettingsText'],
  ['school-mixed-facts', 'src/renderer/components/settings/sections/SchoolModeSection.tsx', 'SettingsText'],
  ['kids-mixed-facts', 'src/renderer/components/settings/sections/KidsModeSection.tsx', 'SettingsText'],
  ['speech-mixed-facts', 'src/renderer/components/settings/sections/SpeechSection.tsx', 'SettingsText'],
  ['terminal-mixed-facts', 'src/renderer/components/settings/sections/TerminalSection.tsx', 'SettingsText'],
  ['workspace-mixed-facts', 'src/renderer/components/settings/sections/WorkspaceStorageSection.tsx', '<FieldRow'],
  ['custom-agents-mixed-facts', 'src/renderer/components/settings/sections/CustomAgentsSection.tsx', '<FieldRow'],
  ['ssh-mixed-facts', 'src/renderer/components/settings/sections/SshSection.tsx', '<FieldRow'],
  ['shortcuts-mixed-facts', 'src/renderer/components/settings/sections/ShortcutsSection.tsx', '<FieldRow'],
  ['support-mixed-facts', 'src/renderer/components/settings/sections/SupportTicketsSection.tsx', 'SettingsText']
]
const expectedSettingsSectionCount = 36
if (dropSectionIndex >= 0 && scriptArgs[dropSectionIndex + 1]) {
  const dropped = scriptArgs[dropSectionIndex + 1]
  const index = SETTINGS_SECTION_BOUNDARY_MANIFEST.findIndex(([id]) => id === dropped)
  if (index >= 0) SETTINGS_SECTION_BOUNDARY_MANIFEST.splice(index, 1)
}
const CANONICAL_CANVAS_NOTIFY_CALL_IDS = `terminal-profile-create-unavailable terminal-create-placement-failed file-open-node-placement-failed working-diff-node-placement-failed commit-diff-node-placement-failed commit-explanation-node-placement-failed service-node-placement-failed sticky-node-placement-failed authenticator-node-placement-failed native-loop-node-placement-failed nsis-node-placement-failed dino-node-placement-failed web-node-placement-failed browser-node-placement-failed files-node-placement-failed catalog-node-unavailable aws-universe-create-unavailable catalog-node-placement-failed claude-account-login-node-placement-failed codex-account-login-node-placement-failed agent-node-placement-failed explorer-agent-folder-drop-stale-project explorer-agent-folder-drop-missing-source explorer-agent-folder-node-placement-failed explorer-terminal-folder-drop-stale-project explorer-terminal-folder-node-placement-failed ssh-terminal-node-placement-failed wsl-group-node-placement-failed worktree-group-node-placement-failed duplicate-node-placement-failed terminal-profile-restart-disabled terminal-profile-restart-failed conversation-branch-failed conversation-branch-node-placement-failed conversation-transfer-not-ready conversation-transfer-failed conversation-transfer-node-placement-failed reopen-last-closed-node-placement-failed board-terminal-profile-unavailable board-node-placement-failed transcript-resume-node-placement-failed canvas-control-node-placement-failed canvas-control-verify-node-placement-failed portable-media-inspection-failed project-save-busy project-save-progress project-save-success project-save-cancelled project-save-failed project-password-mismatch project-open-busy project-open-cancelled project-open-password-check project-open-success project-open-failed test-notification kiosk-pwa-node-placement-failed`.split(/\s+/)
// Keep the expected title evidence independent from the mutable callsite count. A replacement
// notification with the same number of arguments must not make the inventory look complete.
const CANONICAL_CANVAS_NOTIFY_TITLE_MARKERS = [
  ['terminalProfiles.common.unavailableHereTitle', 2],
  ['Node placement unavailable', 32],
  ['Node unavailable', 1],
  ['AWS Universe unavailable', 1],
  ['Folder drop cancelled', 2],
  ['Agent drop cancelled', 1],
  ['terminalProfiles.restart.failedTitle', 2],
  ['Branch failed', 1],
  ['Conversation not ready to transfer yet.', 1],
  ['Transfer failed', 1],
  ['Media inspection failed', 1],
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
  ['Planner definitions configured', 1],
  ['Planner configuration failed', 1],
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
  } else if (!quiet || label.startsWith('full checker rejects')) console.log('✓ ' + label)
}

const errors = []
const ids = new Set()
const producerIds = PRODUCERS.map(([id]) => id)
const surfaceIds = PRODUCTION_SURFACES.map(([id]) => id)

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
for (const [id, file, sectionId] of SETTINGS_SECTION_BOUNDARY_MANIFEST) {
  const source = read(file)
  check(id + ': exact settings section exists', source !== null)
  check(id + ': exact Material/settings audit row', (read(DOC) || '').includes('| ' + String.fromCharCode(96) + id + String.fromCharCode(96) + ' |'))
  check(id + ': section registration boundary', hasMarker(source, `id="${sectionId}"`))
  check(id + ': active-state boundary', (source || '').includes('isActive'))
  const uncommented = noComments(source || '')
  // Classification is deliberately marker-exact. The registered section id above is the
  // existence boundary, while these exact callsite markers record the shared funnels in use.
  const hasExact = (markers) => markers.some((marker) => uncommented.includes(marker))
  check(id + ': authored prose boundary', hasExact(['SettingsText', '<FieldRow', '<SettingsSection']))
  check(id + ': accessible-control classification', hasExact(['aria-label=', 'ariaLabel=', 'htmlFor=', 'placeholder=', '<SettingsSection']))
  check(id + ': option-or-fact classification', hasExact(['<option', 'options=', 'formatText', 'profileText', 'value=', `id="${sectionId}"`]))
}
for (const [id, file, marker] of MIXED_STRING_BOUNDARY_MANIFEST) {
  check(id + ': exact source exists', read(file) !== null)
  check(id + ': exact mixed-copy boundary', hasMarker(read(file), marker))
}
for (const [id, file] of FOCUSED_TEST_INVENTORY) check(id + ': focused test exists', read(file) !== null)
check('settings section boundary manifest is complete', SETTINGS_SECTION_BOUNDARY_MANIFEST.length === expectedSettingsSectionCount)
check('settings section boundary manifest has unique ids', new Set(SETTINGS_SECTION_BOUNDARY_MANIFEST.map(([id]) => id)).size === SETTINGS_SECTION_BOUNDARY_MANIFEST.length)
const pendingProductionSurfaces = PRODUCTION_SURFACES.filter(([, , reason]) => reason === 'unmapped-callsite-pending')
if (!fixtureRun) check('all listed production surfaces are mapper-covered', pendingProductionSurfaces.length === 0)
if (!fixtureRun && pendingProductionSurfaces.length > 0) {
  console.error('Open producer boundaries: ' + pendingProductionSurfaces.map(([id]) => id).join(', '))
}
check('producer inventory has no duplicate identifiers', errors.length === 0)

function codeOnly(source, file = 'source.tsx') {
  const chars = [...source]
  let quote = ''
  let escaped = false
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]
    const next = chars[i + 1]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '/' && next === '/') {
      while (i < chars.length && chars[i] !== '\n' && chars[i] !== '\r') { chars[i] = ' '; i += 1 }
      i -= 1
    } else if (ch === '/' && next === '*') {
      chars[i] = chars[i + 1] = ' '
      i += 2
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) { if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '; i += 1 }
      if (i < chars.length) chars[i] = chars[i + 1] = ' '
      i += 1
    }
  }
  return chars.join('')
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

function manifestMarkerPresent(file, markers) {
  const source = read(file)
  if (source === null) return false
  const clean = codeOnly(source, file)
  return markers.some((marker) => clean.includes(marker))
}

const manifestIds = PERSONAL_VOCABULARY_PRODUCERS.map((row) => row.id)
check('canonical producer manifest has unique ids', new Set(manifestIds).size === manifestIds.length)
check('canonical producer manifest is not empty', manifestIds.length > 0)
for (const policy of PERSONAL_VOCABULARY_POLICIES) {
  check(`policy ${policy.id} is uniquely named`, PERSONAL_VOCABULARY_POLICIES.filter((entry) => entry.id === policy.id).length === 1)
  for (const [file, marker] of policy.markers) check(`policy ${policy.id}: ${file} owns ${marker}`, manifestMarkerPresent(file, [marker]))
}

const testIds = new Set(PERSONAL_VOCABULARY_FOCUSED_TESTS.map(([id]) => id))
for (const [id, file, marker] of PERSONAL_VOCABULARY_FOCUSED_TESTS) {
  check(`focused test ${id}: file exists`, read(file) !== null)
  check(`focused test ${id}: exact suite marker`, manifestMarkerPresent(file, [marker, 'describe(', 'test(']))
}

const allowedClassifications = new Set(['authored', 'mixed', 'factual-only', 'provider-literal', 'no-prose'])
for (const row of PERSONAL_VOCABULARY_PRODUCERS) {
  check(`${row.id}: source exists`, read(row.file) !== null)
  check(`${row.id}: classification is explicit`, allowedClassifications.has(row.classification))
  check(`${row.id}: policy exists`, PERSONAL_VOCABULARY_POLICIES.some((policy) => policy.id === row.policy))
  check(`${row.id}: implementation state is explicit`, row.implementation === 'covered' || row.implementation === 'open')
  if (!fixtureRun) check(`${row.id}: implementation gap is closed`, row.implementation === 'covered')
  if (row.implementation === 'open') check(`${row.id}: open gap has an exact reason`, row.openReason.length > 12)
  for (const [file, ...alternatives] of row.reachability) check(`${row.id}: exact reachability marker`, manifestMarkerPresent(file, alternatives))
  if (row.implementation === 'covered' || !fixtureRun) {
    for (const marker of row.consumptionMarkers) check(`${row.id}: exact mapper or segment consumption ${marker}`, manifestMarkerPresent(row.file, [marker]))
  }
  if ((row.classification === 'mixed' || row.classification === 'factual-only' || row.classification === 'provider-literal') && !(fixtureRun && row.implementation === 'open')) {
    check(`${row.id}: factual binding reason`, row.factReason.length > 12)
    check(`${row.id}: exact factual binding marker`, row.factMarkers.length > 0 && row.factMarkers.some((marker) => manifestMarkerPresent(row.file, [marker])))
  } else check(`${row.id}: no-fact reason is explicit`, row.factReason.length > 12)
  check(`${row.id}: exact audit documentation row`, (read(PERSONAL_VOCABULARY_DOCS.audit) || '').includes(`| \`${row.docsRow}\` |`))
  check(`${row.id}: focused tests are declared`, row.focusedTests.length > 0 && row.focusedTests.every((id) => testIds.has(id)))
}

const canvasSource = codeOnly(read('src/renderer/canvas/Canvas.tsx') || '', 'Canvas.tsx')
const discoveredCanvasKeys = new Set()
for (const match of canvasSource.matchAll(/(?:^|\n)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z][A-Za-z0-9-]*))\s*:\s*withNodeBoundary\(/g)) discoveredCanvasKeys.add(match[1] || match[2] || match[3])
const manifestCanvasKeys = new Set(PERSONAL_VOCABULARY_PRODUCERS.filter((row) => row.family === 'canvas-node').map((row) => row.registrationKey))
check('Canvas node discovery matches the hand-written manifest exactly', sameSet(discoveredCanvasKeys, manifestCanvasKeys))

const lazySource = codeOnly(read('src/renderer/components/lazyPanels.tsx') || '', 'lazyPanels.tsx')
const discoveredLazyPanels = new Set([...lazySource.matchAll(/export const ([A-Za-z0-9_]+) = withSuspense\(/g)].map((match) => match[1]))
const manifestLazyPanels = new Set(PERSONAL_VOCABULARY_PRODUCERS.filter((row) => row.family === 'lazy-panel').map((row) => row.registrationKey))
check('lazy panel discovery matches the hand-written manifest exactly', sameSet(discoveredLazyPanels, manifestLazyPanels))

const appSource = codeOnly(read('src/renderer/App.tsx') || '', 'App.tsx')
const discoveredRootComponents = new Set([...appSource.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map((match) => match[1]))
const manifestRootComponents = new Set(PERSONAL_VOCABULARY_PRODUCERS.filter((row) => row.family === 'root-host').map((row) => row.registrationKey))
check('root component discovery matches the hand-written manifest exactly', sameSet(discoveredRootComponents, manifestRootComponents))

function listSourceFiles(path) {
  if (!existsSync(path)) return []
  const result = []
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name)
    if (entry.isDirectory()) result.push(...listSourceFiles(absolute))
    else result.push(absolute)
  }
  return result
}

const discoveredFocusedTests = new Set(
  [...listSourceFiles(join(ROOT, 'src')), ...listSourceFiles(join(ROOT, 'site'))]
    .map((file) => file.slice(ROOT.length + 1).replaceAll('\\', '/'))
    .filter((file) => /(?:\.vocabulary\.test\.|\/vocabulary\.test\.|node-vocabulary\.test\.|personalVocabulary\/.*\.test\.|personalVocabulary\.test\.|vocabulary-state\.test\.|main\/notifications\.test\.)/.test(file))
)
const manifestFocusedTests = new Set(PERSONAL_VOCABULARY_FOCUSED_TESTS.map(([, file]) => file))
check('focused test discovery matches the hand-written test inventory exactly', sameSet(discoveredFocusedTests, manifestFocusedTests))
if (!sameSet(discoveredFocusedTests, manifestFocusedTests)) {
  console.error('Focused tests missing from manifest: ' + [...discoveredFocusedTests].filter((file) => !manifestFocusedTests.has(file)).join(', '))
  console.error('Manifest tests not discovered: ' + [...manifestFocusedTests].filter((file) => !discoveredFocusedTests.has(file)).join(', '))
}

function topLevelPropertyNames(args) {
  const names = new Set()
  let depth = 0
  let quote = ''
  let escaped = false
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue }
    if (ch === '{' || ch === '(' || ch === '[') { depth += 1; continue }
    if (ch === '}' || ch === ')' || ch === ']') { depth -= 1; continue }
    if (depth !== 1 || !/[A-Za-z_$]/.test(ch)) continue
    const match = args.slice(i).match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/)
    if (match) { names.add(match[1]); i += match[0].length - 1 }
  }
  return names
}

const notificationProblems = []
for (const file of listSourceFiles(join(ROOT, 'src/renderer')).filter((file) => /\.tsx?$/.test(file) && !/\.(?:test|spec)\./.test(file))) {
  const source = readFileSync(file, 'utf8')
  const clean = codeOnly(source, file)
  const notifyNames = new Set()
  const storeNames = new Set()
  const nativeMapperNames = new Set()
  for (const match of clean.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const moduleName = match[2]
    for (const item of match[1].split(',')) {
      const parts = item.trim().split(/\s+as\s+/)
      const imported = parts[0]?.trim()
      const local = parts[1]?.trim() || imported
      if (/(?:state\/notifications|lib\/adhdNotify)$/.test(moduleName) && imported === 'notify') notifyNames.add(local)
      if (/state\/notifications$/.test(moduleName) && imported === 'useNotifications') storeNames.add(local)
      if (/personalVocabulary\/hostMessage$/.test(moduleName) && imported === 'mapNativeNotification') nativeMapperNames.add(local)
    }
  }
  const inspectPayload = (args, label) => {
    if (!/^\s*\{/.test(args)) { notificationProblems.push(`${label}: payload is not a direct object literal`); return }
    const names = topLevelPropertyNames(args)
    if (names.has('title') && !names.has('titleKind')) notificationProblems.push(`${label}: titleKind is missing`)
    if (names.has('body') && !names.has('bodyKind')) notificationProblems.push(`${label}: bodyKind is missing`)
  }
  for (const name of notifyNames) for (const args of callArguments(clean, name)) inspectPayload(args, file)
  for (const name of storeNames) for (const args of callArguments(clean, `${name}.getState().push`)) inspectPayload(args, file)
  for (const args of callArguments(clean, 'window.nodeTerminal.notify')) {
    const mapper = [...nativeMapperNames].find((name) => args.trimStart().startsWith(`${name}(`))
    if (!mapper) notificationProblems.push(`${file}: native notification bypasses mapNativeNotification`)
    else {
      const mappedCalls = callArguments(args, mapper)
      if (mappedCalls.length !== 1) notificationProblems.push(`${file}: native notification mapper payload is ambiguous`)
      else inspectPayload(mappedCalls[0], file)
    }
  }
}
if (!fixtureRun) {
  check('notification producers use comment-safe, top-level ownership properties', notificationProblems.length === 0)
  if (notificationProblems.length) for (const problem of notificationProblems) console.error('Open notification boundary: ' + problem)
}

const personalStateCode = codeOnly(read('src/renderer/state/personalVocabulary.ts') || '', 'personalVocabulary.ts')
check('personal vocabulary state has no IPC or network privacy sink', !/(?:window\.nodeTerminal|ipcRenderer|fetch\s*\(|client\.request\s*\(|WebSocket\s*\()/.test(personalStateCode))
const preloadCode = codeOnly(read('src/preload/index.ts') || '', 'preload.ts')
check('native notification IPC sends exactly the typed payload', /notify\s*:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(IPC\.appNotify,\s*payload\)/.test(preloadCode))
const mainNotificationCode = codeOnly(read('src/main/notifications.ts') || '', 'notifications.ts')
check('main native notification boundary never reads vocabulary state', !/(?:applyVocabulary|readLocalVocabularyEntries|PersonalVocabulary|CACHE_KEY)/.test(mainNotificationCode))

// Deliberate red regressions use the same production predicate against copies of every real
// producer. Removing all occurrences catches a missing boundary even when a file has multiple
// calls, while codeOnly prevents a comment or quoted fixture from satisfying the predicate.
const originalRows = PRODUCERS.map((row) => row.join('|')).join('\n')
check('negative regression fixture is non-empty', originalRows.length > 0)
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
// Mutate a complete fixture and execute this checker against it, rather than only invoking one
// predicate in memory. This catches a broken checker that accidentally passes its own miniature
// assertion while the real inventory path would still accept a missing producer.
function copyCompleteFixture(fixtureRoot) {
  const manifestFiles = new Set([
    'scripts/personal-vocabulary-producer-manifest.mjs',
    ...PERSONAL_VOCABULARY_PRODUCERS.flatMap((row) => [row.file, ...row.reachability.map(([file]) => file)]),
    ...PERSONAL_VOCABULARY_POLICIES.flatMap((policy) => policy.markers.map(([file]) => file)),
    ...PERSONAL_VOCABULARY_FOCUSED_TESTS.map(([, file]) => file),
    ...Object.values(PERSONAL_VOCABULARY_DOCS),
    'src/renderer/state/personalVocabulary.ts',
    'src/preload/index.ts',
    'src/main/notifications.ts',
    'src/main/index.ts',
    'src/shared/ipc.ts'
  ])
  const rows = [...PRODUCERS, ...PRODUCTION_SURFACES, ...SETTINGS_SECTION_BOUNDARY_MANIFEST, ...MIXED_STRING_BOUNDARY_MANIFEST, ...FOCUSED_TEST_INVENTORY, ['audit-doc', DOC, ''], ...[...manifestFiles].map((file) => ['manifest', file, ''])]
  for (const [, file] of rows) {
    const source = join(ROOT, file)
    const target = join(fixtureRoot, file)
    mkdirSync(dirname(target), { recursive: true })
    if (existsSync(source)) copyFileSync(source, target)
  }
}

function runFreshFixtureMutation(label, mutate, args = []) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'nodeterm-vocabulary-audit-'))
  try {
    copyCompleteFixture(fixtureRoot)
    mutate(fixtureRoot)
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--root', fixtureRoot, '--fixture-run', '--summary', ...args], {
      encoding: 'utf8'
    })
    check(label, result.status !== 0)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

if (!fixtureRun && !skipMutations) {
  const baselineRoot = mkdtempSync(join(tmpdir(), 'nodeterm-vocabulary-audit-baseline-'))
  try {
    copyCompleteFixture(baselineRoot)
    const baselineResult = spawnSync(process.execPath, [SCRIPT_PATH, '--root', baselineRoot, '--fixture-run', '--summary'], { encoding: 'utf8' })
    if (baselineResult.status !== 0) {
      console.error('Fixture baseline output:\n' + baselineResult.stdout + baselineResult.stderr)
    }
    check('complete fixture passes before mutation', baselineResult.status === 0)
  } finally {
    rmSync(baselineRoot, { recursive: true, force: true })
  }

  const target = PRODUCERS.find(([id]) => id === 'tooltip')
  if (target) runFreshFixtureMutation('full checker rejects a removed mapper call', (root) => {
    const path = join(root, target[1])
    writeFileSync(path, readFileSync(path, 'utf8').replace(target[2], ''), 'utf8')
  })

  const inlineTarget = PRODUCERS.find(([id]) => id === 'settings-inline-copy')
  if (inlineTarget) runFreshFixtureMutation('full checker rejects a removed SettingsText mapper', (root) => {
    const path = join(root, inlineTarget[1])
    writeFileSync(path, readFileSync(path, 'utf8').replace(inlineTarget[2], ''), 'utf8')
  })

  for (const id of ['settings-page-registration', 'settings-sidebar-registration']) {
    const registrationTarget = PRODUCERS.find((row) => row[0] === id)
    if (!registrationTarget) continue
    runFreshFixtureMutation('full checker rejects removed ' + id, (root) => {
      const path = join(root, registrationTarget[1])
      writeFileSync(path, readFileSync(path, 'utf8').replace(registrationTarget[2], ''), 'utf8')
    })
  }

  const registryTarget = PRODUCERS.find(([id]) => id === 'settings-section-registry')
  if (registryTarget) runFreshFixtureMutation('full checker rejects a removed shared section registry', (root) => {
    const path = join(root, registryTarget[1])
    writeFileSync(path, readFileSync(path, 'utf8').replace(registryTarget[2], ''), 'utf8')
  })

  runFreshFixtureMutation('full checker rejects a removed settings section registration', () => {}, ['--drop-section', 'settings-accounts'])
  runFreshFixtureMutation('full checker rejects a removed fact-template test', (root) => {
    rmSync(join(root, 'src/renderer/lib/personalVocabulary/apply.test.ts'))
  })
  runFreshFixtureMutation('full checker rejects a removed audit row', (root) => {
    const path = join(root, DOC)
    const quote = String.fromCharCode(96)
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    writeFileSync(path, lines.filter((line) => !line.includes('| ' + quote + 'tooltip' + quote + ' |')).join('\n'), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects a canonical manifest row deletion', (root) => {
    const path = join(root, 'scripts/personal-vocabulary-producer-manifest.mjs')
    const source = readFileSync(path, 'utf8')
    writeFileSync(path, source.replace(/^\s*node\('terminal'.*\r?\n/m, ''), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects a live Canvas registration deletion', (root) => {
    const path = join(root, 'src/renderer/canvas/Canvas.tsx')
    writeFileSync(path, readFileSync(path, 'utf8').replace('terminal: withNodeBoundary(TerminalNode),', ''), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects an authored mapper bypass', (root) => {
    const path = join(root, 'src/renderer/components/Tooltip.tsx')
    writeFileSync(path, readFileSync(path, 'utf8').replace('useVocabularyMapper()', '(() => (value) => value)()'), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects a fact routed through the mapper', (root) => {
    const path = join(root, 'src/renderer/lib/personalVocabulary/ownedCopy.ts')
    writeFileSync(path, readFileSync(path, 'utf8').replace("segment.kind === 'copy' ? map(segment.text) : segment.text", 'map(segment.text)'), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects School-mode predicate loss', (root) => {
    const path = join(root, 'src/renderer/lib/personalVocabulary/useVocabularyText.ts')
    writeFileSync(path, readFileSync(path, 'utf8').replace('schoolModeAllowsOptionalFeatures({', 'Boolean({'), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects hydrate loss', (root) => {
    const path = join(root, 'src/renderer/state/personalVocabulary.ts')
    writeFileSync(path, readFileSync(path, 'utf8').replace('hydrate: () => {', 'hydrate: () => undefined as never, disabledHydrate: () => {'), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects a personal-vocabulary privacy sink', (root) => {
    const path = join(root, 'src/renderer/state/personalVocabulary.ts')
    writeFileSync(path, readFileSync(path, 'utf8') + '\nwindow.nodeTerminal.settings.update({ personalVocabulary: usePersonalVocabulary.getState().entries })\n', 'utf8')
  })
  runFreshFixtureMutation('full checker rejects a canonical documentation row loss', (root) => {
    const path = join(root, PERSONAL_VOCABULARY_DOCS.audit)
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    writeFileSync(path, lines.filter((line) => !line.startsWith('| `canvas-node-terminal` |')).join('\n'), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects a focused-test inventory row loss', (root) => {
    const path = join(root, 'scripts/personal-vocabulary-producer-manifest.mjs')
    const source = readFileSync(path, 'utf8')
    writeFileSync(path, source.replace(/^\s*\['apply',.*\r?\n/m, ''), 'utf8')
  })
  runFreshFixtureMutation('full checker rejects native IPC vocabulary payload egress', (root) => {
    const path = join(root, 'src/preload/index.ts')
    writeFileSync(path, readFileSync(path, 'utf8').replace('ipcRenderer.invoke(IPC.appNotify, payload)', 'ipcRenderer.invoke(IPC.appNotify, payload, payload.vocabularyCache)'), 'utf8')
  })
}

console.log('check-personal-vocabulary-coverage.mjs: ' + checked + ' assertions checked.')
if (failures) {
  console.error(failures + ' FAILURE(S).')
  process.exitCode = 1
} else {
  console.log('All clear. ✓')
}
