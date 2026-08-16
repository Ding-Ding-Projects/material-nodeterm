import { isDestructiveVerb } from '@shared/control-verbs'

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

  if (dependencies.confirmationBusy()) {
    dependencies.reply(pendingConfirmationReply())
    return true
  }

  const cancel = (): void => dependencies.reply({ ok: false, error: 'denied by user' })

  if (request.verb === 'write') {
    dependencies.openWriteConfirmation({
      message: `Agent "${request.sourceTitle}" wants to send to ${nodeId}:\n\n${request.args.text ?? ''}`,
      confirmLabel: 'Send',
      requestedBy: request.sourceTitle,
      onConfirm: async () => dependencies.reply(await dependencies.performWrite(nodeId, request.args.text ?? '')),
      onCancel: cancel
    })
    return true
  }

  // The closed DESTRUCTIVE_VERBS inventory currently leaves only `close` here. Refuse an unknown
  // future member until its behavior is deliberately added rather than guessing a destructive
  // action. The dispatcher Chut iterates the shared set, so adding one turns it red immediately.
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
