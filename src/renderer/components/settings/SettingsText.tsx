import type React from 'react'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

/** Explicit prose boundary for settings copy outside FieldRow and shared controls. */
export function SettingsText({ children }: { children: string }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return <>{vocab(children)}</>
}
