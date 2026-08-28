/**
 * Crash-recovery state for one provider session.
 *
 * This is deliberately smaller than a transcript. It carries only a bounded, redacted summary
 * and preview so a cold relaunch can offer an explicit review action without copying terminal
 * scrollback, tool output, credentials, or command arguments into application state.
 */

export type AgentContinuationProvider = 'codex'

export type AgentContinuationPhase =
  | 'provider-start'
  | 'turn-start'
  | 'progress'
  | 'turn-stop'
  | 'provider-end'

export interface AgentContinuationEvent {
  nodeId: string
  provider: AgentContinuationProvider
  sessionId: string
  phase: AgentContinuationPhase
  summary: string
  preview?: string
}

export interface AgentContinuationPacket {
  version: 1
  nodeId: string
  provider: AgentContinuationProvider
  sessionId: string
  summary: string
  preview: string
  warning: string
  createdAt: number
  updatedAt: number
  acknowledgedAt: number | null
}

export interface AgentContinuationPreview {
  nodeId: string
  provider: AgentContinuationProvider
  sessionId: string
  summary: string
  preview: string
  warning: string
  updatedAt: number
  acknowledged: boolean
}

export type AgentContinuationResult =
  | { ok: true; packet: AgentContinuationPreview }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'provider-not-ready' | 'delivery-failed' | 'receipt-timeout' | 'invalid' }

export interface AgentContinuationApi {
  /** Read all pending summaries, never raw transcript or terminal content. */
  summary(): Promise<AgentContinuationPreview[]>
  /** Read one bounded packet for the anchored review surface. */
  preview(nodeId: string): Promise<AgentContinuationPreview | null>
  /** Mark that the user saw the review, without clearing the packet. */
  ack(nodeId: string): Promise<boolean>
  /** Explicitly discard one packet. */
  discard(nodeId: string): Promise<boolean>
  /** Explicitly review and continue one packet. Never invoked on mount or from an event handler. */
  continue(nodeId: string): Promise<AgentContinuationResult>
  /** Fires when a packet changes, including cold-relaunch hydration. */
  onUpdate(listener: (packets: AgentContinuationPreview[]) => void): () => void
}

