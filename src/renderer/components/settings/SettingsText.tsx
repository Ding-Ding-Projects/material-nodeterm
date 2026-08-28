import * as React from 'react'
import { useVocabularyMapper, useVocabularyTemplate } from '../../lib/personalVocabulary/useVocabularyText'

export type SettingsTextSegment =
  | { kind: 'copy'; value: string }
  | { kind: 'fact'; value: React.ReactNode }

type SettingsTextProps =
  | { children: string; template?: never; facts?: never; segments?: never }
  | { children?: never; template: string; facts?: Record<string, string>; segments?: never }
  | { children?: never; template?: never; facts?: never; segments: readonly SettingsTextSegment[] }

/** Explicit settings prose boundary. Copy segments are mapped, facts are rendered verbatim. */
export function SettingsText(props: SettingsTextProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const template = useVocabularyTemplate(
    'template' in props ? props.template : undefined,
    'facts' in props ? props.facts : undefined
  )
  if ('segments' in props) {
    return (
      <>
        {props.segments.map((segment, index) =>
          segment.kind === 'copy' ? <React.Fragment key={index}>{vocab(segment.value)}</React.Fragment> : <React.Fragment key={index}>{segment.value}</React.Fragment>
        )}
      </>
    )
  }
  return <>{'template' in props ? template : vocab(props.children)}</>
}
