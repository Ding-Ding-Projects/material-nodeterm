import { DestructiveConfirmGate } from './DestructiveConfirmGate'
import { useDestructiveGate } from '../state/destructiveGate'

/**
 * The single mount point for the destructive-action super-confirmation gate.
 *
 * Mounted once at the app root, beside `PromptDialogHost` and `AppearanceEditorHost`, so that
 * every surface can reach the gate through `openDestructiveGate()` — Source Control and Settings
 * as much as the canvas — and so an open gate is not inside a subtree that a project switch
 * re-renders out from under the person confirming.
 *
 * Deliberately thin: the decision of WHEN a gate is required lives with each action (via
 * `requiresDestructiveGate`), and the gate's own behaviour lives in `DestructiveConfirmGate`.
 * This only connects the two.
 */
export function DestructiveGateHost(): React.JSX.Element | null {
  const request = useDestructiveGate((s) => s.request)
  const close = useDestructiveGate((s) => s.close)
  if (!request) return null
  return (
    <DestructiveConfirmGate
      title={request.title}
      description={request.description}
      affected={request.affected}
      confirmLabel={request.confirmLabel}
      anchor={request.anchor}
      restoreFocusEl={request.restoreFocusEl}
      onConfirm={() => {
        // Close FIRST. The action can throw, and a gate left on screen after a failed delete
        // reads as "it did not go through, try again" — which is the one message that must never
        // be wrong about an irreversible action.
        close()
        request.onConfirm()
      }}
      onCancel={close}
    />
  )
}
