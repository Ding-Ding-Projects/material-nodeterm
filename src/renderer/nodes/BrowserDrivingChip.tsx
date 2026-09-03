import { useProjects } from '../state/projects'
import { useDrivingLease } from '../state/browserLease'
import { Button } from '@renderer/ui/md3'
import { copy, fact, mapOwnedSentence } from '../lib/personalVocabulary/ownedCopy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

/**
 * The "…is driving" chip (S8 PR 6 of #112, @Corvin): shown on a browser node header (and in the
 * kanban card modal) the whole time an agent holds a control lease on it — plus a short linger so a
 * burst of fast verbs reads as one continuous state. It carries the one obvious Stop.
 *
 * Decision 4: this is ALWAYS ON. There is deliberately no setting that hides it and none to add — a
 * user cannot be driving-blind by preference. It is not gated on `agentBrowserControl` either: that
 * switch decides whether an agent MAY drive; once one IS driving, the badge is unconditional.
 */

/** Presentational only — no store, so it renders in isolation under test. `ownerTitle` is the
 *  VERIFIED owner node's title (resolved from the ledger's `ownerNodeId`, never a caller label). */
export function BrowserDrivingChip({
  ownerTitle,
  onStop
}: {
  ownerTitle: string
  onStop: () => void
}): React.JSX.Element {
  const map = useVocabularyMapper()
  const label = mapOwnedSentence(map, [fact(ownerTitle), copy(' is driving')])
  const stopLabel = map('Stop')
  const stopTitle = map('Stop agent control of this browser node')
  return (
    <span className="term-node__status term-node__status--driven nodrag" role="status">
      <span className="term-node__status-dot" />
      <span className="browser-driving__label">{label}</span>
      <Button
        variant="tonal"
        size="small"
        danger
        className="browser-driving__stop"
        vocabularyMode="factual"
        title={stopTitle}
        onClick={(e) => {
          e.stopPropagation()
          onStop()
        }}
      >
        {stopLabel}
      </Button>
    </span>
  )
}

/**
 * The node/modal container: reads the live lease for `nodeId`, resolves the owner's title, and wires
 * Stop to main (which detaches the debugger + drops the ledger entry — a real revocation, never a
 * hide). Renders nothing when the node is not being driven.
 */
export function BrowserDrivingIndicator({ nodeId }: { nodeId: string }): React.JSX.Element | null {
  const lease = useDrivingLease(nodeId)
  const ownerTitle = useProjects((s) => {
    if (!lease) return ''
    for (const p of s.projects) {
      const owner = p.nodes.find((n) => n.id === lease.ownerNodeId)
      if (owner) return owner.title || lease.ownerNodeId
    }
    // The owner is gone from every canvas (closed/restarted) but the lease has not yet been
    // revoked: name it by id rather than blanking the chip.
    return lease.ownerNodeId
  })
  if (!lease) return null
  return (
    <BrowserDrivingChip ownerTitle={ownerTitle} onStop={() => window.nodeTerminal.browser.stop(nodeId)} />
  )
}
