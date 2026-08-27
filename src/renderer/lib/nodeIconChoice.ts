import type { NodeIcon } from '@shared/node-icon'
import type { NodeIconChoice } from '../components/NodeIconPicker'

/** Apply set/remove, while keeping cancel as a true no-op. */
export function applyIconChoice(
  choice: NodeIconChoice,
  apply: (icon: NodeIcon | undefined) => void
): void {
  if (choice === undefined) return
  apply(choice ?? undefined)
}
