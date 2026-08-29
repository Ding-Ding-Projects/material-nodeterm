import type { ComponentProps } from 'react'
import { ContextMenu } from '../ContextMenu'
import { useVocabularyMenuItems } from '../../lib/personalVocabulary/useVocabularySurfaces'

/**
 * `ContextMenu` with the personal-vocabulary boundary applied to its item tree.
 *
 * This is a wrapper rather than a change inside `ContextMenu` on purpose: that component is the
 * shared menu SHELL (positioning, flyouts, filtering, keyboard) and has no business subscribing to
 * a user-profile store. Keeping the substitution in a thin outer layer also means a caller that
 * must show a menu verbatim — one whose rows are file paths or shell commands — can still render
 * the plain `ContextMenu` and be obviously, reviewably exempt.
 *
 * Prefer this everywhere a menu's rows are prose. Only `label` and `hint` are translated; see
 * `lib/personalVocabulary/surfaces.ts` for why shortcuts and account identity are not.
 */
export function VocabularyContextMenu(
  props: ComponentProps<typeof ContextMenu>
): React.JSX.Element {
  const items = useVocabularyMenuItems(props.items)
  return <ContextMenu {...props} items={items} />
}
