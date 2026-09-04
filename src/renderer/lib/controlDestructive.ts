import { isDestructiveVerb } from '@shared/control-verbs'
import { guardConcurrentRestart } from '../terminal/agent-restart'

export interface ControlActionReply {
  ok: boolean
  message?: string
  result?: unknown
  error?: string
}

interface DestructiveControlRequest {
  verb: string
  args: Record<string, string>
  sourceTitle: string
}

interface WriteConfirmationRequest {
  message: string
  confirmLabel: string
  requestedBy: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

interface CloseConfirmationRequest {
  nodeId: string
  requestedBy: string
  onConfirm: () => void
  onCancel: () => void
}

interface DestructiveControlDependencies {
  confirmationBusy(): boolean
  /** Global opt-in for write-only seamless agent messaging. Close never uses this path. */
  seamlessWrites?(): boolean
  openWriteConfirmation(request: WriteConfirmationRequest): void
  openCloseConfirmation(request: CloseConfirmationRequest): boolean
  performWrite(nodeId: string, text: string): Promise<ControlActionReply>
  performClose(nodeId: string): void
  reply(result: ControlActionReply): void
}

const pendingConfirmationReply = (): ControlActionReply => ({
  ok: false,
  error: 'a confirmation is already pending — try again'
})

/**
 * Dispatch the shared destructive control verbs through their human-confirmation boundary.
 *
 * `false` means the verb is not destructive and the ordinary control switch should continue.
 * `true` means this function owns the request and will reply exactly once. The supplied write and
 * close effects are reachable only from the confirmation callbacks; keeping that ordering in this
 * behavior-level seam prevents a switch case from accidentally performing first and prompting
 * afterward.
 */
export function dispatchDestructiveControl(
  request: DestructiveControlRequest,
  dependencies: DestructiveControlDependencies
): boolean {
  if (!isDestructiveVerb(request.verb)) return false

  const nodeId = request.args.node
  if (!nodeId) {
    dependencies.reply({ ok: false, error: `${request.verb} requires --node` })
    return true
  }

  // A seamless write never opens or replaces a confirmation surface, so an unrelated pending
  // dialog must not turn this already-approved delivery into a false refusal. Close remains gated.
  if (
    dependencies.confirmationBusy() &&
    !(request.verb === 'write' && dependencies.seamlessWrites?.() === true)
  ) {
    dependencies.reply(pendingConfirmationReply())
    return true
  }

  const cancel = (): void => dependencies.reply({ ok: false, error: 'denied by user' })

  if (request.verb === 'write') {
    if (dependencies.seamlessWrites?.() === true) {
      let actionReply: ControlActionReply | undefined
      void guardConcurrentRestart(nodeId, async () => {
        actionReply = await dependencies.performWrite(nodeId, request.args.text ?? '')
        return 'performed' as const
      })().then((outcome) => {
        dependencies.reply(
          outcome === 'not-eligible'
            ? { ok: false, error: 'target is busy with a restart or wake — try again' }
            : (actionReply ?? { ok: false, error: 'write did not return a result' })
        )
      }).catch((error) => {
        dependencies.reply({ ok: false, error: String(error) })
      })
      return true
    }
    dependencies.openWriteConfirmation({
      message: `Agent "${request.sourceTitle}" wants to send to ${nodeId}:\n\n${request.args.text ?? ''}`,
      confirmLabel: 'Send',
      requestedBy: request.sourceTitle,
      onConfirm: async () => {
        // Own the restart lock in the behavior-level dispatcher, not in Canvas's injected effect.
        // That makes the confirmation boundary and the shared per-node exclusion one indivisible
        // contract: every confirmed write routed here is guarded, and the executable dispatcher
  // gate can prove the wiring without scanning a React component's source text.
        let actionReply: ControlActionReply | undefined
        const outcome = await guardConcurrentRestart(nodeId, async () => {
          actionReply = await dependencies.performWrite(nodeId, request.args.text ?? '')
          return 'performed' as const
        })()
        dependencies.reply(
          outcome === 'not-eligible'
            ? { ok: false, error: 'target is busy with a restart or wake — try again' }
            : (actionReply ?? { ok: false, error: 'write did not return a result' })
        )
      },
      onCancel: cancel
    })
    return true
  }

  // The closed DESTRUCTIVE_VERBS inventory currently leaves only `close` here. Refuse an unknown
  // future member until its behavior is deliberately added rather than guessing a destructive
  // action. The dispatcher gate iterates the shared set, so adding one turns it red immediately.
  if (request.verb !== 'close') {
    dependencies.reply({ ok: false, error: `unsupported destructive control verb: ${request.verb}` })
    return true
  }

  const opened = dependencies.openCloseConfirmation({
    nodeId,
    requestedBy: request.sourceTitle,
    onConfirm: () => {
      dependencies.performClose(nodeId)
      dependencies.reply({ ok: true, message: `closed ${nodeId}` })
    },
    onCancel: cancel
  })
  if (!opened) dependencies.reply(pendingConfirmationReply())
  return true
}
