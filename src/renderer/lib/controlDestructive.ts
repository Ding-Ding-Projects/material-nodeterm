import { isDestructiveVerb } from '@shared/control-verbs'

/**
 * Runtime refusal shared by the control dispatcher’s hand-written destructive cases.
 *
 * This is deliberately executable rather than a source-text drift alarm: tests call the same
 * decision Canvas calls and prove a pending confirmation blocks every registry member while an
 * unrelated verb remains available.
 */
export function destructiveControlBlocked(verb: string, confirmationPending: boolean): boolean {
  return isDestructiveVerb(verb) && confirmationPending
}
