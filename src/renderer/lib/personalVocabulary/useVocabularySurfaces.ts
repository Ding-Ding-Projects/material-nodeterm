import { useMemo } from 'react'
import type { MenuItem } from '../../components/ContextMenu'
import type { Command } from '../../components/CommandPalette'
import { useVocabularyMapper } from './useVocabularyText'
import { applyVocabularyToCommands, applyVocabularyToMenuItems } from './surfaces'

/** Context-menu tree with its prose (labels, section headings, disabled hints) translated. */
export function useVocabularyMenuItems(items: MenuItem[]): MenuItem[] {
  const map = useVocabularyMapper()
  return useMemo(() => applyVocabularyToMenuItems(items, map), [items, map])
}

/** Command-palette rows with their prose translated, BEFORE the query filter sees them. */
export function useVocabularyCommands(commands: Command[]): Command[] {
  const map = useVocabularyMapper()
  return useMemo(() => applyVocabularyToCommands(commands, map), [commands, map])
}
