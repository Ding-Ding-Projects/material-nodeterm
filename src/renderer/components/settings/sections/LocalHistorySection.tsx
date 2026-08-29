import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { LocalHistoryPanel } from '../../LocalHistoryPanel'

const ROWS = {
  history: {
    title: 'Settings history',
    keywords: ['history', 'undo', 'restore', 'version', 'revert', 'audit', 'log', 'changelog']
  },
  torrentHistory: {
    title: 'Torrent history',
    keywords: ['torrent', 'download', 'history', 'pause', 'resume', 'selection', 'seeding']
  }
}
const ENTRIES = Object.values(ROWS)

export function LocalHistorySection({ isActive }: { isActive: boolean }): React.JSX.Element {
  return (
    <SettingsSection
      id="history"
      title="History"
      description="Every settings save — including managed Claude accounts and custom agents — is snapshotted locally so any change can be undone. Restoring applies an old revision as a NEW save; it never rewrites history, so a restore can itself be restored away from later. Nothing here ever leaves this machine, and no credential material is ever stored in a snapshot."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.history}>
        <LocalHistoryPanel domain="settings" title="Settings" />
      </SearchableRow>
      <SearchableRow {...ROWS.torrentHistory}>
        <LocalHistoryPanel domain="torrent" title="Torrent" />
      </SearchableRow>
    </SettingsSection>
  )
}
