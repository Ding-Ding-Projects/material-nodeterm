import { useEffect, useMemo, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import type { MediaAssetReference } from '@shared/media-catalog'
import { mediaKindForPath, mediaMimeForExtension } from '@shared/media-catalog'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapAroundExactFacts } from './nodeVocabulary'

export default function GalleryNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements } = useReactFlow()
  const vocab = useVocabularyMapper()
  const assets = (data.mediaAssets as MediaAssetReference[] | undefined) ?? []
  const active = assets.find((a) => a.assetId === data.mediaActiveAssetId) ?? assets[0]
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [, redraw] = useState(0)
  const path = active?.sourcePath ?? active?.portablePath ?? ''
  useEffect(() => {
    let alive = true
    setSrc(''); setError('')
    if (!path || path.startsWith('./')) return () => { alive = false }
    window.nodeTerminal.media.allow(path).then((url) => { if (alive) setSrc(url) }).catch(() => { if (alive) setError(vocab('This gallery asset is missing or unavailable.')) })
    return () => { alive = false }
  }, [path, vocab])
  const fill = nodeHeaderFillStyle(data.color)
  const missing = !active || !!active.missing || !src
  const kind = active?.kind
  const count = assets.length
  const thumbs = useMemo(() => assets.slice(0, 12), [assets])
  const title = String(data.title || vocab('Gallery'))
  const addFiles = async (files: File[]) => {
    const additions: MediaAssetReference[] = []
    for (const file of files.slice(0, 100)) {
      const name = file.name
      const kind = mediaKindForPath(name)
      if (!kind || file.size > 2_000_000_000) continue
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
      const sha = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
      const mime = mediaMimeForExtension(extension)
      if (!mime) continue
      additions.push({ assetId: sha, sha256: sha, kind, mime, bytes: file.size, portablePath: `./assets/media/${sha}.${extension}`, sourcePath: (file as File & { path?: string }).path })
    }
    if (!additions.length) return
    const next = [...assets, ...additions]
    data.mediaAssets = next
    data.mediaActiveAssetId = additions[0].assetId
    redraw((value) => value + 1)
  }
  const removeActive = () => {
    if (!active) return
    const next = assets.filter((asset) => asset.assetId !== active.assetId)
    data.mediaAssets = next
    data.mediaActiveAssetId = next[0]?.assetId
    redraw((value) => value + 1)
  }
  return <div className={`term-node gallery-node${selected ? ' selected' : ''}`} data-easter-surface="media" style={{ borderTopColor: data.color }}>
    <NodeResizer minWidth={360} minHeight={260} isVisible={selected} color={data.color} />
    <Handle id="flow-in" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', top: 0 }} />
    <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
      <span className="term-node__title-text">{title}</span><span className="term-node__spacer" />
      <span aria-live="polite" className="gallery-node__count">{count} {vocab(count === 1 ? 'asset' : 'assets')}</span>
      <button className="term-node__close" title={vocab('Close')} aria-label={vocab('Close gallery')} onClick={() => deleteElements({ nodes: [{ id }] })}>×</button>
    </div>
    <div className="editor-node__body"><div className="gallery-node__stage nodrag nowheel" aria-label={vocab('Gallery preview')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)) }}>
      {missing ? <div className="editor-node__loading" role="status">{error || (!active ? vocab('No media selected.') : active.missing ? vocab('Asset missing. Locate it to restore playback.') : vocab('Loading asset…'))}</div> : kind === 'video' ? <video src={src} controls preload="metadata" aria-label={active?.portablePath ? mapAroundExactFacts(active.portablePath, [active.portablePath], vocab) : vocab('Gallery video')} /> : <img src={src} alt={active?.portablePath ? mapAroundExactFacts(active.portablePath, [active.portablePath], vocab) : vocab('Gallery photo')} />}
      <div className="gallery-node__thumbs" aria-label={vocab('Gallery assets')}>{thumbs.map((asset) => <button type="button" key={asset.assetId} className={asset === active ? 'is-active' : ''} title={asset.portablePath} aria-label={mapAroundExactFacts(`Select ${asset.portablePath}`, [asset.portablePath], vocab)} onClick={() => { data.mediaActiveAssetId = asset.assetId; redraw((value) => value + 1) }}>{asset.kind === 'video' ? '▶' : '▧'}</button>)}<label className="gallery-node__add">{vocab('Add media')}<input type="file" accept="image/*,video/*" multiple onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = '' }} /></label>{active ? <button type="button" className="gallery-node__remove" onClick={removeActive}>{vocab('Remove selected')}</button> : null}</div>
    </div></div>
  </div>
}
