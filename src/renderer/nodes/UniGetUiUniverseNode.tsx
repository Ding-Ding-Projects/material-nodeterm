import type { NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { MaterialSymbol } from '../components/MaterialSymbol'
import { Button } from '@renderer/ui/md3'

/** Project-safe portal. Package rows and manager state remain in the machine Global Universe. */
export function UniGetUiUniverseNode({ id, data }: NodeProps<CanvasNode>): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const open = (): void => {
    window.dispatchEvent(new CustomEvent('nodeterm:open-unigetui-global'))
  }
  return (
    <div id={id} className="unigetui-universe-node" data-appearance-id={`node:${id}`}>
      <Button variant="tonal" className="unigetui-universe-node__open" vocabularyMode="factual" onClick={open} aria-label={vocab('Open UniGetUI Global Universe')}>
        <MaterialSymbol name="hub" size={24} />
        <span>{data.title || vocab('UniGetUI Global Universe')}</span>
      </Button>
      <p>{vocab('Machine-owned package tools and installed-app inventory')}</p>
      <small>{vocab('Project files contain only this portal, never package state or credentials.')}</small>
    </div>
  )
}
