import { useEffect, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { resolvePublicDimSumCatalog, type ResolvedDimSum } from '../lib/dimsum/public-catalog'

export function WildDimSumNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const [dish, setDish] = useState<ResolvedDimSum | null>(null)
  useEffect(() => {
    if (data.wildDishId && data.wildDishNameEn && data.wildDishNameZhHant) {
      setDish({ id: data.wildDishId, name: { en: data.wildDishNameEn, zhHant: data.wildDishNameZhHant }, image: data.wildImageUrl ?? '', revision: data.wildCatalogRevision ?? 'hydrated' })
      return
    }
    void resolvePublicDimSumCatalog().then((items) => {
      const picked = items[0]
      if (!picked) return
      setDish(picked)
      updateNodeData(id, { title: `${picked.name.en} · ${picked.name.zhHant}`, wildDishId: picked.id, wildDishNameEn: picked.name.en, wildDishNameZhHant: picked.name.zhHant, wildImageUrl: picked.image, wildCatalogRevision: picked.revision })
    })
  }, [data.wildDishId, data.wildDishNameEn, data.wildDishNameZhHant, id, updateNodeData])
  return <div className="wild-dimsum-node" role="article" aria-label={dish ? `${dish.name.en} · ${dish.name.zhHant}` : 'Wild dim sum'}>
    <NodeResizer isVisible={selected} minWidth={260} minHeight={180} />
    <header><strong>Wild dim sum</strong><button type="button" aria-label="Delete wild dim sum" onClick={() => deleteElements({ nodes: [{ id }] })}>×</button></header>
    {dish ? <><div className="wild-dimsum-node__name">{dish.name.en} · {dish.name.zhHant}</div>{dish.image ? <img src={dish.image} alt={`${dish.name.en} · ${dish.name.zhHant}`} /> : <div className="wild-dimsum-node__empty">Public image unavailable. The dish name is retained.</div>}</> : <div>Resolving the public catalog…</div>}
  </div>
}

export default WildDimSumNode
