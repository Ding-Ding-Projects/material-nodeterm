// site/app/features/exports.js
//
// Three registered tabs: Notifications, Local history, and Export your
// data. Notifications and history are real lists with the full bulk-action
// contract (multi-select, honestly-scoped select-all, inverse selection, a
// reviewable preview before anything destructive). The export panel offers
// every format that can faithfully carry the data (shared/exportFormats.js)
// and discloses what a lossy format will drop BEFORE the download runs —
// never after.

import { h, injectStyleOnce } from '../shared/dom.js'
import { asMountable } from '../shared/mountable.js'
import { t, subscribeI18n, getLanguageMode, getFunnyLevel, getEmojiEnabled } from '../shared/i18n.js'
import { createBulkList } from '../shared/bulkList.js'
import { EXPORT_FORMATS, downloadFile } from '../shared/exportFormats.js'
import { listNotifications, removeNotifications, clearNotifications, subscribeNotifications } from '../shared/notifications-state.js'
import { listHistory, removeHistoryEntries, clearHistory, subscribeHistory } from '../shared/history-state.js'
import { isEnabled as isSchoolModeEnabled, getDisplayName as schoolDisplayName } from '../shared/school-state.js'
import { isEnabled as narratorEnabled, getLanguage as narratorLang, getVoiceUri, getRate, getPitch } from '../shared/narrator-state.js'
import { hasVocabulary, getFileName as vocabFileName, getEntries as vocabEntries } from '../shared/vocabulary-state.js'
import { listLocks } from '../shared/locks-state.js'

injectStyleOnce(
  'site-exports-style',
  `
  .site-export-section { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
  .site-export-formats { display: flex; flex-wrap: wrap; gap: 8px; }
  .site-export-formats button {
    min-height: var(--touch-target, 44px); padding: 0 12px; border-radius: var(--md-shape-full, 999px);
    border: 1px solid var(--md-outline, #79767e); background: var(--md-surface-container, #efeaf2);
    color: var(--md-on-surface, #1c1b1f); cursor: pointer; font: inherit;
  }
  .site-export-lossnote {
    font-size: 12px; border: 1px dashed var(--md-outline, #79767e); border-radius: var(--md-shape-sm, 8px);
    padding: 8px; display: flex; flex-direction: column; gap: 6px;
  }
  `,
)

function collectSettingsRecords() {
  return [
    { key: 'language.mode', value: getLanguageMode() },
    { key: 'language.funnyLevel.english', value: getFunnyLevel('en') },
    { key: 'language.funnyLevel.cantonese', value: getFunnyLevel('yue') },
    { key: 'language.showEmojiInDialogs', value: getEmojiEnabled() },
    { key: 'schoolMode.enabled', value: isSchoolModeEnabled() },
    { key: 'schoolMode.displayName', value: schoolDisplayName() },
    { key: 'narrator.enabled', value: narratorEnabled() },
    { key: 'narrator.language', value: narratorLang() },
    { key: 'narrator.voiceUri.english', value: getVoiceUri('en') || 'auto' },
    { key: 'narrator.voiceUri.cantonese', value: getVoiceUri('yue') || 'auto' },
    { key: 'narrator.rate', value: getRate() },
    { key: 'narrator.pitch', value: getPitch() },
    { key: 'vocabulary.loaded', value: hasVocabulary() },
    { key: 'vocabulary.fileName', value: hasVocabulary() ? vocabFileName() : '' },
    { key: 'vocabulary.entryCount', value: hasVocabulary() ? Object.keys(vocabEntries()).length : 0 },
    { key: 'toyLocks.count', value: listLocks().length },
  ]
}

function buildExportSection(title, getRecords, filenameBase) {
  const wrap = h('div', { class: 'site-export-section' })
  wrap.appendChild(h('h4', {}, title))
  const lossArea = h('div', {})
  const btnRow = h(
    'div',
    { class: 'site-export-formats' },
    EXPORT_FORMATS.map((fmt) =>
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            lossArea.textContent = ''
            const records = getRecords()
            if (fmt.lossy) {
              lossArea.appendChild(
                h('div', { class: 'site-export-lossnote' }, [
                  h('span', {}, `⚠️ ${fmt.label} will lose: ${fmt.lossNote}`),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => {
                        downloadFile(`${filenameBase}.${fmt.ext}`, fmt.encode(records), fmt.mime)
                        lossArea.textContent = ''
                      },
                    },
                    'Download anyway',
                  ),
                ]),
              )
            } else {
              downloadFile(`${filenameBase}.${fmt.ext}`, fmt.encode(records), fmt.mime)
            }
          },
        },
        fmt.label,
      ),
    ),
  )
  wrap.appendChild(btnRow)
  wrap.appendChild(lossArea)
  return wrap
}

function buildExportsPanel() {
  const wrap = h('div', {})
  function rebuild() {
    wrap.textContent = ''
    wrap.appendChild(h('h3', {}, t('exports.section.title')))
    wrap.appendChild(h('p', {}, t('exports.help')))
    wrap.appendChild(buildExportSection('Settings', collectSettingsRecords, 'nodeterm-site-settings'))
    wrap.appendChild(buildExportSection('Notification history', listNotifications, 'nodeterm-site-notifications'))
    wrap.appendChild(buildExportSection('Local version history', listHistory, 'nodeterm-site-history'))
  }
  rebuild()
  subscribeI18n(rebuild)
  return wrap
}

function buildNotificationsPanel() {
  const wrap = h('div', {})
  function rebuild() {
    wrap.textContent = ''
    wrap.appendChild(h('h3', {}, 'Notifications'))
    wrap.appendChild(
      h('p', {}, 'Dismissed notifications stay reviewable here. Multi-select to remove several at once, or clear everything.'),
    )
    const list = createBulkList({
      getItems: () => listNotifications(),
      getId: (n) => n.id,
      getSearchText: (n) => n.title + ' ' + n.message,
      renderRow: (n) => h('span', {}, `[${n.kind}] ${n.title ? n.title + ' — ' : ''}${n.message} (${new Date(n.at).toLocaleString()})`),
      searchLabel: 'Search notifications',
      emptyLabel: t('common.none'),
      actions: [
        { id: 'remove', label: 'Remove selected', destructive: true, run: (ids) => { removeNotifications(ids); rebuild() } },
        { id: 'clear', label: 'Clear all', destructive: true, run: () => { clearNotifications(); rebuild() } },
      ],
    })
    wrap.appendChild(list.root)
  }
  rebuild()
  subscribeNotifications(rebuild)
  subscribeI18n(rebuild)
  return wrap
}

function buildHistoryPanel() {
  const wrap = h('div', {})
  function rebuild() {
    wrap.textContent = ''
    wrap.appendChild(h('h3', {}, 'Local version history'))
    wrap.appendChild(h('p', {}, 'Every meaningful settings change on this site, recorded locally, oldest changes pruned automatically.'))
    const list = createBulkList({
      getItems: () => listHistory(),
      getId: (n) => n.id,
      getSearchText: (n) => n.description,
      renderRow: (n) => h('span', {}, `${n.description} — ${new Date(n.at).toLocaleString()}`),
      searchLabel: 'Search local history',
      emptyLabel: t('common.none'),
      actions: [
        { id: 'remove', label: 'Remove selected', destructive: true, run: (ids) => { removeHistoryEntries(ids); rebuild() } },
        { id: 'clear', label: 'Clear all', destructive: true, run: () => { clearHistory(); rebuild() } },
      ],
    })
    wrap.appendChild(list.root)
  }
  rebuild()
  subscribeHistory(rebuild)
  subscribeI18n(rebuild)
  return wrap
}

export function registerExports(api) {
  if (typeof api.registerTab === 'function') {
    api.registerTab({ id: 'notifications', title: 'Notifications', icon: '🔔', group: 'app', render: asMountable(buildNotificationsPanel) })
    api.registerTab({ id: 'history', title: 'Local history', icon: '🕘', group: 'app', render: asMountable(buildHistoryPanel) })
    api.registerTab({ id: 'exports', title: 'Export your data', icon: '⬇️', group: 'settings', render: asMountable(buildExportsPanel) })
  }
  if (typeof api.registerSetting === 'function') {
    api.registerSetting({
      id: 'export-data',
      tabId: 'exports',
      title: 'Export settings, notifications, and history',
      describe: () => 'JSON, JSONL, YAML, TOML, XML, CSV, TSV, Markdown, or HTML.',
      control: asMountable(buildExportsPanel),
    })
  }
  if (typeof api.registerCommand === 'function') {
    api.registerCommand({ id: 'clear-notifications', title: 'Clear notification history', run: () => clearNotifications() })
    api.registerCommand({ id: 'clear-local-history', title: 'Clear local version history', run: () => clearHistory() })
  }
}
