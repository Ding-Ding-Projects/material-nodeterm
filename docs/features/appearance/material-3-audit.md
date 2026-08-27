# Material Design 3 desktop surface audit

Status: this is the shared source inventory for the current Material Design 3 reconciliation. Its rows are maintained by the owning linked lanes; lane-specific commit SHAs and runtime evidence belong in each lane's handoff. Built-artifact launch, pixel measurement, test execution, and capture remain separate evidence and are not claimed by this inventory.

This document is the hand-written surface inventory required by issue #91. The executable companion is `scripts/check-material-audit.mjs`; its required identifier list is intentionally independent from the rows it validates, so deleting a row turns the check red rather than shrinking the inventory and the check together.

## Scope and preservation boundary

The desktop audit covers every checked-in rendered shell, node, destination, settings section, overlay, status or empty/error state, and every documentation or landing page. Each row records the implementation file, an exact source marker, the style or primitive marker, and the current source-level status.

The documentation and landing site is Kids mode by default. Its current visual style is preserved. No site restyling is part of this task. Site edits are limited to stale facts, data, releases, links, features, accessibility, and broken behavior.

## Audit contract

Every desktop row is reviewed against the shared Material Design 3 primitives and token layer: color roles, typography, shape, tonal elevation, state layers, focus, motion, density, scaling, and accessibility. No rendered element is exempt. Runtime capture evidence remains a separate follow-up because no build or capture is permitted in this lane.

The concrete source remediations in this pass are:

- `src/renderer/ui/NumberField.tsx` now renders the shared `mdx-input mdx-number-field` recipe instead of legacy utility and palette classes.
- `src/renderer/ui/md3/Radio.tsx` and `src/renderer/ui/md3/Progress.tsx` provide native, accessible, tokenized controls through the shared barrel.
- Worktree, toy-lock, authenticator, and speech model choices use the shared radio primitive.
- Converter, Ollama, Minecraft, and clone progress surfaces use the shared progress primitive with truthful ARIA values.
- History, Ollama, and browser tab strips use the shared keyboard-roving `Tabs` primitive while retaining their surface-specific styling hooks.
- Tooltip focus and Escape behavior are wired, and the tooltip surface uses the shared shape token with bounded text.
- Desktop MD3 style one-off radii found during the audit are replaced by named shape tokens for nodes, sections, compact badges, menus, and picker controls.

## Exhaustive inventory

| ID | Surface | Implementation | Exact source marker | Style or primitive marker | Source status |
| --- | --- | --- | --- | --- | --- |
| `desktop-app-shell` | Application shell and mode routing | `src/renderer/App.tsx` | `export default function App` | `md3-kids-boot-splash` | Source reviewed; runtime proof pending |
| `desktop-canvas-shell` | Canvas shell and surface composition | `src/renderer/canvas/Canvas.tsx` | `function Canvas` | `md3-canvas-row` | Source reviewed; runtime proof pending |
| `desktop-top-app-bar` | Top app bar | `src/renderer/components/TopAppBar.tsx` | `export function TopAppBar` | `md3-app-bar` | Source reviewed; runtime proof pending |
| `desktop-nav-rail` | Navigation rail and node-creation FAB | `src/renderer/components/NavRail.tsx` | `export function NavRail` | `md3-nav-rail` | Source reviewed; runtime proof pending |
| `desktop-project-switcher` | Project switcher menu | `src/renderer/components/ProjectSwitcher.tsx` | `export function ProjectSwitcher` | `md3-switcher-menu` | Source reviewed; runtime proof pending |
| `desktop-welcome` | Welcome and empty-project screen | `src/renderer/components/WelcomeScreen.tsx` | `export function WelcomeScreen` | `md3-welcome` | Source reviewed; runtime proof pending |
| `desktop-sessions-sidebar` | Sessions sidebar | `src/renderer/components/SessionsSidebar.tsx` | `export function SessionsSidebar` | `sessions-sidebar` | Source reviewed; runtime proof pending |
| `desktop-canvas-actions` | Canvas action cluster and zoom controls | `src/renderer/canvas/Canvas.tsx` | `md3-canvas-actions` | `md3-canvas-actions` | Source reviewed; runtime proof pending |
| `desktop-focus-surface` | Focused-node surface | `src/renderer/canvas/Canvas.tsx` | `focus-surface` | `focus-surface` | Source reviewed; runtime proof pending |
| `desktop-widget-shell` | Detached widget shell | `src/renderer/widget/WidgetApp.tsx` | `export default function WidgetApp` | `widget-app` | Source reviewed; runtime proof pending |
| `node-terminal` | Terminal node | `src/renderer/nodes/TerminalNode.tsx` | `export function TerminalNode` | `term-node` | Source reviewed; runtime proof pending |
| `node-agent` | Agent and subagent node | `src/renderer/nodes/SubagentNode.tsx` | `export function SubagentNode` | `subagent-node` | Source reviewed; runtime proof pending |
| `node-sticky` | Sticky note node | `src/renderer/nodes/StickyNode.tsx` | `export function StickyNode` | `sticky-node` | Source reviewed; runtime proof pending |
| `node-group` | Group frame node | `src/renderer/nodes/GroupNode.tsx` | `export function GroupNode` | `group-node` | Source reviewed; runtime proof pending |
| `node-editor` | Editor node | `src/renderer/nodes/EditorNode.tsx` | `export function EditorNode` | `editor-node__body` | Source reviewed; runtime proof pending |
| `node-diff` | Diff node | `src/renderer/nodes/DiffNode.tsx` | `export function DiffNode` | `diff-node__tag` | Source reviewed; runtime proof pending |
| `node-browser` | Browser node | `src/renderer/nodes/BrowserNode.tsx` | `export default function BrowserNode` | `browser-node__toolbar` | Source reviewed; runtime proof pending |
| `node-web` | Web node | `src/renderer/nodes/WebNode.tsx` | `export default function WebNode` | `term-node` | Source reviewed; runtime proof pending |
| `node-video` | Video node | `src/renderer/nodes/VideoNode.tsx` | `export default function VideoNode` | `term-node` | Source reviewed; runtime proof pending |
| `node-loop` | Loop scheduler node | `src/renderer/nodes/LoopNode.tsx` | `export function LoopNode` | `loop-node` | Source reviewed; runtime proof pending |
| `node-native-loop` | Native scheduled-loop node | `src/renderer/nodes/NativeLoopNode.tsx` | `export function NativeLoopNode` | `native-loop-node` | Source reviewed; runtime proof pending |
| `node-service` | Service node | `src/renderer/nodes/ServiceNode.tsx` | `export function ServiceNode` | `service-node` | Source reviewed; runtime proof pending |
| `node-nsis` | NSIS installer node | `src/renderer/nodes/NsisInstallerNode.tsx` | `export default function NsisInstallerNode` | `nsis-node__body` | Source reviewed; runtime proof pending |
| `node-authenticator` | Authenticator node | `src/renderer/nodes/AuthenticatorNode.tsx` | `export default function AuthenticatorNode` | `authenticator-node__body` | Source reviewed; runtime proof pending |
| `node-dino` | Dino activity node | `src/renderer/nodes/DinoNode.tsx` | `export function DinoNode` | `dino-node` | Source reviewed; runtime proof pending |
| `node-annotation` | Annotation node | `src/renderer/nodes/AnnotationNode.tsx` | `export function AnnotationNode` | `annotation-node` | Source reviewed; runtime proof pending |
| `node-discarded` | Discarded-node plate | `src/renderer/nodes/DiscardedPlate.tsx` | `export function DiscardedPlate` | `browser-node__discarded` | Source reviewed; runtime proof pending |
| `node-chat` | Chat panel node content | `src/renderer/nodes/ChatPanel.tsx` | `export function ChatPanel` | `term-chat` | Source reviewed; runtime proof pending |
| `node-browser-start` | Browser start page | `src/renderer/nodes/BrowserStartPage.tsx` | `export function BrowserStartPage` | `startpage` | Source reviewed; runtime proof pending |
| `node-browser-surface` | Browser surface and controls | `src/renderer/nodes/BrowserSurface.tsx` | `export function BrowserSurface` | `browser-surface` | Source reviewed; runtime proof pending |
| `node-browser-profile-picker` | Browser profile picker | `src/renderer/nodes/BrowserProfilePicker.tsx` | `export function BrowserProfilePicker` | `browser-profile-trigger` | Source reviewed; runtime proof pending |
| `node-browser-extensions` | Browser extensions panel | `src/renderer/nodes/BrowserExtensionsPanel.tsx` | `export function BrowserExtensionsPanel` | `browser-ext-panel` | Source reviewed; runtime proof pending |
| `destination-kanban` | Kanban board destination | `src/renderer/components/kanban/KanbanView.tsx` | `export const KanbanView` | `kanban-overlay` | Source reviewed; runtime proof pending |
| `destination-kanban-column` | Kanban column | `src/renderer/components/kanban/KanbanColumn.tsx` | `export const KanbanColumn` | `kanban-col` | Source reviewed; runtime proof pending |
| `destination-session-card` | Kanban session card | `src/renderer/components/kanban/SessionCard.tsx` | `kanban-card__title` | `kanban-card` | Source reviewed; runtime proof pending |
| `destination-card-modal` | Kanban card modal | `src/renderer/components/kanban/CardModal.tsx` | `export function CardModal` | `kanban-modal` | Source reviewed; runtime proof pending |
| `destination-comments-activity` | Comments and Activity panel inside card modal | `src/renderer/components/kanban/CardModal.tsx` | `kanban-modal__body` | `board-log` | Conflict: p80 owns CardModal; record only |
| `destination-board-log` | Board activity log | `src/renderer/components/kanban/BoardLogPanel.tsx` | `export function BoardLogPanel` | `board-log` | Source reviewed; runtime proof pending |
| `destination-source-filter` | Kanban source filter | `src/renderer/components/kanban/KanbanSourceFilter.tsx` | `export function KanbanSourceFilter` | `kanban-filter-menu` | Source reviewed; runtime proof pending |
| `destination-label-picker` | Kanban label picker | `src/renderer/components/kanban/LabelPicker.tsx` | `export function LabelPicker` | `label-picker` | Source reviewed; runtime proof pending |
| `destination-explorer` | Explorer destination | `src/renderer/components/ExplorerPanel.tsx` | `export function ExplorerPanel` | `md3-explorer` | Source reviewed; runtime proof pending |
| `destination-source-control` | Source Control destination | `src/renderer/components/SourceControlPanel.tsx` | `export function SourceControlPanel` | `md3-source-control` | Source reviewed; runtime proof pending |
| `destination-history` | History destination and tabs | `src/renderer/components/HistoryScreen.tsx` | `export function HistoryScreen` | `md3-history-screen` | Source reviewed; runtime proof pending |
| `destination-local-history` | Settings and project local history panel | `src/renderer/components/LocalHistoryPanel.tsx` | `export function LocalHistoryPanel` | `md3-history-panel` | Source reviewed; runtime proof pending |
| `destination-git-history` | Git history panel and rows | `src/renderer/components/git-history/GitHistoryPanel.tsx` | `export function GitHistoryPanel` | `md3-git-history` | Source reviewed; runtime proof pending |
| `destination-docs` | Offline documentation browser | `src/renderer/components/DocsBrowser.tsx` | `export function DocsBrowser` | `md3-docs` | Source reviewed; runtime proof pending |
| `destination-doc-article` | Offline documentation article | `src/renderer/components/docs/DocsArticleView.tsx` | `export function DocsArticleView` | `md3-docs-article` | Source reviewed; runtime proof pending |
| `destination-status` | Status destination | `src/renderer/components/StatusSurface.tsx` | `export function StatusSurface` | `md3-status-screen` | Source reviewed; runtime proof pending |
| `destination-shortcuts` | Shortcuts destination | `src/renderer/components/ShortcutsPanel.tsx` | `export function ShortcutsPanel` | `shortcuts` | Source reviewed; runtime proof pending |
| `destination-notification-center` | Notification center | `src/renderer/components/NotificationCenter.tsx` | `export function NotificationCenter` | `notif-center` | Source reviewed; runtime proof pending |
| `destination-notification-toasts` | Notification toast stack | `src/renderer/components/NotificationToasts.tsx` | `export function NotificationToasts` | `toast-stack` | Source reviewed; runtime proof pending |
| `destination-session-memory` | Session memory panel | `src/renderer/components/SessionMemoryPanel.tsx` | `export function SessionMemoryPanel` | `sessmem-panel` | Source reviewed; runtime proof pending |
| `destination-usage` | Usage indicator and popover | `src/renderer/components/UsageIndicator.tsx` | `export function UsageIndicator` | `usage-pill` | Source reviewed; runtime proof pending |
| `destination-updates` | Update status card | `src/renderer/components/UpdateCard.tsx` | `export function UpdateCard` | `update-card` | Source reviewed; runtime proof pending |
| `destination-announcement` | Announcement banner | `src/renderer/components/AnnouncementBanner.tsx` | `export function AnnouncementBanner` | `announce-banner` | Source reviewed; runtime proof pending |
| `destination-conflict` | Conflict banner | `src/renderer/components/ConflictBar.tsx` | `export function ConflictBar` | `conflict-bar` | Source reviewed; runtime proof pending |
| `destination-minecraft` | Minecraft server manager | `src/renderer/components/minecraft/MinecraftServerPanel.tsx` | `export function MinecraftServerPanel` | `mc-body` | Source reviewed; runtime proof pending |
| `destination-ollama` | Ollama suite manager | `src/renderer/components/ollama/OllamaManagerPanel.tsx` | `export function OllamaManagerPanel` | `md3-ollama` | Source reviewed; runtime proof pending |
| `destination-converter` | File converter | `src/renderer/components/converter/FileConverterPanel.tsx` | `export function FileConverterPanel` | `md3-converter` | Source reviewed; runtime proof pending |
| `settings-page` | Settings screen | `src/renderer/components/settings/SettingsPage.tsx` | `export function SettingsPage` | `md3-settings-shell` | Source reviewed; runtime proof pending |
| `settings-sidebar` | Settings sidebar and navigation | `src/renderer/components/settings/SettingsSidebar.tsx` | `export function SettingsSidebar` | `md3-settings-sidebar` | Source reviewed; runtime proof pending |
| `settings-section` | Settings section shell | `src/renderer/components/settings/SettingsSection.tsx` | `export function SettingsSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-field-row` | Settings field row | `src/renderer/components/settings/FieldRow.tsx` | `export function FieldRow` | `md3-settings-row` | Source reviewed; runtime proof pending |
| `settings-searchable-row` | Searchable settings row | `src/renderer/components/settings/SearchableRow.tsx` | `export function SearchableRow` | `md3-settings-row` | Source reviewed; runtime proof pending |
| `settings-theme` | Theme picker | `src/renderer/components/settings/ThemeSelect.tsx` | `export function ThemeSelect` | `md3-theme-menu` | Source reviewed; runtime proof pending |
| `settings-font` | Font picker | `src/renderer/components/settings/FontPicker.tsx` | `export function FontPicker` | `md3-settings-hint` | Source reviewed; runtime proof pending |
| `settings-shortcut-capture` | Shortcut capture field | `src/renderer/components/settings/ShortcutCaptureField.tsx` | `export function ShortcutCaptureField` | `md3-shortcut-field` | Source reviewed; runtime proof pending |
| `settings-terminal-preview` | Terminal preview | `src/renderer/components/settings/TerminalPreview.tsx` | `export function TerminalPreview` | `md3-terminal-preview` | Source reviewed; runtime proof pending |
| `settings-accounts` | Accounts settings | `src/renderer/components/settings/sections/AccountsSection.tsx` | `export function AccountsSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-adhd` | ADHD modes settings | `src/renderer/components/settings/sections/AdhdModesSection.tsx` | `export function AdhdModesSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-agents` | Agent settings | `src/renderer/components/settings/sections/AgentsSection.tsx` | `export function AgentsSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-appearance` | Appearance settings | `src/renderer/components/settings/sections/AppearanceSection.tsx` | `export function AppearanceSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-appearance-editor` | Appearance editor settings | `src/renderer/components/settings/sections/AppearanceEditorSection.tsx` | `export function AppearanceEditorSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-app-identity` | App identity and logo settings | `src/renderer/components/settings/sections/AppIdentitySection.tsx` | `export function AppIdentitySection` | `app-logo__preset` | Source reviewed; runtime proof pending |
| `settings-authenticator` | Authenticator settings | `src/renderer/components/settings/sections/AuthenticatorSection.tsx` | `export function AuthenticatorSection` | `md3-authenticator` | Source reviewed; runtime proof pending |
| `settings-behavior` | Behavior settings | `src/renderer/components/settings/sections/BehaviorSection.tsx` | `export function BehaviorSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-commit` | Commit settings | `src/renderer/components/settings/sections/CommitSection.tsx` | `export function CommitSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-custom-agents` | Custom-agent settings | `src/renderer/components/settings/sections/CustomAgentsSection.tsx` | `export function CustomAgentsSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-github-issues` | GitHub Issues settings | `src/renderer/components/settings/sections/GitHubIssuesSection.tsx` | `export function GitHubIssuesSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-kids` | Kids mode settings | `src/renderer/components/settings/sections/KidsModeSection.tsx` | `export function KidsModeSection` | `md3-kids-disclosure` | Source reviewed; runtime proof pending |
| `settings-language` | Language, funny level, and emoji settings | `src/renderer/components/settings/sections/LanguageSection.tsx` | `export function LanguageSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-license` | License settings | `src/renderer/components/settings/sections/LicenseSection.tsx` | `export function LicenseSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-local-history` | Local history settings | `src/renderer/components/settings/sections/LocalHistorySection.tsx` | `export function LocalHistorySection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-narrator` | Narrator settings | `src/renderer/components/settings/sections/NarratorSection.tsx` | `export function NarratorSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-notch` | Notch settings | `src/renderer/components/settings/sections/NotchSection.tsx` | `export function NotchSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-notifications` | Notification settings | `src/renderer/components/settings/sections/NotificationsSection.tsx` | `export function NotificationsSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-personal-vocabulary` | Personal vocabulary settings | `src/renderer/components/settings/sections/PersonalVocabularySection.tsx` | `export function PersonalVocabularySection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-phone` | Phone and relay settings | `src/renderer/components/settings/sections/PhoneSection.tsx` | `export function PhoneSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-presence` | Presence identity settings | `src/renderer/components/settings/sections/PresenceIdentitySection.tsx` | `export function PresenceIdentitySection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-privacy` | Privacy settings | `src/renderer/components/settings/sections/PrivacySection.tsx` | `export function PrivacySection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-remote` | Remote access settings | `src/renderer/components/settings/sections/RemoteSection.tsx` | `export function RemoteSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-schedule` | Scheduled settings | `src/renderer/components/settings/sections/ScheduleSection.tsx` | `export function ScheduleSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-school` | School mode settings | `src/renderer/components/settings/sections/SchoolModeSection.tsx` | `export function SchoolModeSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-shell` | Windows shell profiles | `src/renderer/components/settings/sections/ShellSection.tsx` | `export function ShellSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-shortcuts` | Shortcut settings | `src/renderer/components/settings/sections/ShortcutsSection.tsx` | `export function ShortcutsSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-speech` | Speech and dictation settings | `src/renderer/components/settings/sections/SpeechSection.tsx` | `export function SpeechSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-ssh` | SSH settings | `src/renderer/components/settings/sections/SshSection.tsx` | `export function SshSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-support` | Support tickets settings | `src/renderer/components/settings/sections/SupportTicketsSection.tsx` | `export function SupportTicketsSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-team` | Team access settings | `src/renderer/components/settings/sections/TeamAccessSection.tsx` | `export function TeamAccessSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-terminal` | Terminal settings | `src/renderer/components/settings/sections/TerminalSection.tsx` | `export function TerminalSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-tmux` | tmux settings | `src/renderer/components/settings/sections/TmuxSection.tsx` | `export function TmuxSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-toy-locks` | Toy locks settings | `src/renderer/components/settings/sections/ToyLocksSection.tsx` | `export function ToyLocksSection` | `toylock-wizard` | Source reviewed; runtime proof pending |
| `settings-updates` | Updates settings | `src/renderer/components/settings/sections/UpdatesSection.tsx` | `export function UpdatesSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-usage` | Usage settings | `src/renderer/components/settings/sections/UsageSection.tsx` | `export function UsageSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `settings-workspace` | Workspace storage settings | `src/renderer/components/settings/sections/WorkspaceStorageSection.tsx` | `export function WorkspaceStorageSection` | `md3-settings-card` | Source reviewed; runtime proof pending |
| `overlay-anchored-popover` | Anchored popover shell | `src/renderer/ui/AnchoredPopover.tsx` | `export function AnchoredPopover` | `anchored-pop` | Source reviewed; runtime proof pending |
| `overlay-command-palette` | Command palette | `src/renderer/components/CommandPalette.tsx` | `export function CommandPalette` | `palette` | Source reviewed; runtime proof pending |
| `overlay-context-menu` | Context menu | `src/renderer/components/ContextMenu.tsx` | `export function ContextMenu` | `ctx-menu` | Source reviewed; runtime proof pending |
| `overlay-filterable-menu` | Filterable menu | `src/renderer/components/menu/FilterableMenu.tsx` | `export function FilterableMenuHeader` | `menu-filter` | Source reviewed; runtime proof pending |
| `overlay-vocabulary-context-menu` | Vocabulary context menu | `src/renderer/components/menu/VocabularyContextMenu.tsx` | `export function VocabularyContextMenu` | `ctx-menu` | Source reviewed; runtime proof pending |
| `overlay-regex-builder` | Full regex builder | `src/renderer/components/regex/RegexBuilder.tsx` | `export function RegexBuilder` | `md3-regex-builder` | Source reviewed; runtime proof pending |
| `overlay-anchored-regex` | Anchored regex builder | `src/renderer/components/regex/AnchoredRegexBuilder.tsx` | `export function AnchoredRegexBuilder` | `md3-regex-trigger` | Source reviewed; runtime proof pending |
| `overlay-confirm` | Confirm dialog | `src/renderer/components/ConfirmDialog.tsx` | `export function ConfirmDialog` | `confirm` | Source reviewed; runtime proof pending |
| `overlay-destructive-gate` | Destructive action gate | `src/renderer/components/DestructiveConfirmGate.tsx` | `export function DestructiveConfirmGate` | `destgate` | Source reviewed; runtime proof pending |
| `overlay-destructive-host` | Destructive gate host | `src/renderer/components/DestructiveGateHost.tsx` | `export function DestructiveGateHost` | `destgate-overlay` | Source reviewed; runtime proof pending |
| `overlay-clone` | Clone repository dialog | `src/renderer/components/CloneRepoDialog.tsx` | `export function CloneRepoDialog` | `clone-dialog` | Source reviewed; runtime proof pending |
| `overlay-bug-report` | Bug report dialog | `src/renderer/components/BugReportDialog.tsx` | `export function BugReportDialog` | `bug-report` | Source reviewed; runtime proof pending |
| `overlay-input` | Input dialog | `src/renderer/components/InputDialog.tsx` | `export function InputDialog` | `confirm` | Source reviewed; runtime proof pending |
| `overlay-worktree` | Worktree dialog | `src/renderer/components/WorktreeDialog.tsx` | `export function WorktreeDialog` | `bind-dialog` | Source reviewed; runtime proof pending |
| `overlay-existing-worktree-picker` | Existing-worktree picker inside Worktree dialog | `src/renderer/components/WorktreeDialog.tsx` | `bind-existing__list` | `bind-existing` | Conflict: p81 owns this picker; record only |
| `overlay-ssh-project` | SSH project dialog | `src/renderer/components/SshProjectDialog.tsx` | `export function SshProjectDialog` | `confirm` | Source reviewed; runtime proof pending |
| `overlay-remote-access` | Remote access dialog | `src/renderer/components/RemoteAccessDialog.tsx` | `export function RemoteAccessDialog` | `remote-dialog` | Source reviewed; runtime proof pending |
| `overlay-ssh-passphrase` | SSH passphrase prompt | `src/renderer/components/SshPassphrasePrompt.tsx` | `export function SshPassphrasePrompt` | `confirm` | Source reviewed; runtime proof pending |
| `overlay-wsl-create` | WSL distribution dialog | `src/renderer/wsl/WslCreateDialog.tsx` | `export function WslCreateDialog` | `confirm` | Source reviewed; runtime proof pending |
| `overlay-group-picker` | Group picker dialog | `src/renderer/components/canvas/GroupPickerDialog.tsx` | `export function GroupPickerDialog` | `group-picker` | Source reviewed; runtime proof pending |
| `overlay-branch-select` | Branch picker | `src/renderer/components/BranchSelect.tsx` | `export function BranchSelect` | `bind-select` | Source reviewed; runtime proof pending |
| `overlay-color-field` | Color field | `src/renderer/components/color/ColorField.tsx` | `export function ColorField` | `color-field` | Source reviewed; runtime proof pending |
| `overlay-color-menu` | Color menu | `src/renderer/components/color/ColorMenu.tsx` | `export function ColorMenu` | `color-popover` | Source reviewed; runtime proof pending |
| `overlay-color-picker` | Infinite color picker | `src/renderer/components/color/ColorPicker.tsx` | `export function ColorPicker` | `color-picker` | Source reviewed; runtime proof pending |
| `overlay-icon-menu` | Project icon picker | `src/renderer/components/icon/IconMenu.tsx` | `export function IconMenu` | `icon-menu` | Source reviewed; runtime proof pending |
| `overlay-appearance-editor` | Per-element appearance editor | `src/renderer/components/appearance/AppearanceEditor.tsx` | `export function AppearanceEditorHost` | `appearance-editor` | Source reviewed; runtime proof pending |
| `overlay-phone-pair` | Phone pairing popover | `src/renderer/components/PhonePairPopover.tsx` | `export function PhonePairPopover` | `phone-pair` | Source reviewed; runtime proof pending |
| `overlay-presence-name` | Presence name prompt | `src/renderer/components/PresenceNamePrompt.tsx` | `export function PresenceNamePrompt` | `presence-prompt` | Source reviewed; runtime proof pending |
| `overlay-notify-consent` | Notification consent dialog | `src/renderer/components/NotifyConsentDialog.tsx` | `export function NotifyConsentDialog` | `consent-card` | Source reviewed; runtime proof pending |
| `overlay-upgrade` | Upgrade dialog | `src/renderer/components/UpgradeDialog.tsx` | `export function UpgradeDialog` | `confirm` | Source reviewed; runtime proof pending |
| `overlay-prompt` | Prompt dialog host | `src/renderer/components/promptDialog.tsx` | `export function PromptDialogHost` | `confirm` | Source reviewed; runtime proof pending |
| `overlay-archive-unlock` | Archive unlock dialog | `src/renderer/components/archiveUnlockDialog.tsx` | `export function ArchiveUnlockDialogHost` | `confirm` | Source reviewed; runtime proof pending |
| `overlay-lock-wizard` | Toy-lock wizard | `src/renderer/components/toylocks/LockWizard.tsx` | `export function LockWizard` | `md3-toylock-wizard` | Source reviewed; runtime proof pending |
| `overlay-unlock-prompt` | Toy-lock unlock prompt | `src/renderer/components/toylocks/UnlockPrompt.tsx` | `export function UnlockPrompt` | `toylock-unlock` | Source reviewed; runtime proof pending |
| `overlay-unlock-ladder` | Unlock ladder | `src/renderer/components/toylocks/UnlockLadder.tsx` | `export function UnlockLadderPanel` | `toylock-ladder` | Source reviewed; runtime proof pending |
| `overlay-two-key-export` | Two-key export gate | `src/renderer/components/authenticator/TwoKeyExportGate.tsx` | `export function TwoKeyExportGate` | `toylock-export-gate` | Source reviewed; runtime proof pending |
| `overlay-tooltip` | Keyboard and pointer tooltip | `src/renderer/components/Tooltip.tsx` | `export function Tooltip` | `tooltip` | Source reviewed; runtime proof pending |
| `overlay-export-menu` | Export menu | `src/renderer/components/ExportMenu.tsx` | `export function ExportMenu` | `md3-export-menu` | Source reviewed; runtime proof pending |
| `overlay-dialog-picker` | Directory picker dialog | `src/renderer/bridge/dialog-picker.tsx` | `export function openDirectoryPicker` | `dir-picker` | Source reviewed; runtime proof pending |
| `overlay-wsl-create-clipping` | WSL creator clipping state from supplied evidence | `src/renderer/wsl/WslCreateDialog.tsx` | `wsl-create-dialog` | `confirm` | Nonconforming and overlapping: p79 owns the fix; record only |
| `status-capability-notice` | Capability notice and unsupported state | `src/renderer/components/CapabilityNotice.tsx` | `export function CapabilityNotice` | `confirm` | Source reviewed; runtime proof pending |
| `status-pty-pressure` | PTY pressure banner | `src/renderer/components/PtyPressureBanner.tsx` | `export function PtyPressureBanner` | `announce-banner` | Source reviewed; runtime proof pending |
| `status-server-deployment` | Server deployment status pill | `src/renderer/components/ServerDeploymentPill.tsx` | `export function ServerDeploymentPill` | `server-deploy-pill` | Source reviewed; runtime proof pending |
| `status-tmux-banner` | tmux state banner | `src/renderer/components/TmuxBanner.tsx` | `export function TmuxBanner` | `announce-banner` | Source reviewed; runtime proof pending |
| `status-resume-card` | Resume state card | `src/renderer/components/ResumeCard.tsx` | `export function ResumeCard` | `resume-card` | Source reviewed; runtime proof pending |
| `status-system-resource` | System resource status pill | `src/renderer/components/SystemResourcePill.tsx` | `export function SystemResourcePill` | `sysres-indicator` | Source reviewed; runtime proof pending |
| `status-presence-layer` | Presence status layer | `src/renderer/components/PresenceLayer.tsx` | `export function PresenceLayer` | `presence-cursor` | Source reviewed; runtime proof pending |
| `status-facepile` | Presence facepile | `src/renderer/components/Facepile.tsx` | `export function Facepile` | `presence-facepile` | Source reviewed; runtime proof pending |
| `status-account-pills` | Account identity pills | `src/renderer/components/AccountIdentityPills.tsx` | `export function AccountIdentityPills` | `account-identity-pills` | Source reviewed; runtime proof pending |
| `status-node-boundary` | Node error boundary | `src/renderer/components/NodeBoundary.tsx` | `export function withNodeBoundary` | `node-error` | Source reviewed; runtime proof pending |
| `site-home` | Landing page home | `site/index.html` | `<body` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-index` | Documentation index page | `site/docs/index.html` | `<article` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-agent-support` | Agent support article | `site/docs/agent-support.html` | `Agent support` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-canvas-lifecycle` | Canvas lifecycle article | `site/docs/canvas-lifecycle.html` | `Canvas &amp; node lifecycle` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-changelog` | Changelog article | `site/docs/changelog-viewer.html` | `Changelog viewer` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-dim-sum` | Dim sum article | `site/docs/dim-sum-surprise.html` | `Dim sum surprise` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-exports` | Exports and history article | `site/docs/exports-and-history.html` | `Exports` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-kanban` | Kanban article | `site/docs/kanban-board.html` | `Kanban board` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-language` | Language modes article | `site/docs/language-modes.html` | `Language modes` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-narrator` | Narrator article | `site/docs/narrator.html` | `Narrator` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-node-kinds` | Node kinds article | `site/docs/node-kinds.html` | `Node kinds` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-packaging` | Packaging article | `site/docs/packaging-updates.html` | `Packaging` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-personal-vocabulary` | Personal vocabulary article | `site/docs/personal-vocabulary.html` | `Personal vocabulary` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-projects` | Projects and tabs article | `site/docs/projects-and-tabs.html` | `Projects` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-remote` | Remote projects article | `site/docs/remote-ssh-projects.html` | `Remote` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-school` | School mode article | `site/docs/school-mode.html` | `School mode` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-server` | Server Edition article | `site/docs/server-edition.html` | `Server Edition` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-source-control` | Source control article | `site/docs/source-control-worktrees.html` | `Source control` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-speech` | Speech article | `site/docs/speech-dictation.html` | `Speech` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-terminal` | Terminal sessions article | `site/docs/terminal-sessions.html` | `Terminal sessions` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-toy-locks` | Toy locks article | `site/docs/toy-locks.html` | `Toy locks` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-docs-windows` | Windows support article | `site/docs/windows-support.html` | `Windows support` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `site-styles` | Landing and documentation style sheet | `site/styles.css` | `:focus-visible` | site preservation boundary | Preserve current Kids mode visual style; stale facts only |
| `desktop-onboarding` | First-run onboarding flow | `src/renderer/components/onboarding/OnboardingFlow.tsx` | `export function OnboardingFlow` | `onb` | Source reviewed; runtime proof pending |
| `desktop-fab-menu` | Floating action menu | `src/renderer/components/FabMenu.tsx` | `export function FabMenu` | `md3-fab-menu` | Source reviewed; runtime proof pending |
| `destination-password-manager` | Password manager destination | `src/renderer/components/passwordManager/PasswordManagerPanel.tsx` | `export function PasswordManagerPanel` | `md3-passwordmanager` | Source reviewed; runtime proof pending |
| `destination-adapter-catalog` | Converter adapter catalog | `src/renderer/components/converter/AdapterCatalog.tsx` | `export function AdapterCatalog` | `cv-catalog` | Source reviewed; runtime proof pending |
| `destination-minecraft-backups` | Minecraft backups panel | `src/renderer/components/minecraft/MinecraftBackupsPanel.tsx` | `export function MinecraftBackupsPanel` | `mc-players` | Source reviewed; runtime proof pending |
| `destination-minecraft-players` | Minecraft players panel | `src/renderer/components/minecraft/MinecraftPlayersPanel.tsx` | `export function MinecraftPlayersPanel` | `mc-players` | Source reviewed; runtime proof pending |
| `destination-minecraft-properties` | Minecraft properties editor | `src/renderer/components/minecraft/MinecraftPropertiesEditor.tsx` | `export function MinecraftPropertiesEditor` | `mc-properties__grid` | Source reviewed; runtime proof pending |
| `destination-dim-sum` | Dim sum startup surprise | `src/renderer/components/DimSumSurprise.tsx` | `export function DimSumSurprise` | `dimsum-toast` | Source reviewed; runtime proof pending |
| `overlay-publish` | Publish destination dialog | `src/renderer/components/PublishDialog.tsx` | `export function PublishDialog` | `pubdlg` | Source reviewed; runtime proof pending |
| `overlay-find-bar` | Terminal find bar | `src/renderer/components/FindBar.tsx` | `export function FindBar` | `term-node__find` | Source reviewed; runtime proof pending |
| `overlay-remote-picker` | Remote picker menu | `src/renderer/components/RemotePicker.tsx` | `export function RemotePicker` | `ctx-menu` | Source reviewed; runtime proof pending |

### State and pseudo-state audit

The state rows are a separate hand-written list because a selector scan can report only the states that still happen to exist. Each row names the source token or selector that must remain present for the state to stay reachable and reviewable.

| ID | State | Source marker | Token or selector marker | Status |
| --- | --- | --- | --- | --- |
| `state-theme-dark` | Dark theme token state | `src/renderer/styles.css` | `--md-primary` | Source reviewed; runtime proof pending |
| `state-theme-light` | Light theme token state | `src/renderer/styles.css` | `--md-primary` | Source reviewed; runtime proof pending |
| `state-focus-visible` | Keyboard focus-visible state | `src/renderer/styles.md3.css` | `--md-primary` | Source reviewed; runtime proof pending |
| `state-hover` | Pointer hover state layer | `src/renderer/styles.md3.css` | `--md-surface-container-highest` | Source reviewed; runtime proof pending |
| `state-disabled` | Disabled control state | `src/renderer/styles.md3.css` | `--md-outline` | Source reviewed; runtime proof pending |
| `state-selected` | Selected control state | `src/renderer/styles.md3.css` | `--md-secondary-container` | Source reviewed; runtime proof pending |
| `state-pressed` | Pressed and toggle state | `src/renderer/styles.md3.css` | `--md-secondary-container` | Source reviewed; runtime proof pending |
| `state-error` | Error and needs-attention state | `src/renderer/styles.md3.css` | `--md-error-container` | Source reviewed; runtime proof pending |
| `state-empty` | Empty-state styling | `src/renderer/styles.md3.css` | `--md-surface-container` | Source reviewed; runtime proof pending |
| `state-loading` | Loading and busy state | `src/renderer/styles.md3.css` | `--md-motion-effect` | Source reviewed; runtime proof pending |
| `state-progress` | Determinate progress state | `src/renderer/ui/md3/primitives.css` | `--md-primary` | Source reviewed; runtime proof pending |
| `state-progress-indeterminate` | Indeterminate progress state | `src/renderer/ui/md3/primitives.css` | `--md-motion-effect` | Source reviewed; runtime proof pending |
| `state-reduced-motion` | Reduced-motion state | `src/renderer/ui/md3/primitives.css` | `--md-motion-effect` | Source reviewed; runtime proof pending |
| `state-narrow-layout` | Narrow-layout state | `src/renderer/styles.md3.css` | `--md-surface-container` | Source reviewed; runtime proof pending |
| `state-display-scale` | Display-scale sizing helper state | `src/renderer/terminal/raster-scale.ts` | `md3-settings-shell` | Source reviewed; runtime proof pending |
| `state-drag-over` | Drag-over and drop-target state | `src/renderer/styles.md3.css` | `--md-primary` | Source reviewed; runtime proof pending |
| `state-locked` | Locked surface state | `src/renderer/styles.md3.css` | `--md-error-container` | Source reviewed; runtime proof pending |
| `state-unavailable` | Unavailable capability state | `src/renderer/styles.md3.css` | `--md-on-surface-variant` | Source reviewed; runtime proof pending |
| `state-working` | Working status state | `src/renderer/styles.css` | `--md-tertiary-container` | Source reviewed; runtime proof pending |
| `state-needs-you` | Needs-user status state | `src/renderer/styles.md3.css` | `--md-error-container` | Source reviewed; runtime proof pending |
| `state-scrim` | Overlay scrim state | `src/renderer/styles.md3.css` | `--md-scrim` | Source reviewed; runtime proof pending |
| `state-tooltip` | Tooltip visible state | `src/renderer/styles.md3.css` | `--md-surface-container-highest` | Source reviewed; runtime proof pending |
| `state-tab-overflow` | Tab overflow and scroll state | `src/renderer/styles.css` | `--md-outline-variant` | Source reviewed; runtime proof pending |

## Source-level findings

The shared button, text input, select, switch, segmented control, checkbox, text area, slider, card, menu, dialog, chip, badge, list-row, divider, radio, progress, and tabs recipes are now reachable from the renderer boot path. Feature-owned selectors remain where they carry domain data or canvas geometry, but their chrome reads the shared `--md-*` roles and named shape tokens. The inventory is deliberately more specific than a broad selector scan, so a missing surface or a removed source marker is visible.

The final desktop style layer also normalizes the older `sc-btn`, `mc-button`, and `toylock-btn` control names onto the same Material Design 3 outlined or filled button anatomy. Their historical class names remain only as behavior hooks, while color, typography, shape, state layer, focus, and disabled treatment come from the shared token contract.

The remaining source-only caveat is visual confirmation. The desktop package must still be launched through the approved hidden desktop route at a later verification checkpoint, with the capture tuple bound to the exact source commit. This document does not mark that proof as complete.

## Personal vocabulary producer inventory

Every listed renderer producer has an explicit local mapper boundary. Commands, paths, identifiers, external records, filenames, hashes, provider values, and user-supplied values remain outside the boundary. The inventory is hand-written and checked by `scripts/check-personal-vocabulary-coverage.mjs`.

| Producer | Surface | Source | Required boundary |
| --- | --- | --- | --- |
| `settings-fields` | FieldRow | `src/renderer/components/settings/FieldRow.tsx` | `useVocabularyMapper()` |
| `settings-sections` | SettingsSection | `src/renderer/components/settings/SettingsSection.tsx` | `useVocabularyMapper()` |
| `settings-page` | Settings scope and every production section host | `src/renderer/components/settings/SettingsPage.tsx` | `useLocalizedVocabularyText()` |
| `settings-page-registration` | Settings page vocabulary section registration | `src/renderer/components/settings/SettingsPage.tsx` | `<PersonalVocabularySection` |
| `settings-sidebar` | Settings group and section navigation | `src/renderer/components/settings/SettingsSidebar.tsx` | `useI18n()` shared vocabulary boundary |
| `settings-sidebar-registration` | Settings sidebar section registry | `src/renderer/components/settings/SettingsSidebar.tsx` | `visibleSettingsGroups(` |
| `settings-search-corpus` | Settings search matches visible replacements and shipped aliases | `src/renderer/components/settings/SearchableRow.tsx` | `useVocabularyMapper()` |
| `settings-inline-copy` | Explicit prose boundary for settings inline text | `src/renderer/components/settings/SettingsText.tsx` | `useVocabularyMapper()` |
| `settings-reset` | Section reset copy | `src/renderer/components/settings/SectionReset.tsx` | `useVocabularyMapper()` |
| `settings-font-picker` | Font picker labels and states | `src/renderer/components/settings/FontPicker.tsx` | `useVocabularyMapper()` |
| `settings-theme-picker` | Theme picker labels | `src/renderer/components/settings/ThemeSelect.tsx` | `useVocabularyMapper()` |
| `settings-section-inline-copy` | Standalone settings prose boundary | `src/renderer/components/settings/SettingsText.tsx` | `export function SettingsText` |
| `settings-copy-facts` | Typed copy/fact segments and template facts | `src/renderer/components/settings/SettingsText.tsx`, `FieldRow.tsx` | `SettingsTextSegment`, `labelSegments` |
| `settings-resolution-ownership` | Section versus row vocabulary ownership | `src/renderer/components/settings/context.ts`, `SettingsSection.tsx`, `FieldRow.tsx`, `SearchableRow.tsx` | `resolutionIncludes` |
| `settings-section-registry` | Shared Settings section identity for routing and navigation | `src/renderer/components/settings/nav.ts`, `SettingsPage.tsx`, `SettingsSidebar.tsx` | `SETTINGS_SECTION_REGISTRY` |
| `settings-search-policy` | Settings visible/shipped search and School-mode rename policy | `src/renderer/components/settings/vocabulary.ts` | `export function settingsSidebarSearchEntry` |
| `school-mode-settings` | School-mode placeholders and settings prose | `src/renderer/components/settings/sections/SchoolModeSection.tsx` | `useVocabularyMapper()` |
| `kids-mode-settings` | Kids-mode placeholders and settings prose | `src/renderer/components/settings/sections/KidsModeSection.tsx` | `useVocabularyMapper()` |
| `usage-settings` | Usage credential placeholder copy | `src/renderer/components/settings/sections/UsageSection.tsx` | `useVocabularyMapper()` |
| `shared-prose-primitives` | Shared controls carrying prose props | `src/renderer/ui/` | `useVocabularyMapper()` in each primitive |
| `ui-button-wrapper-delegation` | Compatibility button delegates prose mapping to MD3 button | `src/renderer/ui/Button.tsx` | `<Md3Button` |
| `ui-input` | Input accessible labels and placeholders | `src/renderer/ui/Input.tsx` | `useVocabularyMapper()` |
| `ui-md3-button` | MD3 button authored/factual labels | `src/renderer/ui/md3/Button.tsx` | `useVocabularyMapper()` |
| `ui-chip` | Chip authored/factual text | `src/renderer/ui/md3/Chip.tsx` | `useVocabularyMapper()` |
| `ui-menu` | Menu authored/factual accessible text | `src/renderer/ui/md3/Menu.tsx` | `useVocabularyMapper()` |
| `ui-status-chip` | Status chip authored/factual text | `src/renderer/ui/md3/StatusChip.tsx` | `useVocabularyMapper()` |
| `ui-switch` | Switch accessible label intent | `src/renderer/ui/Switch.tsx` | `useVocabularyTemplate(` |
| `ui-select` | Select labels and option groups | `src/renderer/ui/Select.tsx` | `useVocabularyMapper()` |
| `ui-number-field` | Number field labels and placeholders | `src/renderer/ui/NumberField.tsx` | `useVocabularyMapper()` |
| `ui-text-area` | Text area labels and placeholders | `src/renderer/ui/md3/TextArea.tsx` | `useVocabularyMapper()` |
| `ui-text-field` | Text field labels and support text | `src/renderer/ui/md3/TextField.tsx` | `useVocabularyMapper()` |
| `ui-fab` | Floating action button labels | `src/renderer/ui/md3/Fab.tsx` | `useVocabularyMapper()` |
| `ui-icon-button` | Icon button labels | `src/renderer/ui/md3/IconButton.tsx` | `useVocabularyMapper()` |
| `ui-segmented-button` | Segmented option labels | `src/renderer/ui/md3/SegmentedButton.tsx` | `useVocabularyMapper()` |
| `ui-dialog` | Dialog title and accessible label | `src/renderer/ui/md3/Dialog.tsx` | `useVocabularyMapper()` |
| `ui-list-row` | List-row authored/factual labels | `src/renderer/ui/md3/ListRow.tsx` | `useVocabularyMapper()` |
| `ui-tabs` | Tab labels and accessible name | `src/renderer/ui/md3/Tabs.tsx` | `useVocabularyMapper()` |
| `ui-slider` | Slider accessible labels | `src/renderer/ui/md3/Slider.tsx` | `useVocabularyMapper()` |
| `ui-checkbox` | Checkbox accessible labels | `src/renderer/ui/md3/Checkbox.tsx` | `useVocabularyMapper()` |
| `ui-radio` | Radio accessible labels | `src/renderer/ui/md3/Radio.tsx` | `useVocabularyMapper()` |
| `filterable-menu` | Filter field prose | `src/renderer/components/menu/FilterableMenu.tsx` | `useVocabularyMapper()` |
| `editable-node-title` | Editable title copy | `src/renderer/components/EditableNodeTitle.tsx` | `useVocabularyMapper()` |
| `destructive-confirm-gate` | Destructive confirmation prose | `src/renderer/components/DestructiveConfirmGate.tsx` | `useVocabularyMapper()` |
| `shared-input-controls` | Shared range, checkbox and radio accessible copy | `src/renderer/ui/md3/Slider.tsx`, `Checkbox.tsx`, `Radio.tsx` | `useVocabularyMapper()` |
| `personal-vocabulary-upload` | Upload settings | `src/renderer/components/settings/sections/PersonalVocabularySection.tsx` | `usePersonalVocabulary` |
| `command-palette` | Command palette | `src/renderer/components/CommandPalette.tsx` | `useVocabularyCommands` |
| `context-menus` | Context menus | `src/renderer/components/menu/VocabularyContextMenu.tsx` | `useVocabularyMenuItems` |
| `confirm-dialog` | Confirm dialog | `src/renderer/components/ConfirmDialog.tsx` | `useVocabularyMapper()` |
| `input-dialog` | Input dialog | `src/renderer/components/InputDialog.tsx` | `useVocabularyMapper()` |
| `notifications` | Notification toasts | `src/renderer/components/NotificationToasts.tsx` | `useVocabularyMapper()` |
| `tooltip` | Tooltips | `src/renderer/components/Tooltip.tsx` | `useVocabularyMapper()` |
| `conflict-banner` | Conflict banner | `src/renderer/components/ConflictBar.tsx` | `useVocabularyMapper()` |
| `canvas-prose` | Canvas prose | `src/renderer/canvas/Canvas.tsx` | `useLocalizedVocabularyText` |
| `fab-menu` | FAB menu | `src/renderer/components/FabMenu.tsx` | `useVocabularyMapper()` |
| `kanban-view` | Kanban view | `src/renderer/components/kanban/KanbanView.tsx` | `VocabularyContextMenu` |
| `kanban-column` | Kanban column | `src/renderer/components/kanban/KanbanColumn.tsx` | `useVocabularyMapper()` |
| `kanban-session-card` | Kanban session card | `src/renderer/components/kanban/SessionCard.tsx` | `useVocabularyMapper()` |
| `kanban-card-modal` | Kanban card modal | `src/renderer/components/kanban/CardModal.tsx` | `useVocabularyMapper()` |
| `source-control` | Source control | `src/renderer/components/SourceControlPanel.tsx` | `VocabularyContextMenu` |
| `worktree-dialog` | Worktree dialog | `src/renderer/components/WorktreeDialog.tsx` | `useVocabularyMapper()` |
| `onboarding` | Onboarding | `src/renderer/components/onboarding/OnboardingFlow.tsx` | `useVocabularyMapper()` |
| `dim-sum-surprise` | Dim sum surprise | `src/renderer/components/DimSumSurprise.tsx` | `useVocabularyMapper()` |
| `publish-dialog` | Publish dialog | `src/renderer/components/PublishDialog.tsx` | `useVocabularyMapper()` |
| `find-bar` | Find bar | `src/renderer/components/FindBar.tsx` | `useVocabularyMapper()` |
| `remote-picker` | Remote picker | `src/renderer/components/RemotePicker.tsx` | `useVocabularyMapper()` |
| `browser-profile-picker` | Browser profile picker | `src/renderer/nodes/BrowserProfilePicker.tsx` | `useVocabularyMapper()` |
| `wsl-create-dialog` | WSL distribution and instance creation dialog | `src/renderer/wsl/WslCreateDialog.tsx` | `useI18n()`, `useVocabularyMapper()`, `WSL_COPY_IDS`, and typed template parameters that preserve runtime facts |
| `terminal-node` | Terminal node chrome and status copy | `src/renderer/nodes/TerminalNode.tsx` | `useVocabularyMapper()` and `useLocalizedVocabularyText()` |
| `sticky-node` | Sticky note node chrome | `src/renderer/nodes/StickyNode.tsx` | `useVocabularyMapper()` |
| `group-node` | Group and WSL/worktree node chrome | `src/renderer/nodes/GroupNode.tsx` | `useVocabularyMapper()` |
| `editor-node` | Editor and media preview node chrome | `src/renderer/nodes/EditorNode.tsx` | `useVocabularyMapper()` |
| `diff-node` | Diff node chrome | `src/renderer/nodes/DiffNode.tsx` | `useVocabularyMapper()` |
| `browser-node` | Browser node chrome and tabs | `src/renderer/nodes/BrowserNode.tsx` | `useVocabularyMapper()` |
| `browser-surface` | Browser toolbar and navigation copy | `src/renderer/nodes/BrowserSurface.tsx` | `useVocabularyMapper()` |
| `browser-start-page` | Browser new-tab surface | `src/renderer/nodes/BrowserStartPage.tsx` | `useVocabularyMapper()` |
| `browser-extensions-panel` | Browser extension panel | `src/renderer/nodes/BrowserExtensionsPanel.tsx` | `useVocabularyMapper()` |
| `discarded-plate` | Browser released/restoring status plate | `src/renderer/nodes/DiscardedPlate.tsx` | `useVocabularyMapper()` |
| `video-node` | Video node loading and chrome | `src/renderer/nodes/VideoNode.tsx` | `useVocabularyMapper()` |
| `web-node` | Web node loading and chrome | `src/renderer/nodes/WebNode.tsx` | `useVocabularyMapper()` |
| `loop-node` | Hook-derived loop card | `src/renderer/nodes/LoopNode.tsx` | `useVocabularyMapper()` |
| `native-loop-node` | User-created scheduler node | `src/renderer/nodes/NativeLoopNode.tsx` | `useVocabularyMapper()` |
| `nsis-node` | Installer builder node | `src/renderer/nodes/NsisInstallerNode.tsx` | `useVocabularyMapper()` |
| `service-node` | Service manager node chrome and guidance | `src/renderer/nodes/ServiceNode.tsx` | `useVocabularyMapper()` |
| `authenticator-node` | Authenticator node chrome and states | `src/renderer/nodes/AuthenticatorNode.tsx` | `useVocabularyMapper()` |
| `annotation-node` | Annotation toolbar | `src/renderer/nodes/AnnotationNode.tsx` | `useVocabularyMapper()` |
| `dino-node` | Dino peer status and chrome | `src/renderer/nodes/DinoNode.tsx` | `useVocabularyMapper()` |
| `subagent-node` | Subagent status card | `src/renderer/nodes/SubagentNode.tsx` | `useVocabularyMapper()` |
| `chat-panel` | Agent chat panel states and composer | `src/renderer/nodes/ChatPanel.tsx` | `useVocabularyMapper()` |
| `node-fact-preserving-mapper` | Node copy mapper that preserves provider and runtime facts | `src/renderer/nodes/nodeVocabulary.ts` | `export function mapAroundExactFacts` |
| `password-manager` | Password manager | `src/renderer/components/passwordManager/PasswordManagerPanel.tsx` | `useVocabularyMapper()` |
| `converter-adapter-catalog` | Adapter catalog | `src/renderer/components/converter/AdapterCatalog.tsx` | `useVocabularyMapper()` |
| `converter-panel` | File converter panel and queue | `src/renderer/components/converter/FileConverterPanel.tsx` | `useVocabularyMapper()` |
| `ollama-manager` | Local model manager | `src/renderer/components/ollama/OllamaManagerPanel.tsx` | `useVocabularyMapper()` |
| `explorer-panel` | Explorer panel | `src/renderer/components/ExplorerPanel.tsx` | `useVocabularyMapper()` |
| `project-switcher` | Project switcher | `src/renderer/components/ProjectSwitcher.tsx` | `useVocabularyMapper()` |
| `regex-builder` | Regex builder | `src/renderer/components/regex/RegexBuilder.tsx` | `useVocabularyMapper()` |
| `anchored-regex-builder` | Anchored regex trigger | `src/renderer/components/regex/AnchoredRegexBuilder.tsx` | `useVocabularyMapper()` |
| `changelog-panel` | Changelog panel | `src/renderer/components/changelog/ChangelogPanel.tsx` | `useVocabularyMapper()` |
| `release-card` | Release card | `src/renderer/components/changelog/ReleaseCard.tsx` | `useVocabularyMapper()` |
| `local-history-panel` | Local history panel | `src/renderer/components/LocalHistoryPanel.tsx` | `useVocabularyMapper()` |
| `docs-browser` | Offline documentation browser | `src/renderer/components/DocsBrowser.tsx` | `useVocabularyMapper()` |
| `docs-article-view` | Documentation article chrome | `src/renderer/components/docs/DocsArticleView.tsx` | `useVocabularyMapper()` |
| `appearance-editor` | Appearance editor | `src/renderer/components/appearance/AppearanceEditor.tsx` | `useVocabularyMapper()` |
| `color-field` | Colour field | `src/renderer/components/color/ColorField.tsx` | `useVocabularyMapper()` |
| `color-picker` | Colour picker | `src/renderer/components/color/ColorPicker.tsx` | `useVocabularyMapper()` |
| `bulk-preview-segments` | Bulk preview typed copy and count fields | `src/renderer/components/BulkActionPreview.tsx` | `messageSegments={messageSegments}` |
| `bulk-preview-single-title-map` | Bulk preview action-label boundary | `src/renderer/components/BulkActionBar.tsx` | `title={vocab(pending.label)}` |
| `project-storage-segments` | Project storage confirmation facts | `src/renderer/components/ProjectSwitcher.tsx` | `messageSegments={` |
| `project-other-unread-fact` | Other-project unread count fact | `src/renderer/components/ProjectSwitcher.tsx` | `mapOwnedSentence(vocab, [fact(String(otherUnread))` |
| `converter-detection-note-fact` | Converter detection note fact | `src/renderer/components/converter/FileConverterPanel.tsx` | `f.detection.note` |
| `converter-adapter-id-corpus` | Adapter id search corpus | `src/renderer/components/converter/AdapterCatalog.tsx` | `row.id} ${row.label}` |
| `ollama-staleness-segments` | Model catalogue staleness facts | `src/renderer/components/ollama/OllamaManagerPanel.tsx` | `mapOwnedSentence(vocab, staleness)` |
| `ollama-completeness-segments` | Model catalogue completeness facts | `src/renderer/components/ollama/OllamaManagerPanel.tsx` | `catalogHeadlineText(vocab, catalog)` |
| `ollama-completeness-reason-fact` | Model catalogue reason facts | `src/renderer/components/ollama/OllamaManagerPanel.tsx` | `mapOwnedSentence(vocab, [fact(reason)]` |
| `ollama-queue-phase-fact` | Pull queue phase ownership | `src/renderer/components/ollama/OllamaManagerPanel.tsx` | `item.digestPhase ?? vocab(item.status)` |
| `ollama-fit-evidence-fact` | Hardware fit evidence ownership | `src/renderer/components/ollama/OllamaManagerPanel.tsx` | `vocab('Evidence:')` |
| `appearance-weight-segments` | Font weight copy and numeric facts | `src/renderer/components/appearance/AppearanceEditor.tsx` | `w.label.indexOf` |
| `appearance-font-preview-fact` | Font preview name ownership | `src/renderer/components/appearance/AppearanceEditor.tsx` | `quoteFamily(primary ||` |
| `docs-section-copy` | Documentation section metadata | `src/renderer/components/DocsBrowser.tsx` | `vocab(section.label)` |
| `history-restore-segments` | History restore target ownership | `src/renderer/components/LocalHistoryPanel.tsx` | `messageSegments={[` |
| `converter-upload-limit` | Converter upload limit message | `src/renderer/components/converter/FileConverterPanel.tsx` | `mapLocalVocabularyText(` |
| `minecraft-backups` | Minecraft backups | `src/renderer/components/minecraft/MinecraftBackupsPanel.tsx` | `useVocabularyMapper()` |
| `minecraft-players` | Minecraft players | `src/renderer/components/minecraft/MinecraftPlayersPanel.tsx` | `useVocabularyMapper()` |
| `minecraft-properties` | Minecraft properties | `src/renderer/components/minecraft/MinecraftPropertiesEditor.tsx` | `useVocabularyMapper()` |
| `authenticator-settings` | Authenticator settings | `src/renderer/components/settings/sections/AuthenticatorSection.tsx` | `useVocabularyMapper` |
| `speech-settings` | Speech settings | `src/renderer/components/settings/sections/SpeechSection.tsx` | `useVocabularyMapper` |
| `toy-lock-wizard` | Toy lock wizard | `src/renderer/components/toylocks/LockWizard.tsx` | `useVocabularyMapper` |
| `personal-vocabulary-surface-mapper` | Structured surface mapper | `src/renderer/lib/personalVocabulary/surfaces.ts` | `applyVocabularyToMenuItems` |
| `personal-vocabulary-application` | Replacement engine | `src/renderer/lib/personalVocabulary/apply.ts` | `export function applyVocabulary` |
| `typed-copy-fact-boundary` | Typed application-copy versus exact-fact segments | `src/renderer/lib/personalVocabulary/ownedCopy.ts` | `mapOwnedSentence` |
| `personal-vocabulary-host-message` | Typed authored/fact host message boundary | `src/renderer/lib/personalVocabulary/hostMessage.ts` | `formatHostMessage(` |
| `widget-entrypoint` | Detached widget entrypoint | `src/renderer/widget/WidgetApp.tsx` | `useVocabularyMapper()` |
| `hud-entrypoint` | Vanilla DOM HUD entrypoint | `src/renderer/hud/main.ts` | `mapLocalVocabularyText(` |
| `dialog-picker-root` | Browser dialog-picker root | `src/renderer/bridge/dialog-picker.tsx` | `useVocabularyMapper()` |
| `ws-reconnect-overlay` | Browser reconnect overlay | `src/renderer/bridge/ws-bridge.ts` | `mapLocalVocabularyText(` |
| `browser-bridge-stubs` | Browser bridge stub messages | `src/renderer/bridge/stubs.ts` | `formatHostMessage(` |
| `notification-body-classification` | Typed authored versus fact notification body | `src/renderer/state/notifications.ts` | `bodyKind` |
| `site-vocabulary-json` | Landing-page JSON upload | `site/app/features/vocabulary.js` | `validateVocabularyJson(` |
| `site-vocabulary-cache` | Landing-page cache envelope | `site/app/shared/vocabulary-state.js` | `validateVocabularyCacheJson(` |
| `native-notification-canvas` | Native notification fact route | `src/renderer/canvas/Canvas.tsx` | `mapNativeNotification(` |
| `native-notification-onboarding` | Native authored notification route | `src/renderer/components/onboarding/OnboardingFlow.tsx` | `mapNativeNotification(` |
| `native-notification-settings` | Native authored notification route | `src/renderer/components/settings/sections/NotificationsSection.tsx` | `mapNativeNotification(` |
| `personal-vocabulary-template` | Safe prose-template interpolation | `src/renderer/lib/personalVocabulary/apply.ts` | `export function applyVocabularyToTemplate` |
| `native-notification-browser` | Browser notification ownership route | `src/renderer/bridge/stubs.ts` | `mapNativeNotification(` |
| `native-notification-main` | Main notification admission route | `src/main/notifications.ts` | `prepareNativeNotification(` |

## Complete production surface classification

Every production renderer surface is explicitly classified below. Surfaces marked
unmapped-callsite-pending are intentionally reported as open until their own prose and accessible
names call the validated mapper. The root-level attempted boundary was removed because traversing a
single React element cannot reach the descendants produced by a component.

| Surface | Source | Boundary |
| --- | --- | --- |
| app-shell | src/renderer/App.tsx | shell-only-no-copy |
| welcome | src/renderer/components/WelcomeScreen.tsx | mapped-callsite |
| top-app-bar | src/renderer/components/TopAppBar.tsx | user-display-only |
| status-surface | src/renderer/components/StatusSurface.tsx | mapped-callsite |
| sessions-sidebar | src/renderer/components/SessionsSidebar.tsx | mapped-callsite |
| session-row | src/renderer/components/SessionRow.tsx | mapped-callsite |
| terminal-node | src/renderer/nodes/TerminalNode.tsx | mapped-callsite |
| sticky-node | src/renderer/nodes/StickyNode.tsx | mapped-callsite |
| group-node | src/renderer/nodes/GroupNode.tsx | mapped-callsite |
| editor-node | src/renderer/nodes/EditorNode.tsx | mapped-callsite |
| diff-node | src/renderer/nodes/DiffNode.tsx | mapped-callsite |
| browser-node | src/renderer/nodes/BrowserNode.tsx | mapped-callsite |
| web-node | src/renderer/nodes/WebNode.tsx | mapped-callsite |
| video-node | src/renderer/nodes/VideoNode.tsx | mapped-callsite |
| loop-node | src/renderer/nodes/LoopNode.tsx | mapped-callsite |
| service-node | src/renderer/nodes/ServiceNode.tsx | mapped-callsite |
| native-loop-node | src/renderer/nodes/NativeLoopNode.tsx | mapped-callsite |
| nsis-node | src/renderer/nodes/NsisInstallerNode.tsx | mapped-callsite |
| authenticator-node | src/renderer/nodes/AuthenticatorNode.tsx | mapped-callsite |
| annotation-node | src/renderer/nodes/AnnotationNode.tsx | mapped-callsite |
| dino-node | src/renderer/nodes/DinoNode.tsx | mapped-callsite |
| subagent-node | src/renderer/nodes/SubagentNode.tsx | mapped-callsite |
| chat-panel | src/renderer/nodes/ChatPanel.tsx | mapped-callsite |
| browser-surface | src/renderer/nodes/BrowserSurface.tsx | mapped-callsite |
| browser-start-page | src/renderer/nodes/BrowserStartPage.tsx | mapped-callsite |
| browser-extensions-panel | src/renderer/nodes/BrowserExtensionsPanel.tsx | mapped-callsite |
| discarded-plate | src/renderer/nodes/DiscardedPlate.tsx | mapped-callsite |
| wsl-dialog | src/renderer/wsl/WslCreateDialog.tsx | unmapped-callsite-pending |
| regex-builder | src/renderer/components/regex/RegexBuilder.tsx | mapped-callsite |
| anchored-regex-builder | src/renderer/components/regex/AnchoredRegexBuilder.tsx | mapped-callsite |
| wsl-dialog | src/renderer/wsl/WslCreateDialog.tsx | mapped-callsite |
| regex-builder | src/renderer/components/regex/RegexBuilder.tsx | unmapped-callsite-pending |
| anchored-regex-builder | src/renderer/components/regex/AnchoredRegexBuilder.tsx | unmapped-callsite-pending |
| notification-center | src/renderer/components/NotificationCenter.tsx | mapped-callsite |
| notification-toasts | src/renderer/components/NotificationToasts.tsx | mapped-callsite |
| changelog-panel | src/renderer/components/changelog/ChangelogPanel.tsx | mapped-callsite |
| release-card | src/renderer/components/changelog/ReleaseCard.tsx | mapped-callsite |
| local-history | src/renderer/components/LocalHistoryPanel.tsx | mapped-callsite |
| local-history-panel | src/renderer/components/LocalHistoryPanel.tsx | mapped-callsite |
| docs-browser | src/renderer/components/DocsBrowser.tsx | mapped-callsite |
| docs-article | src/renderer/components/docs/DocsArticleView.tsx | mapped-callsite |
| docs-article-view | src/renderer/components/docs/DocsArticleView.tsx | mapped-callsite |
| appearance-editor | src/renderer/components/appearance/AppearanceEditor.tsx | mapped-callsite |
| color-field | src/renderer/components/color/ColorField.tsx | mapped-callsite |
| color-menu | src/renderer/components/color/ColorMenu.tsx | colors-only-no-prose |
| color-picker | src/renderer/components/color/ColorPicker.tsx | mapped-callsite |
| branch-select | src/renderer/components/BranchSelect.tsx | literal-provider-boundary |
| bulk-action-bar | src/renderer/components/BulkActionBar.tsx | mapped-callsite |
| explorer-panel | src/renderer/components/ExplorerPanel.tsx | mapped-callsite |
| project-switcher | src/renderer/components/ProjectSwitcher.tsx | mapped-callsite |
| ollama-manager | src/renderer/components/ollama/OllamaManagerPanel.tsx | mapped-callsite |
| converter-panel | src/renderer/components/converter/FileConverterPanel.tsx | mapped-callsite |
| pty-pressure | src/renderer/components/PtyPressureBanner.tsx | mapped-callsite |
| update-card | src/renderer/components/UpdateCard.tsx | mapped-callsite |
| resume-card | src/renderer/components/ResumeCard.tsx | mapped-callsite |
| announcement-banner | src/renderer/components/AnnouncementBanner.tsx | mapped-callsite |
| session-memory | src/renderer/components/SessionMemoryPanel.tsx | mapped-callsite |
| remote-access-dialog | src/renderer/components/RemoteAccessDialog.tsx | mapped-callsite |
| ssh-project-dialog | src/renderer/components/SshProjectDialog.tsx | mapped-callsite |
| phone-pair-popover | src/renderer/components/PhonePairPopover.tsx | mapped-callsite |
| dictation-overlay | src/renderer/components/DictationOverlay.tsx | mapped-callsite |
| bulk-action-bar | src/renderer/components/BulkActionBar.tsx | unmapped-callsite-pending |
| pty-pressure | src/renderer/components/PtyPressureBanner.tsx | unmapped-callsite-pending |
| update-card | src/renderer/components/UpdateCard.tsx | unmapped-callsite-pending |
| resume-card | src/renderer/components/ResumeCard.tsx | unmapped-callsite-pending |
| widget-entrypoint | src/renderer/widget/WidgetApp.tsx | mapped-callsite |
| hud-entrypoint | src/renderer/hud/main.ts | mapped-callsite |
| dialog-picker-root | src/renderer/bridge/dialog-picker.tsx | mapped-callsite |
| ws-reconnect-overlay | src/renderer/bridge/ws-bridge.ts | mapped-callsite |
| browser-bridge-stubs | src/renderer/bridge/stubs.ts | mapped-callsite |

## Documentation site data refresh

The site stylesheet was not changed by this audit. The stale packaging article was corrected to describe the current push-triggered release workflow and current Squirrel artifact language. The page remains in its existing Kids-mode visual style. No desktop styling rule is copied into the site.

## Vocabulary entrypoint reconciliation

The personal-vocabulary inventory now has independent canonical producer and surface manifests in
`scripts/check-personal-vocabulary-coverage.mjs`. The manifests are separate from mutable evidence
rows, and the executable check mutates copied real files and copied inventory arrays to prove that
removing a mapper, producer row, surface row, or audit row is rejected. The host-entrypoint lane
covers the detached widget, HUD, browser picker, reconnect overlay, bridge stubs, notification
body classification, native notification producers, converter upload limit messages, and
landing-page JSON/cache validators. The site renderer also has an independent per-string ownership
manifest with file-backed removal mutations. Runtime facts such as paths, IDs, model names,
provider errors, visible commands, brand names, license text, and shortcut text remain outside the
authored-copy mapper. Canvas notifications classify every direct body as authored or fact, and the
landing-page file reader keeps rejected reads visible instead of treating them as successful input.
The per-string checker parses the arguments of each copy call, while the delegated file-change
tests exercise size rejection, read failure, picker reset, valid binding, and the resulting render.

## Verification

- node scripts/check-material-audit.mjs is the source-level inventory check. It validates the exact 212 rows, implementation markers, exact style owners, shared barrel exports, legacy remediation, site-preservation wording, and in-memory deletion mutations for rows, source markers, styles, localized strings, documentation rows, and mapper calls.
- No broad test suite, build, runtime launch, or screenshot was run in this lane. Those are intentionally unverified here.

## Remaining conflicts

- The Comments & Activity panel in `src/renderer/components/kanban/CardModal.tsx` is inventoried as `destination-comments-activity` but is not edited in this lane because the p80 lane owns that file.
- The existing-worktree picker in `src/renderer/components/WorktreeDialog.tsx` is inventoried as `overlay-existing-worktree-picker` but is not edited further in this lane because the p81 lane owns that picker surface.
- The WSL creator clipping state is inventoried as `overlay-wsl-create-clipping` from the supplied evidence, but `src/renderer/wsl/WslCreateDialog.tsx` is reserved for the p79 lane. The observed layout defect is recorded as nonconforming and overlapping, with no source edit made here.
- Runtime clipping, display-scale behavior, and built-artifact Material rendering remain unverified until the permitted capture lane runs against this exact source commit.

## Suggested articles

- [Material Design 3 migration status](./material-3-migration-status.md)
- [Shared Material Design 3 primitives](../../md3-primitives.md)
- [Built-artifact render verification](../../md3-render-verification.md)
- [Appearance customization](../appearance.md)
