import { useEffect, useState } from 'react'
import type { AgentContinuationPreview, AgentContinuationResult } from '@shared/agent-continuation'
import type { AgentContinuationApi } from '@shared/agent-continuation'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Button } from '@renderer/ui/md3'

interface AgentContinuationReviewProps {
  nodeId: string
  api?: AgentContinuationApi
  /** Cold relaunch decides when this card is relevant. Undefined keeps standalone compatibility. */
  enabled?: boolean
}
/**
 * An anchored, explicit review surface for a recovered Codex turn.
 *
 * The component only reads a bounded encrypted summary and never calls a terminal scrollback API.
 * In particular, mounting it cannot inject a prompt. Only the user's Continue button invokes the
 * provider action, and the core clears the packet only after it sees the next-turn receipt.
 */
export function AgentContinuationReview({ nodeId, api, enabled = true }: AgentContinuationReviewProps): JSX.Element | null {
  const vocab = useVocabularyMapper()
  const [packet, setPacket] = useState<AgentContinuationPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AgentContinuationResult | null>(null)

  useEffect(() => {
    if (!api || !enabled) return
    let live = true
    void api.preview(nodeId).then((value) => {
      if (live) setPacket(value)
    })
    const off = api.onUpdate((packets) => {
      if (!live) return
      setPacket(packets.find((candidate) => candidate.nodeId === nodeId) ?? null)
    })
    return () => {
      live = false
      off()
    }
  }, [api, nodeId, enabled])

  if (!api || !enabled || !packet) return null

  const runContinue = (): void => {
    if (busy) return
    setBusy(true)
    setResult(null)
    void api.continue(nodeId).then((next) => {
      setResult(next)
      setBusy(false)
    })
  }

  const runDiscard = (): void => {
    if (busy) return
    setBusy(true)
    void api.discard(nodeId).then(() => setBusy(false))
  }

  return (
    <aside
      className="agent-continuation-review md3-card"
      data-anchor-node-id={nodeId}
      aria-label={vocab('Recovered Codex turn review')}
    >
      <div className="agent-continuation-review__title">{vocab('Recovered Codex turn')}</div>
      <p className="agent-continuation-review__summary">{packet.summary}</p>
      <p className="agent-continuation-review__preview">{packet.preview}</p>
      <p className="agent-continuation-review__warning">{packet.warning}</p>
      <div className="agent-continuation-review__actions">
        <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={() => void api.ack(nodeId)}>
          {vocab('Mark reviewed')}
        </Button>
        <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={runContinue}>
          {busy ? vocab('Continuing') : vocab('Review and continue')}
        </Button>
        <Button variant="outlined" size="small" vocabularyMode="factual" disabled={busy} onClick={runDiscard}>
          {vocab('Discard recovered state')}
        </Button>
      </div>
      {result && !result.ok && (
        <p className="agent-continuation-review__result" role="status">
          {result.reason === 'provider-not-ready'
            ? vocab('The Codex provider has not reported a verified start yet. Nothing was sent.')
            : result.reason === 'delivery-failed'
              ? vocab('The continuation could not be delivered. The recovered state was retained.')
              : result.reason === 'receipt-timeout'
                ? vocab('No next-turn receipt arrived. The recovered state was retained.')
                : vocab('The recovered state is no longer available.')}
        </p>
      )}
    </aside>
  )
}
