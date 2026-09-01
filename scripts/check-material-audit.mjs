#!/usr/bin/env node
// check-material-audit.mjs
//
// A hand-written, fail-closed inventory for the Windows desktop application's rendered surfaces.
// It intentionally names each screen, node, destination, settings section, overlay, status state,
// and documentation page instead of discovering only what happens to be present. A discovery-only
// scan would disappear quietly when a surface is removed, which is exactly the omission this check
// is meant to catch.
//
// This is a source-level audit. It does not claim that a built artifact was launched, measured, or
// captured. Those checks remain separate because the current audit lane is limited to source
// inspection and edits.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT_DOC = 'docs/features/appearance/material-3-audit.md'

let failures = 0
let checked = 0

function fail(message) {
  failures += 1
  console.error(`✗ ${message}`)
}

function pass(message) {
  checked += 1
  console.log(`✓ ${message}`)
}

function text(path) {
  const abs = join(ROOT, path)
  if (!existsSync(abs)) return null
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

function fileExists(path, label) {
  checked += 1
  if (!existsSync(join(ROOT, path))) {
    fail(`${label}: missing ${path}`)
    return false
  }
  pass(`${label}: ${path}`)
  return true
}

function contains(path, needle, label) {
  const source = text(path)
  checked += 1
  if (source === null) {
    fail(`${label}: cannot read ${path}`)
    return false
  }
  if (!source.includes(needle)) {
    fail(`${label}: ${path} does not contain ${JSON.stringify(needle)}`)
    return false
  }
  pass(`${label}: ${path} contains ${JSON.stringify(needle)}`)
  return true
}

function omits(path, needle, label) {
  const source = text(path)
  checked += 1
  if (source === null) {
    fail(`${label}: cannot read ${path}`)
    return false
  }
  if (source.includes(needle)) {
    fail(`${label}: ${path} still contains ${JSON.stringify(needle)}`)
    return false
  }
  pass(`${label}: ${path} omits ${JSON.stringify(needle)}`)
  return true
}

function hasExactStyleMarker(css, marker) {
  if (
    marker.startsWith('--') ||
    marker.startsWith(':') ||
    marker.startsWith('[') ||
    marker.includes('{') ||
    marker.includes('var(') ||
    marker.includes(': ') ||
    marker.startsWith('@')
  ) {
    return css.split(/\r?\n/).some((line) => line.includes(marker))
  }
  const selector = marker.startsWith('.') ? marker.slice(1) : marker
  const escaped = selector.replace(/[\^$.*+?()[\]{}|]/g, '\\$&')
  return new RegExp('\\.' + escaped + '(?![A-Za-z0-9_-])').test(css)
}

function rows(category, values) {
  return values.map(([id, label, file, needle, style, status]) => ({
    id,
    category,
    label,
    files: [file],
    needle,
    style,
    status
  }))
}

/*
 * The rows below are intentionally written out. The fourth field is a source marker that must be
 * present in the implementation file. The fifth field is a selector or primitive marker that must
 * be present in the desktop style corpus. Keeping both markers beside the row makes the audit read
 * like an actual review rather than a filename inventory.
 */
const SURFACES = [
  ...rows('shell', [
    ['desktop-app-shell', 'Application shell and mode routing', 'src/renderer/App.tsx', 'export default function App', 'md3-kids-boot-splash'],
    ['desktop-app-error-boundary', 'Application error recovery card', 'src/renderer/components/AppErrorBoundary.tsx', 'export class AppErrorBoundary', 'app-error'],
    ['desktop-canvas-shell', 'Canvas shell and surface composition', 'src/renderer/canvas/Canvas.tsx', 'function Canvas', 'md3-canvas-row'],
    ['desktop-top-app-bar', 'Top app bar', 'src/renderer/components/TopAppBar.tsx', 'export function TopAppBar', 'md3-app-bar'],
    ['desktop-nav-rail', 'Navigation rail and node-creation FAB', 'src/renderer/components/NavRail.tsx', 'export function NavRail', 'md3-nav-rail'],
    ['desktop-project-switcher', 'Project switcher menu', 'src/renderer/components/ProjectSwitcher.tsx', 'export function ProjectSwitcher', 'md3-switcher-menu'],
    ['desktop-welcome', 'Welcome and empty-project screen', 'src/renderer/components/WelcomeScreen.tsx', 'export function WelcomeScreen', 'md3-welcome'],
    ['desktop-sessions-sidebar', 'Sessions sidebar', 'src/renderer/components/SessionsSidebar.tsx', 'export function SessionsSidebar', 'sessions-sidebar'],
    ['desktop-canvas-actions', 'Canvas action cluster and zoom controls', 'src/renderer/canvas/Canvas.tsx', 'md3-canvas-actions', 'md3-canvas-actions'],
    ['desktop-focus-surface', 'Focused-node surface', 'src/renderer/canvas/Canvas.tsx', 'focus-surface', 'focus-surface'],
    ['desktop-widget-shell', 'Detached widget shell', 'src/renderer/widget/WidgetApp.tsx', 'export default function WidgetApp', 'widget-app'],
  ]),
  ...rows('node', [
    ['node-terminal', 'Terminal node', 'src/renderer/nodes/TerminalNode.tsx', 'export function TerminalNode', 'term-node'],
    ['node-agent', 'Agent and subagent node', 'src/renderer/nodes/SubagentNode.tsx', 'export function SubagentNode', 'subagent-node'],
    ['node-sticky', 'Sticky note node', 'src/renderer/nodes/StickyNode.tsx', 'export function StickyNode', 'sticky-node'],
    ['node-group', 'Group frame node', 'src/renderer/nodes/GroupNode.tsx', 'export function GroupNode', 'group-node'],
    ['node-editor', 'Editor node', 'src/renderer/nodes/EditorNode.tsx', 'export function EditorNode', 'editor-node__body'],
    ['node-diff', 'Diff node', 'src/renderer/nodes/DiffNode.tsx', 'export function DiffNode', 'diff-node__tag'],
    ['node-browser', 'Browser node', 'src/renderer/nodes/BrowserNode.tsx', 'export default function BrowserNode', 'browser-node__toolbar'],
    ['node-web', 'Web node', 'src/renderer/nodes/WebNode.tsx', 'export default function WebNode', 'term-node'],
    ['node-video', 'Video node', 'src/renderer/nodes/VideoNode.tsx', 'export default function VideoNode', 'term-node'],
    ['node-loop', 'Loop scheduler node', 'src/renderer/nodes/LoopNode.tsx', 'export function LoopNode', 'loop-node'],
    ['node-native-loop', 'Native scheduled-loop node', 'src/renderer/nodes/NativeLoopNode.tsx', 'export function NativeLoopNode', 'native-loop-node'],
    ['node-service', 'Service node', 'src/renderer/nodes/ServiceNode.tsx', 'export function ServiceNode', 'service-node'],
    ['node-veracrypt', 'VeraCrypt mount node', 'src/renderer/nodes/VeraCryptNode.tsx', 'export default function VeraCryptNode', 'veracrypt-node'],
    ['node-repository-graph', 'Repository graph node', 'src/renderer/nodes/RepositoryGraphNode.tsx', 'export default function RepositoryGraphNode', 'repository-graph-node'],
    ['node-unigetui-universe', 'UniGetUI universe node', 'src/renderer/nodes/UniGetUiUniverseNode.tsx', 'export function UniGetUiUniverseNode', 'unigetui-universe-node'],
    ['node-nsis', 'NSIS installer node', 'src/renderer/nodes/NsisInstallerNode.tsx', 'export default function NsisInstallerNode', 'nsis-node__body'],
    ['node-authenticator', 'Authenticator node', 'src/renderer/nodes/AuthenticatorNode.tsx', 'export default function AuthenticatorNode', 'authenticator-node__body'],
    ['node-dino', 'Dino activity node', 'src/renderer/nodes/DinoNode.tsx', 'export function DinoNode', 'dino-node'],
    ['node-annotation', 'Annotation node', 'src/renderer/nodes/AnnotationNode.tsx', 'export function AnnotationNode', 'annotation-node'],
    ['node-discarded', 'Discarded-node plate', 'src/renderer/nodes/DiscardedPlate.tsx', 'export function DiscardedPlate', 'browser-node__discarded'],
    ['node-chat', 'Chat panel node content', 'src/renderer/nodes/ChatPanel.tsx', 'export function ChatPanel', 'term-chat'],
    ['node-browser-start', 'Browser start page', 'src/renderer/nodes/BrowserStartPage.tsx', 'export function BrowserStartPage', 'startpage'],
    ['node-browser-surface', 'Browser surface and controls', 'src/renderer/nodes/BrowserSurface.tsx', 'export function BrowserSurface', 'browser-surface'],
    ['node-browser-profile-picker', 'Browser profile picker', 'src/renderer/nodes/BrowserProfilePicker.tsx', 'export function BrowserProfilePicker', 'browser-profile-trigger'],
    ['node-browser-extensions', 'Browser extensions panel', 'src/renderer/nodes/BrowserExtensionsPanel.tsx', 'export function BrowserExtensionsPanel', 'browser-ext-panel'],
  ]),
  ...rows('destination', [
    ['destination-kanban', 'Kanban board destination', 'src/renderer/components/kanban/KanbanView.tsx', 'export const KanbanView', 'kanban-overlay'],
    ['destination-kanban-column', 'Kanban column', 'src/renderer/components/kanban/KanbanColumn.tsx', 'export const KanbanColumn', 'kanban-col'],
    ['destination-session-card', 'Kanban session card', 'src/renderer/components/kanban/SessionCard.tsx', 'kanban-card__title', 'kanban-card'],
    ['destination-card-modal', 'Kanban card modal', 'src/renderer/components/kanban/CardModal.tsx', 'export function CardModal', 'kanban-modal'],
    ['destination-comments-activity', 'Comments and Activity panel inside card modal', 'src/renderer/components/kanban/CardModal.tsx', 'kanban-modal__body', 'board-log', 'Conflict: p80 owns CardModal; record only'],
    ['destination-board-log', 'Board activity log', 'src/renderer/components/kanban/BoardLogPanel.tsx', 'export function BoardLogPanel', 'board-log'],
    ['destination-source-filter', 'Kanban source filter', 'src/renderer/components/kanban/KanbanSourceFilter.tsx', 'export function KanbanSourceFilter', 'kanban-filter-menu'],
    ['destination-label-picker', 'Kanban label picker', 'src/renderer/components/kanban/LabelPicker.tsx', 'export function LabelPicker', 'label-picker'],
    ['destination-explorer', 'Explorer destination', 'src/renderer/components/ExplorerPanel.tsx', 'export function ExplorerPanel', 'md3-explorer'],
    ['destination-source-control', 'Source Control destination', 'src/renderer/components/SourceControlPanel.tsx', 'export function SourceControlPanel', 'md3-source-control'],
    ['destination-history', 'History destination and tabs', 'src/renderer/components/HistoryScreen.tsx', 'export function HistoryScreen', 'md3-history-screen'],
    ['destination-local-history', 'Settings and project local history panel', 'src/renderer/components/LocalHistoryPanel.tsx', 'export function LocalHistoryPanel', 'md3-history-panel'],
    ['destination-git-history', 'Git history panel and rows', 'src/renderer/components/git-history/GitHistoryPanel.tsx', 'export function GitHistoryPanel', 'md3-git-history'],
    ['destination-docs', 'Offline documentation browser', 'src/renderer/components/DocsBrowser.tsx', 'export function DocsBrowser', 'md3-docs'],
    ['destination-doc-article', 'Offline documentation article', 'src/renderer/components/docs/DocsArticleView.tsx', 'export function DocsArticleView', 'md3-docs-article'],
    ['destination-status', 'Status destination', 'src/renderer/components/StatusSurface.tsx', 'export function StatusSurface', 'md3-status-screen'],
    ['destination-shortcuts', 'Shortcuts destination', 'src/renderer/components/ShortcutsPanel.tsx', 'export function ShortcutsPanel', 'shortcuts'],
    ['destination-notification-center', 'Notification center', 'src/renderer/components/NotificationCenter.tsx', 'export function NotificationCenter', 'notif-center'],
    ['destination-notification-toasts', 'Notification toast stack', 'src/renderer/components/NotificationToasts.tsx', 'export function NotificationToasts', 'toast-stack'],
    ['destination-session-memory', 'Session memory panel', 'src/renderer/components/SessionMemoryPanel.tsx', 'export function SessionMemoryPanel', 'sessmem-panel'],
    ['destination-usage', 'Usage indicator and popover', 'src/renderer/components/UsageIndicator.tsx', 'export function UsageIndicator', 'usage-pill'],
    ['destination-updates', 'Update status card', 'src/renderer/components/UpdateCard.tsx', 'export function UpdateCard', 'update-card'],
    ['destination-announcement', 'Announcement banner', 'src/renderer/components/AnnouncementBanner.tsx', 'export function AnnouncementBanner', 'announce-banner'],
    ['destination-conflict', 'Conflict banner', 'src/renderer/components/ConflictBar.tsx', 'export function ConflictBar', 'conflict-bar'],
    ['destination-minecraft', 'Minecraft server manager', 'src/renderer/components/minecraft/MinecraftServerPanel.tsx', 'export function MinecraftServerPanel', 'mc-body'],
    ['destination-ollama', 'Ollama suite manager', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'export function OllamaManagerPanel', 'md3-ollama'],
    ['destination-converter', 'File converter', 'src/renderer/components/converter/FileConverterPanel.tsx', 'export function FileConverterPanel', 'md3-converter'],
    ['destination-unigetui', 'UniGetUI universe panel', 'src/renderer/components/unigetui/UniGetUiUniversePanel.tsx', 'export function UniGetUiUniversePanel', 'unigetui-universe'],
  ]),
  ...rows('settings', [
    ['settings-page', 'Settings screen', 'src/renderer/components/settings/SettingsPage.tsx', 'export function SettingsPage', 'md3-settings-shell'],
    ['settings-sidebar', 'Settings sidebar and navigation', 'src/renderer/components/settings/SettingsSidebar.tsx', 'export function SettingsSidebar', 'md3-settings-sidebar'],
    ['settings-section', 'Settings section shell', 'src/renderer/components/settings/SettingsSection.tsx', 'export function SettingsSection', 'md3-settings-card'],
    ['settings-field-row', 'Settings field row', 'src/renderer/components/settings/FieldRow.tsx', 'export function FieldRow', 'md3-settings-row'],
    ['settings-searchable-row', 'Searchable settings row', 'src/renderer/components/settings/SearchableRow.tsx', 'export function SearchableRow', 'md3-settings-row'],
    ['settings-theme', 'Theme picker', 'src/renderer/components/settings/ThemeSelect.tsx', 'export function ThemeSelect', 'md3-theme-menu'],
    ['settings-font', 'Font picker', 'src/renderer/components/settings/FontPicker.tsx', 'export function FontPicker', 'md3-settings-hint'],
    ['settings-shortcut-capture', 'Shortcut capture field', 'src/renderer/components/settings/ShortcutCaptureField.tsx', 'export function ShortcutCaptureField', 'md3-shortcut-field'],
    ['settings-terminal-preview', 'Terminal preview', 'src/renderer/components/settings/TerminalPreview.tsx', 'export function TerminalPreview', 'md3-terminal-preview'],
    ['settings-accounts', 'Accounts settings', 'src/renderer/components/settings/sections/AccountsSection.tsx', 'export function AccountsSection', 'md3-settings-card'],
    ['settings-adhd', 'ADHD modes settings', 'src/renderer/components/settings/sections/AdhdModesSection.tsx', 'export function AdhdModesSection', 'md3-settings-card'],
    ['settings-agents', 'Agent settings', 'src/renderer/components/settings/sections/AgentsSection.tsx', 'export function AgentsSection', 'md3-settings-card'],
    ['settings-appearance', 'Appearance settings', 'src/renderer/components/settings/sections/AppearanceSection.tsx', 'export function AppearanceSection', 'md3-settings-card'],
    ['settings-appearance-editor', 'Appearance editor settings', 'src/renderer/components/settings/sections/AppearanceEditorSection.tsx', 'export function AppearanceEditorSection', 'md3-settings-card'],
    ['settings-app-identity', 'App identity and logo settings', 'src/renderer/components/settings/sections/AppIdentitySection.tsx', 'export function AppIdentitySection', 'app-logo__preset'],
    ['settings-authenticator', 'Authenticator settings', 'src/renderer/components/settings/sections/AuthenticatorSection.tsx', 'export function AuthenticatorSection', 'md3-authenticator'],
    ['settings-behavior', 'Behavior settings', 'src/renderer/components/settings/sections/BehaviorSection.tsx', 'export function BehaviorSection', 'md3-settings-card'],
    ['settings-commit', 'Commit settings', 'src/renderer/components/settings/sections/CommitSection.tsx', 'export function CommitSection', 'md3-settings-card'],
    ['settings-custom-agents', 'Custom-agent settings', 'src/renderer/components/settings/sections/CustomAgentsSection.tsx', 'export function CustomAgentsSection', 'md3-settings-card'],
    ['settings-github-issues', 'GitHub Issues settings', 'src/renderer/components/settings/sections/GitHubIssuesSection.tsx', 'export function GitHubIssuesSection', 'md3-settings-card'],
    ['settings-kids', 'Kids mode settings', 'src/renderer/components/settings/sections/KidsModeSection.tsx', 'export function KidsModeSection', 'md3-kids-disclosure'],
    ['settings-language', 'Language, funny level, and emoji settings', 'src/renderer/components/settings/sections/LanguageSection.tsx', 'export function LanguageSection', 'md3-settings-card'],
    ['settings-license', 'License settings', 'src/renderer/components/settings/sections/LicenseSection.tsx', 'export function LicenseSection', 'md3-settings-card'],
    ['settings-local-history', 'Local history settings', 'src/renderer/components/settings/sections/LocalHistorySection.tsx', 'export function LocalHistorySection', 'md3-settings-card'],
    ['settings-narrator', 'Narrator settings', 'src/renderer/components/settings/sections/NarratorSection.tsx', 'export function NarratorSection', 'md3-settings-card'],
    ['settings-notch', 'Notch settings', 'src/renderer/components/settings/sections/NotchSection.tsx', 'export function NotchSection', 'md3-settings-card'],
    ['settings-notifications', 'Notification settings', 'src/renderer/components/settings/sections/NotificationsSection.tsx', 'export function NotificationsSection', 'md3-settings-card'],
    ['settings-personal-vocabulary', 'Personal vocabulary settings', 'src/renderer/components/settings/sections/PersonalVocabularySection.tsx', 'export function PersonalVocabularySection', 'md3-settings-card'],
    ['settings-phone', 'Phone and relay settings', 'src/renderer/components/settings/sections/PhoneSection.tsx', 'export function PhoneSection', 'md3-settings-card'],
    ['settings-presence', 'Presence identity settings', 'src/renderer/components/settings/sections/PresenceIdentitySection.tsx', 'export function PresenceIdentitySection', 'md3-settings-card'],
    ['settings-privacy', 'Privacy settings', 'src/renderer/components/settings/sections/PrivacySection.tsx', 'export function PrivacySection', 'md3-settings-card'],
    ['settings-remote', 'Remote access settings', 'src/renderer/components/settings/sections/RemoteSection.tsx', 'export function RemoteSection', 'md3-settings-card'],
    ['settings-schedule', 'Scheduled settings', 'src/renderer/components/settings/sections/ScheduleSection.tsx', 'export function ScheduleSection', 'md3-settings-card'],
    ['settings-school', 'School mode settings', 'src/renderer/components/settings/sections/SchoolModeSection.tsx', 'export function SchoolModeSection', 'md3-settings-card'],
    ['settings-shell', 'Windows shell profiles', 'src/renderer/components/settings/sections/ShellSection.tsx', 'export function ShellSection', 'md3-settings-card'],
    ['settings-shortcuts', 'Shortcut settings', 'src/renderer/components/settings/sections/ShortcutsSection.tsx', 'export function ShortcutsSection', 'md3-settings-card'],
    ['settings-speech', 'Speech and dictation settings', 'src/renderer/components/settings/sections/SpeechSection.tsx', 'export function SpeechSection', 'md3-settings-card'],
    ['settings-ssh', 'SSH settings', 'src/renderer/components/settings/sections/SshSection.tsx', 'export function SshSection', 'md3-settings-card'],
    ['settings-support', 'Support tickets settings', 'src/renderer/components/settings/sections/SupportTicketsSection.tsx', 'export function SupportTicketsSection', 'md3-settings-card'],
    ['settings-team', 'Team access settings', 'src/renderer/components/settings/sections/TeamAccessSection.tsx', 'export function TeamAccessSection', 'md3-settings-card'],
    ['settings-terminal', 'Terminal settings', 'src/renderer/components/settings/sections/TerminalSection.tsx', 'export function TerminalSection', 'md3-settings-card'],
    ['settings-tmux', 'tmux settings', 'src/renderer/components/settings/sections/TmuxSection.tsx', 'export function TmuxSection', 'md3-settings-card'],
    ['settings-toy-locks', 'Toy locks settings', 'src/renderer/components/settings/sections/ToyLocksSection.tsx', 'export function ToyLocksSection', 'toylock-wizard'],
    ['settings-updates', 'Updates settings', 'src/renderer/components/settings/sections/UpdatesSection.tsx', 'export function UpdatesSection', 'md3-settings-card'],
    ['settings-usage', 'Usage settings', 'src/renderer/components/settings/sections/UsageSection.tsx', 'export function UsageSection', 'md3-settings-card'],
    ['settings-workspace', 'Workspace storage settings', 'src/renderer/components/settings/sections/WorkspaceStorageSection.tsx', 'export function WorkspaceStorageSection', 'md3-settings-card'],
  ]),
  ...rows('overlay', [
    ['overlay-anchored-popover', 'Anchored popover shell', 'src/renderer/ui/AnchoredPopover.tsx', 'export function AnchoredPopover', 'anchored-pop'],
    ['overlay-command-palette', 'Command palette', 'src/renderer/components/CommandPalette.tsx', 'export function CommandPalette', 'palette'],
    ['overlay-context-menu', 'Context menu', 'src/renderer/components/ContextMenu.tsx', 'export function ContextMenu', 'ctx-menu'],
    ['overlay-filterable-menu', 'Filterable menu', 'src/renderer/components/menu/FilterableMenu.tsx', 'export function FilterableMenuHeader', 'menu-filter'],
    ['overlay-vocabulary-context-menu', 'Vocabulary context menu', 'src/renderer/components/menu/VocabularyContextMenu.tsx', 'export function VocabularyContextMenu', 'ctx-menu'],
    ['overlay-regex-builder', 'Full regex builder', 'src/renderer/components/regex/RegexBuilder.tsx', 'export function RegexBuilder', 'md3-regex-builder'],
    ['overlay-anchored-regex', 'Anchored regex builder', 'src/renderer/components/regex/AnchoredRegexBuilder.tsx', 'export function AnchoredRegexBuilder', 'md3-regex-trigger'],
    ['overlay-confirm', 'Confirm dialog', 'src/renderer/components/ConfirmDialog.tsx', 'export function ConfirmDialog', 'confirm'],
    ['overlay-destructive-gate', 'Destructive action gate', 'src/renderer/components/DestructiveConfirmGate.tsx', 'export function DestructiveConfirmGate', 'destgate'],
    ['overlay-destructive-host', 'Destructive gate host', 'src/renderer/components/DestructiveGateHost.tsx', 'export function DestructiveGateHost', 'destgate-overlay'],
    ['overlay-clone', 'Clone repository dialog', 'src/renderer/components/CloneRepoDialog.tsx', 'export function CloneRepoDialog', 'clone-dialog'],
    ['overlay-bug-report', 'Bug report dialog', 'src/renderer/components/BugReportDialog.tsx', 'export function BugReportDialog', 'bug-report'],
    ['overlay-input', 'Input dialog', 'src/renderer/components/InputDialog.tsx', 'export function InputDialog', 'confirm'],
    ['overlay-worktree', 'Worktree dialog', 'src/renderer/components/WorktreeDialog.tsx', 'export function WorktreeDialog', 'bind-dialog'],
    ['overlay-existing-worktree-picker', 'Existing-worktree picker inside Worktree dialog', 'src/renderer/components/WorktreeDialog.tsx', 'bind-existing__list', 'bind-existing', 'Conflict: p81 owns this picker; record only'],
    ['overlay-ssh-project', 'SSH project dialog', 'src/renderer/components/SshProjectDialog.tsx', 'export function SshProjectDialog', 'confirm'],
    ['overlay-remote-access', 'Remote access dialog', 'src/renderer/components/RemoteAccessDialog.tsx', 'export function RemoteAccessDialog', 'remote-dialog'],
    ['overlay-ssh-passphrase', 'SSH passphrase prompt', 'src/renderer/components/SshPassphrasePrompt.tsx', 'export function SshPassphrasePrompt', 'confirm'],
    ['overlay-wsl-create', 'WSL distribution dialog', 'src/renderer/wsl/WslCreateDialog.tsx', 'export function WslCreateDialog', 'confirm'],
    ['overlay-group-picker', 'Group picker dialog', 'src/renderer/components/canvas/GroupPickerDialog.tsx', 'export function GroupPickerDialog', 'group-picker'],
    ['overlay-branch-select', 'Branch picker', 'src/renderer/components/BranchSelect.tsx', 'export function BranchSelect', 'bind-select'],
    ['overlay-color-field', 'Color field', 'src/renderer/components/color/ColorField.tsx', 'export function ColorField', 'color-field'],
    ['overlay-color-menu', 'Color menu', 'src/renderer/components/color/ColorMenu.tsx', 'export function ColorMenu', 'color-popover'],
    ['overlay-color-picker', 'Infinite color picker', 'src/renderer/components/color/ColorPicker.tsx', 'export function ColorPicker', 'color-picker'],
    ['overlay-icon-menu', 'Project icon picker', 'src/renderer/components/icon/IconMenu.tsx', 'export function IconMenu', 'icon-menu'],
    ['overlay-appearance-editor', 'Per-element appearance editor', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'export function AppearanceEditorHost', 'appearance-editor'],
    ['overlay-phone-pair', 'Phone pairing popover', 'src/renderer/components/PhonePairPopover.tsx', 'export function PhonePairPopover', 'phone-pair'],
    ['overlay-presence-name', 'Presence name prompt', 'src/renderer/components/PresenceNamePrompt.tsx', 'export function PresenceNamePrompt', 'presence-prompt'],
    ['overlay-notify-consent', 'Notification consent dialog', 'src/renderer/components/NotifyConsentDialog.tsx', 'export function NotifyConsentDialog', 'consent-card'],
    ['overlay-upgrade', 'Upgrade dialog', 'src/renderer/components/UpgradeDialog.tsx', 'export function UpgradeDialog', 'confirm'],
    ['overlay-prompt', 'Prompt dialog host', 'src/renderer/components/promptDialog.tsx', 'export function PromptDialogHost', 'confirm'],
    ['overlay-archive-unlock', 'Archive unlock dialog', 'src/renderer/components/archiveUnlockDialog.tsx', 'export function ArchiveUnlockDialogHost', 'confirm'],
    ['overlay-lock-wizard', 'Toy-lock wizard', 'src/renderer/components/toylocks/LockWizard.tsx', 'export function LockWizard', 'md3-toylock-wizard'],
    ['overlay-unlock-prompt', 'Toy-lock unlock prompt', 'src/renderer/components/toylocks/UnlockPrompt.tsx', 'export function UnlockPrompt', 'toylock-unlock'],
    ['overlay-unlock-ladder', 'Unlock ladder', 'src/renderer/components/toylocks/UnlockLadder.tsx', 'export function UnlockLadderPanel', 'toylock-ladder'],
    ['overlay-two-key-export', 'Two-key export gate', 'src/renderer/components/authenticator/TwoKeyExportGate.tsx', 'export function TwoKeyExportGate', 'toylock-export-gate'],
    ['overlay-tooltip', 'Keyboard and pointer tooltip', 'src/renderer/components/Tooltip.tsx', 'export function Tooltip', 'tooltip'],
    ['overlay-export-menu', 'Export menu', 'src/renderer/components/ExportMenu.tsx', 'export function ExportMenu', 'md3-export-menu'],
    ['overlay-agent-continuation', 'Agent continuation review', 'src/renderer/components/AgentContinuationReview.tsx', 'export function AgentContinuationReview', 'agent-continuation-review'],
    ['overlay-dialog-picker', 'Directory picker dialog', 'src/renderer/bridge/dialog-picker.tsx', 'export function openDirectoryPicker', 'dir-picker'],
    ['overlay-wsl-create-clipping', 'WSL creator clipping state from supplied evidence', 'src/renderer/wsl/WslCreateDialog.tsx', 'wsl-create-dialog', 'confirm', 'Nonconforming and overlapping: p79 owns the fix; record only'],
  ]),
  ...rows('status', [
    ['status-capability-notice', 'Capability notice and unsupported state', 'src/renderer/components/CapabilityNotice.tsx', 'export function CapabilityNotice', 'confirm'],
    ['status-pty-pressure', 'PTY pressure banner', 'src/renderer/components/PtyPressureBanner.tsx', 'export function PtyPressureBanner', 'announce-banner'],
    ['status-server-deployment', 'Server deployment status pill', 'src/renderer/components/ServerDeploymentPill.tsx', 'export function ServerDeploymentPill', 'server-deploy-pill'],
    ['status-tmux-banner', 'tmux state banner', 'src/renderer/components/TmuxBanner.tsx', 'export function TmuxBanner', 'announce-banner'],
    ['status-resume-card', 'Resume state card', 'src/renderer/components/ResumeCard.tsx', 'export function ResumeCard', 'resume-card'],
    ['status-system-resource', 'System resource status pill', 'src/renderer/components/SystemResourcePill.tsx', 'export function SystemResourcePill', 'sysres-indicator'],
    ['status-presence-layer', 'Presence status layer', 'src/renderer/components/PresenceLayer.tsx', 'export function PresenceLayer', 'presence-cursor'],
    ['status-facepile', 'Presence facepile', 'src/renderer/components/Facepile.tsx', 'export function Facepile', 'presence-facepile'],
    ['status-account-pills', 'Account identity pills', 'src/renderer/components/AccountIdentityPills.tsx', 'export function AccountIdentityPills', 'account-identity-pills'],
    ['status-node-boundary', 'Node error boundary', 'src/renderer/components/NodeBoundary.tsx', 'export function withNodeBoundary', 'node-error'],
  ]),
  ...rows('state', [
    ['state-theme-dark', 'Dark theme token state', 'src/renderer/styles.css', ':root {', '--md-primary'],
    ['state-theme-light', 'Light theme token state', 'src/renderer/styles.css', ":root[data-theme='light']", '--md-primary'],
    ['state-focus-visible', 'Keyboard focus-visible state', 'src/renderer/styles.md3.css', ':focus-visible', '--md-primary'],
    ['state-hover', 'Pointer hover state layer', 'src/renderer/styles.md3.css', ':hover', '--md-surface-container-highest'],
    ['state-disabled', 'Disabled control state', 'src/renderer/styles.md3.css', ':disabled', '--md-outline'],
    ['state-selected', 'Selected control state', 'src/renderer/styles.md3.css', '.is-active', '--md-secondary-container'],
    ['state-pressed', 'Pressed and toggle state', 'src/renderer/styles.md3.css', "[aria-pressed='true']", '--md-secondary-container'],
    ['state-error', 'Error and needs-attention state', 'src/renderer/styles.md3.css', 'var(--md-error)', '--md-error-container'],
    ['state-empty', 'Empty-state styling', 'src/renderer/styles.md3.css', 'md3-changelog-empty', '--md-surface-container'],
    ['state-loading', 'Loading and busy state', 'src/renderer/styles.md3.css', 'md3-spin', '--md-motion-effect'],
    ['state-progress', 'Determinate progress state', 'src/renderer/ui/md3/primitives.css', '.mdx-progress', '--md-primary'],
    ['state-progress-indeterminate', 'Indeterminate progress state', 'src/renderer/ui/md3/primitives.css', 'mdx-progress--indeterminate', '--md-motion-effect'],
    ['state-reduced-motion', 'Reduced-motion state', 'src/renderer/ui/md3/primitives.css', 'prefers-reduced-motion: reduce', '--md-motion-effect'],
    ['state-narrow-layout', 'Narrow-layout state', 'src/renderer/styles.md3.css', '@media (max-width: 720px)', '--md-surface-container'],
    ['state-display-scale', 'Display-scale sizing helper state', 'src/renderer/terminal/raster-scale.ts', 'export function', 'md3-settings-shell'],
    ['state-drag-over', 'Drag-over and drop-target state', 'src/renderer/styles.md3.css', 'is-drop-before', '--md-primary'],
    ['state-locked', 'Locked surface state', 'src/renderer/styles.md3.css', 'tab-lock-overlay', '--md-error-container'],
    ['state-unavailable', 'Unavailable capability state', 'src/renderer/styles.md3.css', 'is-unavailable', '--md-on-surface-variant'],
    ['state-working', 'Working status state', 'src/renderer/styles.css', '--agent-working', '--md-tertiary-container'],
    ['state-needs-you', 'Needs-user status state', 'src/renderer/styles.md3.css', 'attention', '--md-error-container'],
    ['state-scrim', 'Overlay scrim state', 'src/renderer/styles.md3.css', '--md-scrim', '--md-scrim'],
    ['state-tooltip', 'Tooltip visible state', 'src/renderer/styles.md3.css', '.tooltip', '--md-surface-container-highest'],
    ['state-tab-overflow', 'Tab overflow and scroll state', 'src/renderer/styles.css', 'overflow-x: auto', '--md-outline-variant']
  ]),
  ...rows('site', [
    ['site-home', 'Landing page home', 'site/index.html', '<body', null],
    ['site-docs-index', 'Documentation index page', 'site/docs/index.html', '<article', null],
    ['site-docs-agent-support', 'Agent support article', 'site/docs/agent-support.html', 'Agent support', null],
    ['site-docs-linked-agent-inbox', 'Linked-agent inbox notifications article', 'site/docs/linked-agent-inbox-notifications.html', 'Linked-agent inbox notifications', null],
    ['site-docs-canvas-lifecycle', 'Canvas lifecycle article', 'site/docs/canvas-lifecycle.html', 'Canvas &amp; node lifecycle', null],
    ['site-docs-changelog', 'Changelog article', 'site/docs/changelog-viewer.html', 'Changelog viewer', null],
    ['site-docs-dim-sum', 'Dim sum article', 'site/docs/dim-sum-surprise.html', 'Dim sum surprise', null],
    ['site-docs-exports', 'Exports and history article', 'site/docs/exports-and-history.html', 'Exports', null],
    ['site-docs-kanban', 'Kanban article', 'site/docs/kanban-board.html', 'Kanban board', null],
    ['site-docs-language', 'Language modes article', 'site/docs/language-modes.html', 'Language modes', null],
    ['site-docs-narrator', 'Narrator article', 'site/docs/narrator.html', 'Narrator', null],
    ['site-docs-node-kinds', 'Node kinds article', 'site/docs/node-kinds.html', 'Node kinds', null],
    ['site-docs-packaging', 'Packaging article', 'site/docs/packaging-updates.html', 'Packaging', null],
    ['site-docs-personal-vocabulary', 'Personal vocabulary article', 'site/docs/personal-vocabulary.html', 'Personal vocabulary', null],
    ['site-docs-projects', 'Projects and tabs article', 'site/docs/projects-and-tabs.html', 'Projects', null],
    ['site-docs-remote', 'Remote projects article', 'site/docs/remote-ssh-projects.html', 'Remote', null],
    ['site-docs-school', 'School mode article', 'site/docs/school-mode.html', 'School mode', null],
    ['site-docs-server', 'Server Edition article', 'site/docs/server-edition.html', 'Server Edition', null],
    ['site-docs-source-control', 'Source control article', 'site/docs/source-control-worktrees.html', 'Source control', null],
    ['site-docs-speech', 'Speech article', 'site/docs/speech-dictation.html', 'Speech', null],
    ['site-docs-terminal', 'Terminal sessions article', 'site/docs/terminal-sessions.html', 'Terminal sessions', null],
    ['site-docs-toy-locks', 'Toy locks article', 'site/docs/toy-locks.html', 'Toy locks', null],
    ['site-docs-windows', 'Windows support article', 'site/docs/windows-support.html', 'Windows support', null],
    ['site-styles', 'Landing and documentation style sheet', 'site/styles.css', ':focus-visible', null],
  ])
  ,
  ...rows('shell', [
    ['desktop-onboarding', 'First-run onboarding flow', 'src/renderer/components/onboarding/OnboardingFlow.tsx', 'export function OnboardingFlow', 'onb'],
    ['desktop-fab-menu', 'Floating action menu', 'src/renderer/components/FabMenu.tsx', 'export function FabMenu', 'md3-fab-menu'],
  ]),
  ...rows('destination', [
    ['destination-password-manager', 'Password manager destination', 'src/renderer/components/passwordManager/PasswordManagerPanel.tsx', 'export function PasswordManagerPanel', 'md3-passwordmanager'],
    ['destination-adapter-catalog', 'Converter adapter catalog', 'src/renderer/components/converter/AdapterCatalog.tsx', 'export function AdapterCatalog', 'cv-catalog'],
    ['destination-minecraft-backups', 'Minecraft backups panel', 'src/renderer/components/minecraft/MinecraftBackupsPanel.tsx', 'export function MinecraftBackupsPanel', 'mc-players'],
    ['destination-minecraft-players', 'Minecraft players panel', 'src/renderer/components/minecraft/MinecraftPlayersPanel.tsx', 'export function MinecraftPlayersPanel', 'mc-players'],
    ['destination-minecraft-properties', 'Minecraft properties editor', 'src/renderer/components/minecraft/MinecraftPropertiesEditor.tsx', 'export function MinecraftPropertiesEditor', 'mc-properties__grid'],
    ['destination-dim-sum', 'Dim sum startup surprise', 'src/renderer/components/DimSumSurprise.tsx', 'export function DimSumSurprise', 'dimsum-toast'],
  ]),
  ...rows('overlay', [
    ['overlay-publish', 'Publish destination dialog', 'src/renderer/components/PublishDialog.tsx', 'export function PublishDialog', 'pubdlg'],
    ['overlay-find-bar', 'Terminal find bar', 'src/renderer/components/FindBar.tsx', 'export function FindBar', 'term-node__find'],
    ['overlay-remote-picker', 'Remote picker menu', 'src/renderer/components/RemotePicker.tsx', 'export function RemotePicker', 'ctx-menu'],
  ]),
]

// Independent list of identifiers. Do not derive this from SURFACES: a deleted row must become a
// visible failure instead of shrinking both the data and the check together.
const EXPECTED_SURFACE_IDS = `
desktop-app-shell desktop-app-error-boundary desktop-canvas-shell desktop-top-app-bar desktop-nav-rail desktop-project-switcher desktop-welcome desktop-sessions-sidebar desktop-canvas-actions desktop-focus-surface desktop-widget-shell
node-terminal node-agent node-sticky node-group node-editor node-diff node-browser node-web node-video node-loop node-native-loop node-service node-veracrypt node-repository-graph node-unigetui-universe node-nsis node-authenticator node-dino node-annotation node-discarded node-chat node-browser-start node-browser-surface node-browser-profile-picker node-browser-extensions
destination-kanban destination-kanban-column destination-session-card destination-card-modal destination-comments-activity destination-board-log destination-source-filter destination-label-picker destination-explorer destination-source-control destination-history destination-local-history destination-git-history destination-docs destination-doc-article destination-status destination-shortcuts destination-notification-center destination-notification-toasts destination-session-memory destination-usage destination-updates destination-announcement destination-conflict destination-minecraft destination-ollama destination-converter destination-unigetui
settings-page settings-sidebar settings-section settings-field-row settings-searchable-row settings-theme settings-font settings-shortcut-capture settings-terminal-preview settings-accounts settings-adhd settings-agents settings-appearance settings-appearance-editor settings-app-identity settings-authenticator settings-behavior settings-commit settings-custom-agents settings-github-issues settings-kids settings-language settings-license settings-local-history settings-narrator settings-notch settings-notifications settings-personal-vocabulary settings-phone settings-presence settings-privacy settings-remote settings-schedule settings-school settings-shell settings-shortcuts settings-speech settings-ssh settings-support settings-team settings-terminal settings-tmux settings-toy-locks settings-updates settings-usage settings-workspace
overlay-anchored-popover overlay-command-palette overlay-context-menu overlay-filterable-menu overlay-vocabulary-context-menu overlay-regex-builder overlay-anchored-regex overlay-confirm overlay-destructive-gate overlay-destructive-host overlay-clone overlay-bug-report overlay-input overlay-worktree overlay-existing-worktree-picker overlay-ssh-project overlay-remote-access overlay-ssh-passphrase overlay-wsl-create overlay-group-picker overlay-branch-select overlay-color-field overlay-color-menu overlay-color-picker overlay-icon-menu overlay-appearance-editor overlay-phone-pair overlay-presence-name overlay-notify-consent overlay-upgrade overlay-prompt overlay-archive-unlock overlay-lock-wizard overlay-unlock-prompt overlay-unlock-ladder overlay-two-key-export overlay-tooltip overlay-export-menu overlay-agent-continuation overlay-dialog-picker overlay-wsl-create-clipping
status-capability-notice status-pty-pressure status-server-deployment status-tmux-banner status-resume-card status-system-resource status-presence-layer status-facepile status-account-pills status-node-boundary
state-theme-dark state-theme-light state-focus-visible state-hover state-disabled state-selected state-pressed state-error state-empty state-loading state-progress state-progress-indeterminate state-reduced-motion state-narrow-layout state-display-scale state-drag-over state-locked state-unavailable state-working state-needs-you state-scrim state-tooltip state-tab-overflow
site-home site-docs-index site-docs-agent-support site-docs-linked-agent-inbox site-docs-canvas-lifecycle site-docs-changelog site-docs-dim-sum site-docs-exports site-docs-kanban site-docs-language site-docs-narrator site-docs-node-kinds site-docs-packaging site-docs-personal-vocabulary site-docs-projects site-docs-remote site-docs-school site-docs-server site-docs-source-control site-docs-speech site-docs-terminal site-docs-toy-locks site-docs-windows site-styles desktop-onboarding desktop-fab-menu destination-password-manager destination-adapter-catalog destination-minecraft-backups destination-minecraft-players destination-minecraft-properties destination-dim-sum overlay-publish overlay-find-bar overlay-remote-picker
`.trim().split(/\s+/)

function inventoryErrors(rowsToCheck) {
  const errors = []
  const ids = rowsToCheck.map((row) => row.id)
  const expected = new Set(EXPECTED_SURFACE_IDS)
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) errors.push(`duplicate surface id ${id}`)
    seen.add(id)
    if (!expected.has(id)) errors.push(`unexpected surface id ${id}`)
  }
  for (const id of EXPECTED_SURFACE_IDS) {
    if (!seen.has(id)) errors.push(`missing surface id ${id}`)
  }
  return errors
}

const listErrors = inventoryErrors(SURFACES)
checked += 1
if (listErrors.length > 0) fail(`Surface inventory shape: ${listErrors.join('; ')}`)
else pass(`Surface inventory shape: ${SURFACES.length} hand-written rows across ${new Set(SURFACES.map((row) => row.category)).size} categories`)

// Negative regression: remove one known row in memory and require the same validator to fail.
const mutantErrors = inventoryErrors(SURFACES.slice(1))
checked += 1
if (mutantErrors.length === 0) fail('Surface inventory negative regression: deleting a required row was not detected')
else pass('Surface inventory negative regression: deleting a required row is rejected')

const STYLE_FILES = [
  'src/renderer/ui/md3/primitives.css',
  'src/renderer/styles.md3.css',
  'src/renderer/styles.css',
  'site/styles.css'
]
function styleOwnerFile(marker) {
  return STYLE_FILES.find((file) => {
    const source = text(file)
    return source !== null && hasExactStyleMarker(source, marker)
  }) ?? null
}
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
}
function hasExactSourceMarker(file, marker) {
  const source = text(file)
  if (source === null) return false
  return hasExactSourceText(source, marker)
}
function hasExactSourceText(source, marker) {
  const clean = stripComments(source)
  let from = 0
  while (from < clean.length) {
    const at = clean.indexOf(marker, from)
    if (at < 0) return false
    const before = clean[at - 1] || ''
    const after = clean[at + marker.length] || ''
    if (!/[A-Za-z0-9_-]/.test(before) && !/[A-Za-z0-9_-]/.test(after)) return true
    if ((marker.startsWith('.') || marker.startsWith(':') || marker.startsWith('[')) && !/[A-Za-z0-9_-]/.test(after)) return true
    if ("'\":.#[] \t\r\n;{([<>".includes(before) && (" \t\r\n;)}:,.(><\"'[]".includes(after) || after === String.fromCharCode(96))) return true
    from = at + marker.length
  }
  return false
}
const auditText = text(AUDIT_DOC) || ''

for (const surface of SURFACES) {
  for (const file of surface.files) fileExists(file, `${surface.id}: implementation`)
  if (surface.needle) {
    checked += 1
    const sourceOk = surface.files[0].endsWith('.css')
      ? hasExactStyleMarker(text(surface.files[0]) || '', surface.needle)
      : hasExactSourceMarker(surface.files[0], surface.needle)
    if (!sourceOk) fail(`${surface.id}: exact source marker is absent`)
    else pass(`${surface.id}: exact source marker is present`)
  }
  if (surface.style) {
    checked += 1
    const ownerFile = styleOwnerFile(surface.style)
    if (!ownerFile) fail(`${surface.id}: exact style owner for ${JSON.stringify(surface.style)} is absent`)
    else pass(`${surface.id}: exact style owner ${ownerFile} contains ${JSON.stringify(surface.style)}`)
  }
  checked += 1
  if (!auditText.includes(`| \`${surface.id}\` |`)) fail(`${surface.id}: missing from ${AUDIT_DOC}`)
  else pass(`${surface.id}: recorded in ${AUDIT_DOC}`)
}

const requiredCategories = ['shell', 'node', 'destination', 'settings', 'overlay', 'status', 'state', 'site']
for (const category of requiredCategories) {
  checked += 1
  const count = SURFACES.filter((surface) => surface.category === category).length
  if (count === 0) fail(`Surface inventory: category ${category} has no rows`)
  else pass(`Surface inventory: category ${category} has ${count} rows`)
}

// The source and style contract for this audit. These checks target real defects found during the
// review rather than merely checking that the inventory document contains reassuring prose.
const remediationChecks = [
  {
    label: 'Numeric field uses the shared MD3 field recipe',
    file: 'src/renderer/ui/NumberField.tsx',
    required: 'mdx-input mdx-number-field',
    forbidden: ['border-border', 'bg-bg', 'text-text', 'focus:border-accent']
  },
  {
    label: 'Radio primitive has a native input and shared class',
    file: 'src/renderer/ui/md3/Radio.tsx',
    required: 'mdx-radio',
    forbidden: []
  },
  {
    label: 'Progress primitive exposes a real progressbar role',
    file: 'src/renderer/ui/md3/Progress.tsx',
    required: 'role="progressbar"',
    forbidden: []
  },
  {
    label: 'Tooltip is keyboard-addressable and semantically named',
    file: 'src/renderer/components/Tooltip.tsx',
    required: 'role="tooltip"',
    forbidden: []
  },
  {
    label: 'Tabs primitive owns keyboard roving and selected state',
    file: 'src/renderer/ui/md3/Tabs.tsx',
    required: "role=\"tablist\"",
    forbidden: []
  }
]
for (const check of remediationChecks) {
  contains(check.file, check.required, check.label)
  for (const forbidden of check.forbidden) omits(check.file, forbidden, `${check.label}: legacy token`)
}

contains('src/renderer/ui/md3/index.ts', "export { Radio } from './Radio'", 'Shared MD3 barrel: Radio')
contains('src/renderer/ui/md3/index.ts', "export { Progress } from './Progress'", 'Shared MD3 barrel: Progress')
contains('src/renderer/ui/md3/index.ts', "export { NumberField } from './NumberField'", 'Shared MD3 barrel: NumberField')
contains('src/renderer/ui/md3/index.ts', "export { Tabs } from './Tabs'", 'Shared MD3 barrel: Tabs')
contains('src/renderer/boot.tsx', "import './ui/md3/primitives.css'", 'Renderer boot: shared primitive stylesheet')
contains('src/renderer/styles.md3.css', 'border-radius: var(--md-shape-node)', 'Desktop node shape token')
contains('src/renderer/styles.md3.css', 'border-radius: var(--md-shape-section)', 'Desktop section shape token')
contains('src/renderer/styles.md3.css', 'border-radius: var(--md-shape-extra-small)', 'Desktop compact shape token')
contains('src/renderer/ui/md3/primitives.css', '@media (prefers-reduced-motion: reduce)', 'Primitive reduced-motion handling')
contains('src/renderer/ui/md3/primitives.css', '.mdx-radio:focus-visible', 'Primitive focus handling')

// The audit deliberately leaves the site stylesheet alone. The ordinary wording in AGENTS.md is
// part of the contract and is checked directly so a later desktop pass cannot accidentally turn a
// site-preservation decision into a site restyle.
contains('AGENTS.md', 'Every rendered element in the Windows desktop application uses Material Design 3 primitives and project tokens', 'Public desktop Material Design 3 policy')
contains('AGENTS.md', 'The documentation and landing site runs in Kids mode by default', 'Public site default policy')
contains('AGENTS.md', 'Site changes are limited to stale facts, data, releases, links, features, accessibility, and broken behavior', 'Public site preservation policy')
contains(AUDIT_DOC, 'No site restyling is part of this task', 'Audit site boundary')
contains(AUDIT_DOC, 'Kids mode by default', 'Audit site default')

// Every non-test renderer source radio control is now routed through the shared primitive. A raw
// radio in a feature file is a new lookalike and must be reviewed before it can land.
function rendererSourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...rendererSourceFiles(rel))
    else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(rel.replaceAll('\\', '/'))
  }
  return out
}
const rawRadioFiles = rendererSourceFiles('src/renderer')
  .filter((file) => file !== 'src/renderer/ui/md3/Radio.tsx')
  .filter((file) => /type\s*=\s*['"]radio['"]/.test(text(file) || ''))
checked += 1
if (rawRadioFiles.length > 0) fail(`Raw radio lookalike(s) remain outside the shared primitive: ${rawRadioFiles.join(', ')}`)
else pass('Raw radio scan: all desktop radio controls use the shared primitive')

const radiusOwners = [
  ['.term-node', '--md-shape-node'],
  ['.service-node', '--md-shape-node'],
  ['.sticky-node', '--md-shape-section'],
  ['.loop-node', '--md-shape-section'],
  ['.native-loop-node', '--md-shape-section'],
  ['.palette', '--md-shape-extra-large'],
  ['.ctx-menu', '--md-shape-extra-large'],
  ['.anchored-pop', '--md-shape-extra-large'],
  ['.confirm', '--md-shape-extra-large'],
  ['.md3-settings-card > *', '--md-shape-medium'],
  ['.notif-center__row', '--md-shape-section'],
  ['.destgate__complete', '--md-shape-section'],
  ['.destgate__exit', '--md-shape-section'],
  ['.palette__item', '--md-shape-medium'],
  ['.ctx-item', '--md-shape-medium'],
  ['.palette__icon', '--md-shape-medium'],
  ['.md3-kids-home__avatar-bubble', '--md-shape-extra-large'],
  ['.md3-kids-tile', '--md-shape-extra-large'],
  ['.md3-status-badge', '--md-shape-compact'],
  ['.icon-menu__preview', '--md-shape-medium'],
  ['.mdx-menu', '--md-shape-large'],
  ['.mdx-row', '--md-shape-small']
]
function ownsRadiusToken(css, selector, token) {
  let start = css.length
  for (;;) {
    const candidate = css.lastIndexOf(selector, start - 1)
    if (candidate < 0) return false
    const next = css[candidate + selector.length] ?? ''
    if (!/[A-Za-z0-9_-]/.test(next)) {
      start = candidate
      break
    }
    start = candidate
  }
  const open = css.indexOf('{', start)
  const close = open < 0 ? -1 : css.indexOf('}', open)
  return open >= 0 && close >= 0 && css.slice(open, close).includes(`var(${token}`)
}
for (const [selector, token] of radiusOwners) {
  checked += 1
  if (!ownsRadiusToken(text('src/renderer/styles.md3.css') || '', selector, token)) fail(`Radius owner ${selector} does not use ${token}`)
  else pass(`Radius owner ${selector} uses ${token}`)
}

console.log('')
// Evidence-level negative regressions. Each mutation removes one real required fact in memory,
// then verifies that its predicate turns red, so this remains a real guard rather than a filename
// list whose own assertions never discriminate.
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '')
}
function hasSourceMarker(source, marker) {
  const clean = withoutComments(source)
  let from = 0
  while (from < clean.length) {
    const at = clean.indexOf(marker, from)
    if (at < 0) return false
    const before = clean[at - 1] || ''
    const after = clean[at + marker.length] || ''
    if (' \t\r\n;{'.includes(before) && ' \t\r\n;)}:,'.includes(after)) return true
    from = at + marker.length
  }
  return false
}
function hasDocRow(source, id) {
  return source.split(/\r?\n/).some((line) => line.includes(String.fromCharCode(96) + id + String.fromCharCode(96)))
}
const evidenceCases = [
  {
    label: 'tooltip role source marker',
    source: text('src/renderer/components/Tooltip.tsx') || '',
    marker: 'role="tooltip"',
    check: (source) => hasSourceMarker(source, 'role="tooltip"'),
    mutate: (source) => {
      const mutated = source.replaceAll('role="tooltip"', '')
      if (mutated === source) throw new Error('tooltip role mutation target was absent')
      return mutated
    }
  },
  {
    label: 'term-node radius owner',
    source: text('src/renderer/styles.md3.css') || '',
    marker: 'var(--md-shape-node)',
    check: (source) => ownsRadiusToken(source, '.term-node', '--md-shape-node'),
    mutate: (source) => removeRadiusTokenFromOwner(source, '.term-node', '--md-shape-node')
  },
  {
    label: 'localized language string',
    source: text('src/shared/i18n/catalog.ts') || '',
    marker: "'settings.language.description':",
    check: (source) => source.split(/\r?\n/).some((line) => line.trim().startsWith("'settings.language.description':"))
  },
  {
    label: 'material audit documentation row',
    source: text(AUDIT_DOC) || '',
    marker: 'desktop-app-shell',
    check: (source) => hasDocRow(source, 'desktop-app-shell')
  },
  {
    label: 'personal vocabulary mapper call',
    source: text('src/renderer/components/Tooltip.tsx') || '',
    marker: 'useVocabularyMapper()',
    check: (source) => /useVocabularyMapper\s*\(\s*\)/.test(withoutComments(source))
  }
]

function removeRadiusTokenFromOwner(css, selector, token) {
  let start = css.length
  let ownerStart = -1
  for (;;) {
    const candidate = css.lastIndexOf(selector, start - 1)
    if (candidate < 0) break
    const next = css[candidate + selector.length] ?? ''
    if (!/[A-Za-z0-9_-]/.test(next)) {
      ownerStart = candidate
      break
    }
    start = candidate
  }
  if (ownerStart < 0) throw new Error(`radius owner ${selector} was absent`)
  const open = css.indexOf('{', ownerStart)
  const close = open < 0 ? -1 : css.indexOf('}', open)
  if (open < 0 || close < 0) throw new Error(`radius owner ${selector} has no complete block`)
  const block = css.slice(open, close)
  const needle = `var(${token})`
  const first = block.indexOf(needle)
  if (first < 0 || first !== block.lastIndexOf(needle)) {
    throw new Error(`radius owner ${selector} does not have one exact ${needle} token`)
  }
  return css.slice(0, open) + block.replace(needle, '') + css.slice(close)
}

for (const evidence of evidenceCases) {
  checked += 1
  if (!evidence.check(evidence.source)) fail(evidence.label + ': required evidence is absent')
  else pass(evidence.label + ': required evidence is present')
  const mutant = evidence.mutate ? evidence.mutate(evidence.source) : evidence.source.replace(evidence.marker, '')
  checked += 1
  if (evidence.check(mutant)) fail(evidence.label + ': negative regression did not detect removed evidence')
  else pass(evidence.label + ': negative regression detects removed evidence')
}
console.log(`check-material-audit.mjs: ${checked} assertions checked.`)
const rowQuote = String.fromCharCode(96)
const mutationRoot = mkdtempSync(join(tmpdir(), 'nodeterm-material-audit-'))
try {
  const sourceCase = SURFACES.find((surface) => surface.id === 'desktop-onboarding')
  if (sourceCase) {
    const sourcePath = join(mutationRoot, 'OnboardingFlow.tsx')
    const original = text(sourceCase.files[0]) || ''
    copyFileSync(join(ROOT, sourceCase.files[0]), sourcePath)
    writeFileSync(sourcePath, original.replace(sourceCase.needle, ''), 'utf8')
    checked += 1
    if (hasExactSourceText(readFileSync(sourcePath, 'utf8'), sourceCase.needle)) fail('real-file source mutation was not detected')
    else pass('real-file source mutation is detected')
  }
  const styleOriginal = text('src/renderer/styles.md3.css') || ''
  const stylePath = join(mutationRoot, 'styles.md3.css')
  copyFileSync(join(ROOT, 'src/renderer/styles.md3.css'), stylePath)
  writeFileSync(stylePath, removeRadiusTokenFromOwner(styleOriginal, '.term-node', '--md-shape-node'), 'utf8')
  checked += 1
  if (ownsRadiusToken(readFileSync(stylePath, 'utf8'), '.term-node', '--md-shape-node')) fail('real-file style mutation was not detected')
  else pass('real-file style mutation is detected')

  const docOriginal = text(AUDIT_DOC) || ''
  const docPath = join(mutationRoot, 'material-3-audit.md')
  copyFileSync(join(ROOT, AUDIT_DOC), docPath)
  writeFileSync(docPath, docOriginal.replace('| ' + rowQuote + 'desktop-app-shell' + rowQuote + ' |', ''), 'utf8')
  checked += 1
  if (hasDocRow(readFileSync(docPath, 'utf8'), 'desktop-app-shell')) fail('real-file documentation mutation was not detected')
  else pass('real-file documentation mutation is detected')

  const localizedOriginal = text('src/shared/i18n/catalog.ts') || ''
  const localizedPath = join(mutationRoot, 'catalog.ts')
  copyFileSync(join(ROOT, 'src/shared/i18n/catalog.ts'), localizedPath)
  writeFileSync(localizedPath, localizedOriginal.replace("'settings.language.description':", ''), 'utf8')
  checked += 1
  if (readFileSync(localizedPath, 'utf8').split(/\r?\n/).some((line) => line.trim().startsWith("'settings.language.description':"))) fail('real-file localized-string mutation was not detected')
  else pass('real-file localized-string mutation is detected')

  const mapperOriginal = text('src/renderer/components/Tooltip.tsx') || ''
  const mapperPath = join(mutationRoot, 'Tooltip.tsx')
  copyFileSync(join(ROOT, 'src/renderer/components/Tooltip.tsx'), mapperPath)
  writeFileSync(mapperPath, mapperOriginal.replace('useVocabularyMapper()', ''), 'utf8')
  checked += 1
  if (hasExactSourceText(readFileSync(mapperPath, 'utf8'), 'useVocabularyMapper()')) fail('real-file mapper mutation was not detected')
  else pass('real-file mapper mutation is detected')
} finally {
  rmSync(mutationRoot, { recursive: true, force: true })
}
for (const surface of SURFACES) {
  const rowToken = '| ' + rowQuote + surface.id + rowQuote + ' |'
  const rowCount = auditText.split(/\r?\n/).filter((line) => line.startsWith(rowToken)).length
  if (rowCount !== 1) fail(surface.id + ': audit inventory row count is ' + rowCount + ', expected exactly one')
  else pass(surface.id + ': audit inventory row is unique')
}
console.log('check-material-audit.mjs total including unique inventory rows: ' + checked + ' assertions checked.')
if (failures > 0) {
  console.error(`${failures} FAILURE(S).`)
  process.exitCode = 1
} else {
  console.log('All clear. ✓')
}
