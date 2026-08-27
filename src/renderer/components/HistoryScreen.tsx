// The History screen: session memory · local settings history · changelog, as three tabs of one
// surface — see design/v2/MD3 History.dc.html and docs/changelog-viewer.md.
//
// This component is a self-contained, droppable-in screen; it is not yet wired into a rail/screen
// switcher (`NavRail.tsx` and the rail's Canvas/Board/Files/Tools/History/Alerts/Settings
// destination switching are a separate, not-yet-built piece — see design/v2/HANDOFF-README.md's
// "Implementation order"). Whoever wires the rail mounts this exactly like the other screens,
// passing through the two SessionMemoryPanel callbacks it needs (the same ones the RAM pill's
// popover already requires — see SessionMemoryPanel.tsx).
//
// The session-memory and settings-history tabs are the SAME components used elsewhere
// (SessionMemoryPanel opens today from the bottom-left RAM pill; LocalHistoryPanel opens today
// from Settings → History) — restyled in place so they render consistently whichever surface
// mounts them, not duplicated. Embedding SessionMemoryPanel here (rather than only in its popover)
// needs no prop changes: its floating position is scoped to `.sysres-indicator .sessmem-panel` in
// CSS, so inside `.md3-history-screen` it lays out as a normal in-flow panel instead — see
// styles.md3.css.

import { useState } from 'react'
import { SessionMemoryPanel } from './SessionMemoryPanel'
import { LocalHistoryPanel } from './LocalHistoryPanel'
import { ChangelogPanel } from './changelog/ChangelogPanel'
import { Tabs } from '@renderer/ui/md3'

export interface HistoryScreenProps {
  /** Same contract as SessionMemoryPanel's own prop — travel to the node behind a session-memory
   *  row (reopening a closed project's tab first, if needed). */
  onGoToNode: (nodeId: string) => void
  /** Same contract as SessionMemoryPanel's own prop — confirm + end a session. */
  onKillSession: (nodeId: string, orphan: boolean) => void
}

type HistoryTab = 'memory' | 'settings' | 'changelog'

const TABS: { id: HistoryTab; label: string }[] = [
  { id: 'memory', label: 'Session memory' },
  { id: 'settings', label: 'Settings history' },
  { id: 'changelog', label: 'Changelog' }
]

export function HistoryScreen({ onGoToNode, onKillSession }: HistoryScreenProps): JSX.Element {
  const [tab, setTab] = useState<HistoryTab>('memory')

  return (
    <div className="md3-history-screen" data-screen-label="History">
      <div className="md3-history-screen__head">
        <div className="md3-history-screen__heading">
          <div className="md3-history-screen__title">History</div>
          <div className="md3-history-screen__subtitle">
            Session memory · local settings history · changelog
          </div>
        </div>
        <Tabs
          items={TABS}
          value={tab}
          onChange={(id) => setTab(id as HistoryTab)}
          ariaLabel="History sections"
          className="md3-history-screen__tabs"
          tabClassName="md3-history-screen__tab"
          activeTabClassName="md3-history-screen__tab--active"
          idPrefix="history-tab"
          panelIdPrefix="history-tabpanel"
        />
      </div>

      <div className="md3-history-screen__body">
        <div
          role="tabpanel"
          id="history-tabpanel-memory"
          aria-labelledby="history-tab-memory"
          hidden={tab !== 'memory'}
          className="md3-history-screen__panel"
        >
          {/* SessionMemoryPanel's own `onClose` fires only after a successful "go to node" click —
              there is no popover to dismiss in this full-page context, so it is intentionally a
              no-op here. */}
          <SessionMemoryPanel onGoToNode={onGoToNode} onKillSession={onKillSession} onClose={() => {}} />
        </div>
        <div
          role="tabpanel"
          id="history-tabpanel-settings"
          aria-labelledby="history-tab-settings"
          hidden={tab !== 'settings'}
          className="md3-history-screen__panel"
        >
          <LocalHistoryPanel domain="settings" title="Settings" />
        </div>
        <div
          role="tabpanel"
          id="history-tabpanel-changelog"
          aria-labelledby="history-tab-changelog"
          hidden={tab !== 'changelog'}
          className="md3-history-screen__panel"
        >
          <ChangelogPanel />
        </div>
      </div>
    </div>
  )
}
