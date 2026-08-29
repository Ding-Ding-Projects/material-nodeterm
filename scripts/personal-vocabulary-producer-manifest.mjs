// Canonical, hand-written inventory of user-facing personal-vocabulary producers.
// Discovery in the checker is only a cross-check. It never defines this list.

export const PERSONAL_VOCABULARY_DOCS = {
  coverage: 'docs/personal-vocabulary.md',
  audit: 'docs/features/appearance/material-3-audit.md',
  tools: 'docs/features/appearance/personal-vocabulary-tools.md',
  universal: 'docs/uh-feature-inventory.md'
}

export const PERSONAL_VOCABULARY_POLICIES = [
  {
    id: 'react-local',
    markers: [
      ['src/renderer/lib/personalVocabulary/useVocabularyText.ts', 'schoolModeAllowsOptionalFeatures({'],
      ['src/renderer/lib/personalVocabulary/useVocabularyText.ts', 'hydrated: schoolModeHydrated'],
      ['src/renderer/lib/personalVocabulary/useVocabularyText.ts', 'enabled: schoolModeEnabled'],
      ['src/renderer/state/personalVocabulary.ts', 'hydrate: () => {'],
      ['src/renderer/state/personalVocabulary.ts', 'validateVocabularyCachePayload(raw)'],
      ['src/renderer/state/personalVocabulary.ts', "localStorage.getItem(CACHE_KEY)"],
      ['src/renderer/lib/personalVocabulary/ownedCopy.ts', "segment.kind === 'copy' ? map(segment.text) : segment.text"]
    ]
  },
  {
    id: 'host-local',
    markers: [
      ['src/renderer/lib/personalVocabulary/hostMessage.ts', 'setHostVocabularySchoolState'],
      ['src/renderer/lib/personalVocabulary/hostMessage.ts', 'if (!school.hydrated || school.enabled) return text'],
      ['src/renderer/lib/personalVocabulary/hostMessage.ts', 'validateVocabularyCachePayload(raw)'],
      ['src/renderer/lib/personalVocabulary/hostMessage.ts', 'applyVocabulary(text, readLocalVocabularyEntries())']
    ]
  },
  {
    id: 'site-local',
    markers: [
      ['site/app/main.js', "import { handleVocabularyFileChange } from './features/vocabulary.js'"],
      ['site/app/features/vocabulary.js', 'validateVocabularyJson('],
      ['site/app/shared/vocabulary-state.js', 'validateVocabularyCacheJson('],
      ['site/app/core/store.js', 'isFreshVocabularyCache']
    ]
  },
  {
    id: 'native-notification',
    markers: [
      ['src/renderer/lib/personalVocabulary/hostMessage.ts', 'mapNativeNotification'],
      ['src/preload/index.ts', 'ipcRenderer.invoke(IPC.appNotify, payload)'],
      ['src/main/index.ts', 'prepareNativeNotification(payload)'],
      ['src/main/notifications.ts', 'composeNativeNotification']
    ]
  }
]

export const PERSONAL_VOCABULARY_FOCUSED_TESTS = [
  ['apply', 'src/renderer/lib/personalVocabulary/apply.test.ts', "describe('applyVocabulary'"],
  ['schema', 'src/renderer/lib/personalVocabulary/schema.test.ts', "describe('personal vocabulary schema'"],
  ['cache-state', 'src/renderer/state/personalVocabulary.test.ts', "describe('personal vocabulary state'"],
  ['host-message', 'src/renderer/lib/personalVocabulary/hostMessage.test.ts', "describe('hostMessage'"],
  ['owned-copy', 'src/renderer/lib/personalVocabulary/ownedCopy.test.ts', "describe('owned copy'"],
  ['surfaces', 'src/renderer/lib/personalVocabulary/surfaces.test.ts', "describe('personal vocabulary surfaces'"],
  ['production-consumers', 'src/renderer/lib/personalVocabulary/productionConsumers.test.ts', "describe('production vocabulary consumers'"],
  ['node-boundaries', 'src/renderer/nodes/node-vocabulary.test.tsx', "describe('node renderer personal vocabulary boundaries'"],
  ['command-palette', 'src/renderer/components/CommandPalette.vocabulary.test.tsx', 'describe('],
  ['notification-toasts', 'src/renderer/components/NotificationToasts.vocabulary.test.tsx', 'describe('],
  ['session-row', 'src/renderer/components/SessionRow.vocabulary.test.tsx', 'describe('],
  ['settings-field', 'src/renderer/components/settings/FieldRow.vocabulary.test.tsx', 'describe('],
  ['settings-search', 'src/renderer/components/settings/vocabulary.test.tsx', 'describe('],
  ['shared-controls', 'src/renderer/ui/personalVocabulary.test.tsx', 'describe('],
  ['native-notification', 'src/main/notifications.test.ts', "describe('composeNativeNotification'"],
  ['site-state', 'site/app/shared/vocabulary-state.test.js', 'describe(']
]

function surface(id, family, file, registrationKey, reachability, classification, consumptionMarkers, factMarkers, factReason, policy, implementation = 'covered', openReason = '') {
  return { id, family, file, registrationKey, reachability, classification, consumptionMarkers, factMarkers, factReason, policy, implementation, openReason, docsRow: id, focusedTests: family === 'canvas-node' ? ['node-boundaries'] : family === 'native-notification' ? ['host-message', 'native-notification'] : family === 'site-entrypoint' ? ['site-state'] : ['production-consumers'] }
}

const node = (key, component, file, classification = 'mixed', markers = ['useVocabularyMapper()'], facts = ['data.title'], reason = 'Node title and runtime values remain exact.', implementation = 'covered', openReason = '') =>
  surface(`canvas-node-${key}`, 'canvas-node', file, key, [['src/renderer/canvas/Canvas.tsx', `${JSON.stringify(key)}: withNodeBoundary(${component})`, `'${key}': withNodeBoundary(${component})`, `${key}: withNodeBoundary(${component})`]], classification, markers, ['id', ...facts], reason, 'react-local', implementation, openReason)

export const PERSONAL_VOCABULARY_PRODUCERS = [
  node('terminal', 'TerminalNode', 'src/renderer/nodes/TerminalNode.tsx', 'mixed', ['useVocabularyMapper()', 'useLocalizedVocabularyText()']),
  node('sticky', 'StickyNode', 'src/renderer/nodes/StickyNode.tsx'),
  node('group', 'GroupNode', 'src/renderer/nodes/GroupNode.tsx'),
  node('annotation', 'AnnotationNode', 'src/renderer/nodes/AnnotationNode.tsx'),
  node('authenticator', 'AuthenticatorNode', 'src/renderer/nodes/AuthenticatorNode.tsx'),
  node('calendar', 'CalendarNode', 'src/renderer/nodes/CalendarNode.tsx', 'mixed', ['useVocabularyMapper()'], ['event.title', 'account.displayName'], 'Calendar, account, provider, event, and timezone facts remain exact.', 'open', 'The live calendar node still emits authored JSX without a mapper boundary.'),
  node('homeassistant-control', 'HomeAssistantControlNode', 'src/renderer/nodes/HomeAssistantControlNode.tsx', 'mixed', ['useLocalizedVocabularyText()'], ['result.message', 'reason'], 'Home Assistant responses remain exact.', 'open', 'Notification ownership fields are still absent on direct producers.'),
  node('homeassistant-sensor', 'HomeAssistantSensorNode', 'src/renderer/nodes/HomeAssistantSensorNode.tsx', 'mixed', ['useVocabularyMapper()'], ['title', 'body'], 'Sensor names, values, and provider messages remain exact.', 'open', 'The live sensor node has no mapper or notification ownership boundary.'),
  node('editor', 'LazyEditorNode', 'src/renderer/nodes/EditorNode.tsx'),
  node('diff', 'LazyDiffNode', 'src/renderer/nodes/DiffNode.tsx'),
  node('subagent', 'SubagentNode', 'src/renderer/nodes/SubagentNode.tsx'),
  node('loop', 'LoopNode', 'src/renderer/nodes/LoopNode.tsx'),
  node('xproject', 'XProjectNode', 'src/renderer/nodes/XProjectNode.tsx', 'mixed', ['useVocabularyMapper()'], ['data.title'], 'Project names and paths remain exact.', 'open', 'The cross-project node still renders authored copy directly.'),
  node('scheduler', 'NativeLoopNode', 'src/renderer/nodes/NativeLoopNode.tsx'),
  node('timer', 'TimerNode', 'src/renderer/nodes/TimerNode.tsx', 'mixed', ['useVocabularyMapper()'], ['current.title'], 'Timer titles, durations, and tones remain exact.', 'open', 'The timer has no mapper and omits notification ownership fields.'),
  node('alarm', 'AlarmClockNode', 'src/renderer/nodes/AlarmClockNode.tsx', 'mixed', ['useVocabularyMapper()'], ['data.title', 'timeZone'], 'Alarm titles, times, and timezone values remain exact.', 'open', 'The alarm node emits direct authored copy and unclassified notifications.'),
  node('dino', 'DinoNode', 'src/renderer/nodes/DinoNode.tsx'),
  node('recovery-game', 'RecoveryGameNode', 'src/renderer/nodes/RecoveryGameNode.tsx'),
  node('photo', 'PhotoNode', 'src/renderer/nodes/PhotoNode.tsx', 'mixed', ['useVocabularyMapper()'], ['data.title'], 'Image metadata and source facts remain exact.', 'open', 'The photo node still renders authored copy directly.'),
  node('gallery', 'GalleryNode', 'src/renderer/nodes/GalleryNode.tsx', 'mixed', ['useVocabularyMapper()'], ['asset.sourcePath'], 'Asset names, paths, hashes, and MIME values remain exact.', 'open', 'The gallery node still renders authored copy directly.'),
  node('wild-dim-sum', 'WildDimSumNode', 'src/renderer/nodes/WildDimSumNode.tsx', 'mixed', ['useLocalizedVocabularyText()'], ['dish.name']),
  node('video', 'VideoNode', 'src/renderer/nodes/VideoNode.tsx'),
  node('web', 'WebNode', 'src/renderer/nodes/WebNode.tsx'),
  node('browser', 'BrowserNode', 'src/renderer/nodes/BrowserNode.tsx'),
  node('files', 'FilesNode', 'src/renderer/nodes/FilesNode.tsx', 'mixed', ['useVocabularyMapper()'], ['cwd', 'entry.name'], 'Paths, filenames, and filesystem errors remain exact.', 'open', 'The file node and its menu still bypass the vocabulary boundary.'),
  node('nsis', 'NsisInstallerNode', 'src/renderer/nodes/NsisInstallerNode.tsx'),
  node('shop', 'ShopNode', 'src/renderer/nodes/ShopNode.tsx', 'mixed', ['useLocalizedVocabularyText()']),
  node('aws-universe', 'AwsUniversePortalNode', 'src/renderer/nodes/AwsUniversePortalNode.tsx', 'mixed', ['useLocalizedVocabularyText()']),
  node('unigetui', 'UniGetUiUniverseNode', 'src/renderer/nodes/UniGetUiUniverseNode.tsx'),
  node('torrent', 'TorrentNode', 'src/renderer/nodes/TorrentNode.tsx', 'mixed', ['useVocabularyMapper()'], ['torrent.name', 'torrent.infoHash'], 'Torrent names, hashes, paths, and peer facts remain exact.', 'open', 'The torrent node still emits authored copy without a mapper.'),
  ...['minecraft', 'dockerhost', 'proxmox', 'gitlab', 'homeassistant', 'freepbx', 'cloudflare-tunnel', 'awsidentity', 'cloudflare-zero-trust', 'nextcloud-aio', 'nextcloud-managed'].map((key) => node(key, 'ServiceNode', 'src/renderer/nodes/ServiceNode.tsx')),
  node('open-webui-hosting', 'OpenWebUiHostingNode', 'src/renderer/nodes/OpenWebUiHostingNode.tsx'),
  node('linux-vm', 'VirtualMachineNode', 'src/renderer/nodes/VirtualMachineNode.tsx', 'mixed', ['useVocabularyMapper()'], ['data.title'], 'Machine names, paths, resources, and host results remain exact.', 'open', 'The virtual-machine node still renders authored copy directly.'),
  node('windows-diagnostics', 'WindowsDiagnosticsNode', 'src/renderer/nodes/WindowsDiagnosticsNode.tsx'),
  node('veracrypt', 'VeraCryptNode', 'src/renderer/nodes/VeraCryptNode.tsx'),
  node('repository-graph', 'RepositoryGraphNode', 'src/renderer/nodes/RepositoryGraphNode.tsx'),
  node('gitlab-hosting', 'GitLabHostingNode', 'src/renderer/nodes/GitLabHostingNode.tsx'),
  node('cloudflare-core-managers', 'CloudflareCoreManagersNode', 'src/renderer/nodes/CloudflareCoreManagersNode.tsx'),
  node('aws-resource', 'AwsResourceNode', 'src/renderer/nodes/AwsResourceNode.tsx'),
  node('github-work-item', 'GitHubWorkItemNode', 'src/renderer/nodes/GitHubWorkItemNode.tsx', 'mixed', ['useVocabularyMapper()'], ['item.title', 'item.url'], 'Forge records, URLs, labels, and provider text remain exact.', 'open', 'The work-item node and detail dialogs still render authored copy directly.'),

  ...[
    ['SettingsPage', './settings/SettingsPage', 'src/renderer/components/settings/SettingsPage.tsx', 'useLocalizedVocabularyText()', 'covered'],
    ['SourceControlPanel', './SourceControlPanel', 'src/renderer/components/SourceControlPanel.tsx', 'useVocabularyMapper()', 'open'],
    ['ExplorerPanel', './ExplorerPanel', 'src/renderer/components/ExplorerPanel.tsx', 'useVocabularyMapper()', 'covered'],
    ['ShortcutsPanel', './ShortcutsPanel', 'src/renderer/components/ShortcutsPanel.tsx', 'useVocabularyMapper()', 'open'],
    ['OnboardingFlow', './onboarding/OnboardingFlow', 'src/renderer/components/onboarding/OnboardingFlow.tsx', 'useVocabularyMapper()', 'covered'],
    ['DictationOverlay', './DictationOverlay', 'src/renderer/components/DictationOverlay.tsx', 'useVocabularyMapper()', 'covered'],
    ['BugReportDialog', './BugReportDialog', 'src/renderer/components/BugReportDialog.tsx', 'useVocabularyMapper()', 'open'],
    ['PhonePairPopover', './PhonePairPopover', 'src/renderer/components/PhonePairPopover.tsx', 'useVocabularyMapper()', 'covered'],
    ['LogPanel', './LogPanel', 'src/renderer/components/LogPanel.tsx', 'useVocabularyMapper()', 'open'],
    ['KanbanView', './kanban/KanbanView', 'src/renderer/components/kanban/KanbanView.tsx', 'useLocalizedVocabularyText()', 'covered'],
    ['FileConverterPanel', './converter/FileConverterPanel', 'src/renderer/components/converter/FileConverterPanel.tsx', 'useVocabularyMapper()', 'covered'],
    ['OllamaManagerPanel', './ollama/OllamaManagerPanel', 'src/renderer/components/ollama/OllamaManagerPanel.tsx', 'useVocabularyMapper()', 'covered'],
    ['UniGetUiUniversePanel', './unigetui/UniGetUiUniversePanel', 'src/renderer/components/unigetui/UniGetUiUniversePanel.tsx', 'useVocabularyMapper()', 'covered'],
    ['PasswordManagerPanel', './passwordManager/PasswordManagerPanel', 'src/renderer/components/passwordManager/PasswordManagerPanel.tsx', 'useVocabularyMapper()', 'covered']
  ].map(([name, module, file, marker, implementation]) => surface(`lazy-panel-${name}`, 'lazy-panel', file, name, [['src/renderer/components/lazyPanels.tsx', `export const ${name} = withSuspense(`], ['src/renderer/components/lazyPanels.tsx', `import('${module}')`]], 'mixed', [marker], [name, 'id', 'path', 'error', 'status'], 'Dynamic values and provider records remain exact.', 'react-local', implementation, implementation === 'open' ? 'The lazy panel still has authored copy outside a mapper boundary.' : '')),

  ...[
    ['Canvas', 'src/renderer/canvas/Canvas.tsx', 'useVocabularyMapper()', 'covered'],
    ['KidsShell', 'src/renderer/components/kids/KidsShell.tsx', 'useVocabularyMapper()', 'open'],
    ['PromptDialogHost', 'src/renderer/components/promptDialog.tsx', '<InputDialog', 'covered'],
    ['NodeIconDialogHost', 'src/renderer/components/NodeIconPicker.tsx', 'useVocabularyMapper()', 'open'],
    ['ArchiveUnlockDialogHost', 'src/renderer/components/archiveUnlockDialog.tsx', 'useVocabularyMapper()', 'open'],
    ['DestructiveGateHost', 'src/renderer/components/DestructiveGateHost.tsx', '<DestructiveConfirmGate', 'covered'],
    ['NotificationToasts', 'src/renderer/components/NotificationToasts.tsx', 'useVocabularyMapper()', 'covered'],
    ['AppearanceStyleInjector', 'src/renderer/components/appearance/AppearanceStyleInjector.tsx', 'export function AppearanceStyleInjector', 'covered'],
    ['AppearanceEditorHost', 'src/renderer/components/appearance/AppearanceEditor.tsx', 'useVocabularyMapper()', 'covered'],
    ['EnableKidsModeDialogHost', 'src/renderer/components/kids/EnableKidsModeDialog.tsx', 'useVocabularyMapper()', 'open'],
    ['RemoteOAuthCallbackNotice', 'src/renderer/components/RemoteOAuthCallbackNotice.tsx', 'useVocabularyMapper()', 'open'],
    ['EasterEggs', 'src/renderer/components/EasterEggs.tsx', 'useVocabularyMapper()', 'covered'],
    ['DimSumSurprise', 'src/renderer/components/DimSumSurprise.tsx', 'useVocabularyMapper()', 'covered']
  ].map(([name, file, marker, implementation]) => surface(`root-${name}`, 'root-host', file, name, [['src/renderer/App.tsx', `<${name}`]], name === 'AppearanceStyleInjector' ? 'no-prose' : 'mixed', [marker], name === 'AppearanceStyleInjector' ? [] : [name, 'request', 'error', 'title'], name === 'AppearanceStyleInjector' ? 'This component emits only a stylesheet.' : 'Host requests and runtime details remain exact.', 'react-local', implementation, implementation === 'open' ? 'The root surface still renders authored copy directly.' : '')),
  surface('root-SessionProvider', 'root-host', 'src/renderer/App.tsx', 'SessionProvider', [['src/renderer/App.tsx', '<SessionProvider']], 'no-prose', ['session={localSession}'], [], 'The provider supplies context and renders no prose.', 'react-local'),
  surface('root-ReactFlowProvider', 'root-host', 'src/renderer/App.tsx', 'ReactFlowProvider', [['src/renderer/App.tsx', '<ReactFlowProvider>']], 'no-prose', ['<ReactFlowProvider>'], [], 'The provider supplies canvas context and renders no prose.', 'react-local'),

  surface('entry-widget', 'widget-entrypoint', 'src/renderer/widget/WidgetApp.tsx', 'WidgetApp', [['src/renderer/main.tsx', "import('./widget/WidgetApp')"]], 'mixed', ['useVocabularyMapper()'], ['nodeId'], 'Node identifiers and terminal facts remain exact.', 'react-local'),
  surface('entry-hud', 'hud-entrypoint', 'src/renderer/hud/main.ts', 'hud/main.ts', [['src/renderer/hud.html', 'src="./hud/main.ts"']], 'mixed', ['mapLocalVocabularyText('], ['row.'], 'Agent and session facts remain exact.', 'host-local'),
  surface('entry-dialog-picker', 'bridge-entrypoint', 'src/renderer/bridge/dialog-picker.tsx', 'dialog-picker', [['src/renderer/bridge/dialog-picker.tsx', 'pickerRoot = createRoot(container)']], 'mixed', ['useVocabularyMapper()'], ['path'], 'Selected paths remain exact.', 'react-local'),
  surface('entry-ws-reconnect', 'bridge-entrypoint', 'src/renderer/bridge/ws-bridge.ts', 'ws-reconnect', [['src/renderer/main.tsx', "import('./bridge/ws-bridge')"]], 'mixed', ['mapLocalVocabularyText('], ['url'], 'Connection addresses and errors remain exact.', 'host-local'),
  surface('entry-browser-stubs', 'bridge-entrypoint', 'src/renderer/bridge/stubs.ts', 'browser-stubs', [['src/renderer/bridge/stubs.ts', 'export function unsupported']], 'mixed', ['formatHostMessage('], ['hostFact('], 'Provider and host values remain exact.', 'host-local'),
  surface('entry-site-main', 'site-entrypoint', 'site/app/main.js', 'site-main', [['site/index.html', 'src="./app/main.js"']], 'mixed', ['handleVocabularyFileChange'], ['store.state'], 'Visitor data and document facts remain exact.', 'site-local'),
  surface('entry-site-vocabulary', 'site-entrypoint', 'site/app/features/vocabulary.js', 'site-vocabulary', [['site/app/main.js', "from './features/vocabulary.js'"]], 'authored', ['validateVocabularyJson('], [], 'Only validated local entries are applied.', 'site-local'),
  surface('entry-site-cache', 'site-entrypoint', 'site/app/shared/vocabulary-state.js', 'site-cache', [['site/app/main.js', "from './shared/vocabulary-state.js'"]], 'no-prose', ['validateVocabularyCacheJson('], [], 'This module validates local state and renders no prose.', 'site-local'),

  surface('native-notification-renderer', 'native-notification', 'src/renderer/lib/personalVocabulary/hostMessage.ts', 'mapNativeNotification', [['src/renderer/lib/personalVocabulary/hostMessage.ts', 'export function mapNativeNotification']], 'mixed', ['titleKind', 'bodyKind'], ['payload.title', 'payload.body'], 'Only authored fields are mapped; fact fields remain byte-identical.', 'native-notification'),
  surface('native-notification-ipc', 'native-notification', 'src/preload/index.ts', 'appNotify', [['src/shared/ipc.ts', "appNotify: 'app:notify'"], ['src/preload/index.ts', 'ipcRenderer.invoke(IPC.appNotify, payload)']], 'factual-only', ['IPC.appNotify'], ['payload'], 'The typed IPC carries the already-rendered payload and control metadata only.', 'native-notification'),
  surface('native-notification-main', 'native-notification', 'src/main/notifications.ts', 'prepareNativeNotification', [['src/main/index.ts', 'prepareNativeNotification(payload)']], 'factual-only', ['isPreparedNativeNotification'], ['payload.title', 'payload.body'], 'The main process validates ownership and never reads vocabulary state.', 'native-notification')
]
