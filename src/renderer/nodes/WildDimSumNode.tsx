import { useEffect, useMemo, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { PUBLIC_DIM_SUM_CATALOG_MAX_BYTES, PUBLIC_DIM_SUM_CATALOG_URL, normalizePublicDimSumSelection, parsePublicDimSumCatalog, publicDimSumImageUrl, type PublicDimSumSelection } from '@shared/public-dim-sum'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { useSchoolMode } from '../state/schoolMode'
import type { CanvasNode } from '../state/workspace'
import { Button, IconButton, ListRow } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

type LoadState = { kind: 'idle' } | { kind: 'loading'; loaded: number; total: number | null } | { kind: 'ready'; dishes: PublicDimSumSelection[] } | { kind: 'error'; message: string } | { kind: 'cancelled' }

async function fetchCatalog(signal: AbortSignal, progress: (loaded: number, total: number | null) => void): Promise<PublicDimSumSelection[]> {
  const response = await fetch(PUBLIC_DIM_SUM_CATALOG_URL, { signal, cache: 'no-cache', credentials: 'omit' })
  if (!response.ok) throw new Error(`Catalog request returned HTTP ${response.status}.`)
  const stated = Number(response.headers.get('content-length'))
  const total = Number.isFinite(stated) && stated > 0 ? stated : null
  if (total !== null && total > PUBLIC_DIM_SUM_CATALOG_MAX_BYTES) throw new Error('The public catalog is larger than the supported 12 MiB limit.')
  if (!response.body) throw new Error('The public catalog response has no readable body.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    loaded += next.value.byteLength
    if (loaded > PUBLIC_DIM_SUM_CATALOG_MAX_BYTES) { await reader.cancel(); throw new Error('The public catalog exceeded the supported 12 MiB limit.') }
    chunks.push(next.value)
    progress(loaded, total)
  }
  const bytes = new Uint8Array(loaded)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return parsePublicDimSumCatalog(JSON.parse(new TextDecoder().decode(bytes)))
}

export default function WildDimSumNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const ts = useLocalizedVocabularyText()
  const vocab = useVocabularyMapper()
  const schoolModeEnabled = useSchoolMode((state) => state.enabled)
  const schoolModeHydrated = useSchoolMode((state) => state.hydrated)
  const search = useRegexSearchField({ mode: 'text' })
  const searchRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const [chosen, setChosen] = useState<PublicDimSumSelection | null>(normalizePublicDimSumSelection(data.wildDimSumDish))
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' })
  const [photoAttempt, setPhotoAttempt] = useState(0)
  const [photoFailed, setPhotoFailed] = useState(false)
  const fill = nodeHeaderFillStyle(data.color)
  const loadCatalog = () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoad({ kind: 'loading', loaded: 0, total: null })
    fetchCatalog(controller.signal, (loaded, total) => setLoad({ kind: 'loading', loaded, total }))
      .then((dishes) => setLoad({ kind: 'ready', dishes }))
      .catch((error: unknown) => controller.signal.aborted ? setLoad({ kind: 'cancelled' }) : setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) }))
  }
  useEffect(() => {
    if (!schoolModeHydrated || schoolModeEnabled) { requestRef.current?.abort(); setLoad({ kind: 'idle' }); return }
    loadCatalog()
    return () => requestRef.current?.abort()
  }, [schoolModeEnabled, schoolModeHydrated])
  const matches = useMemo(() => load.kind === 'ready' ? load.dishes.filter((dish) => search.test(`${dish.name.en} ${dish.name.zhHant} ${dish.category} ${dish.subcategory}`)).slice(0, 80) : [], [load, search.mode, search.query, search.pattern, search.flags, search.error])
  const choose = (dish: PublicDimSumSelection) => { setChosen(dish); setPhotoFailed(false); updateNodeData(id, { wildDimSumDish: dish, title: `Wild dim sum · ${dish.name.en}` }) }
  const pickRandom = () => { if (load.kind === 'ready' && load.dishes.length > 0) choose(load.dishes[Math.floor(Math.random() * load.dishes.length)]) }
  const progress = load.kind === 'loading' && load.total ? Math.min(100, Math.round(load.loaded / load.total * 100)) : null
  if (!schoolModeHydrated || schoolModeEnabled) return <div className={`term-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }} role="region" aria-label={vocab('Optional feature unavailable')}><NodeResizer minWidth={280} minHeight={180} isVisible={selected} color={data.color} /><div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}><span className="term-node__title-text">{vocab('Optional feature unavailable')}</span><span className="term-node__spacer" /><IconButton size="compact" className="term-node__close" icon="close" vocabularyMode="factual" title={vocab('Close')} aria-label={vocab('Close optional feature')} onClick={() => deleteElements({ nodes: [{ id }] })} /></div><div className="wild-dim-sum-node__body"><p>{vocab('This optional feature is hidden while the current shared mode is on.')}</p></div></div>
  return <div className={`term-node wild-dim-sum-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }} role="region" aria-label={ts('wildDimSum.aria', 'Wild dim sum node')}>
    <NodeResizer minWidth={380} minHeight={360} isVisible={selected} color={data.color} />
    <Handle id="flow-in" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', top: 0 }} />
    <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}><span aria-hidden="true">🥟</span><span className="term-node__title-text">{String(data.title || ts('wildDimSum.title', 'Wild dim sum'))}</span><span className="term-node__spacer" /><IconButton size="compact" className="term-node__close" icon="close" vocabularyMode="factual" title={ts('wildDimSum.close', 'Close')} aria-label={ts('wildDimSum.closeAria', 'Close Wild dim sum node')} onClick={() => deleteElements({ nodes: [{ id }] })} /></div>
    <div className="wild-dim-sum-node__body nodrag nowheel">
      {chosen && <section className="wild-dim-sum-node__selection" aria-label={vocab('Selected dish')}><img key={photoAttempt} src={publicDimSumImageUrl(chosen)} alt={`${chosen.image.alt.en} · ${chosen.image.alt.yue}`} onLoad={() => setPhotoFailed(false)} onError={() => setPhotoFailed(true)} /><div><h3>{chosen.name.en} · {chosen.name.zhHant}</h3><p>{chosen.description.en}</p><p lang="yue-Hant-HK">{chosen.description.yue}</p><small>{chosen.category} · {chosen.subcategory}</small></div>{photoFailed && <div className="wild-dim-sum-node__notice" role="status"><span>{vocab('The published photo could not be loaded. The saved dish details remain available.')}</span> <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => { setPhotoFailed(false); setPhotoAttempt((value) => value + 1) }}>{vocab('Retry photo')}</Button></div>}</section>}
      <div className="wild-dim-sum-node__actions"><Button variant="filled" size="small" vocabularyMode="factual" onClick={pickRandom} disabled={load.kind !== 'ready'} title={load.kind === 'ready' ? ts('wildDimSum.randomReady', 'Choose a random published dish') : ts('wildDimSum.randomDisabled', 'The public catalog must finish loading first')}>{ts('wildDimSum.random', 'Surprise me')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={loadCatalog} disabled={load.kind === 'loading'}>{load.kind === 'error' || load.kind === 'cancelled' ? ts('wildDimSum.retry', 'Retry catalog') : ts('wildDimSum.refresh', 'Refresh catalog')}</Button>{load.kind === 'loading' && <Button variant="text" size="small" vocabularyMode="factual" onClick={() => requestRef.current?.abort()}>{ts('wildDimSum.cancel', 'Cancel')}</Button>}</div>
      {load.kind === 'loading' && <div className="wild-dim-sum-node__progress" role="status"><progress value={progress ?? undefined} max="100" /> <span>{progress === null ? <>{load.loaded.toLocaleString()} <span>{vocab('bytes loaded')}</span></> : <>{progress}% <span>{vocab('loaded')}</span></>}</span></div>}
      {load.kind === 'error' && <p className="wild-dim-sum-node__notice" role="alert"><span>{vocab('Catalog unavailable:')}</span> {load.message} <span>{vocab('Retry when the network or public catalog is available.')}</span></p>}
      {load.kind === 'cancelled' && <p className="wild-dim-sum-node__notice" role="status">{ts('wildDimSum.cancelled', 'Catalog loading was cancelled. The saved dish remains unchanged.')}</p>}
      {load.kind === 'ready' && <section aria-label={ts('wildDimSum.chooseAria', 'Choose a public catalog dish')}><label htmlFor={`${id}-dish-search`}>{ts('wildDimSum.search', 'Search published dishes')}</label><div className="wild-dim-sum-node__search"><Input ref={searchRef} id={`${id}-dish-search`} type="search" vocabularyMode="factual" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={ts('wildDimSum.searchPlaceholder', 'Name, category, or subcategory')} onKeyDown={(event) => { if (event.key === 'Escape') search.reset() }} /><AnchoredRegexBuilder search={search} fieldRef={searchRef} label={ts('wildDimSum.regex', 'Regex builder for published dishes')} zIndex={95} /></div><p className="wild-dim-sum-node__count" role="status">{search.error ? ts('wildDimSum.invalidPattern', 'Invalid pattern. All dishes remain visible.') : ts('wildDimSum.count', '{shown} of {total} dishes shown.', { shown: String(matches.length), total: String(load.dishes.length) })}</p><ul className="wild-dim-sum-node__list" aria-label={ts('wildDimSum.listAria', 'Published dishes')}>{matches.length === 0 ? <li className="wild-dim-sum-node__empty">{ts('wildDimSum.empty', 'No published dishes match this search.')}</li> : matches.map((dish) => <li key={dish.id}><ListRow vocabularyMode="factual" aria-pressed={chosen?.id === dish.id} onClick={() => choose(dish)} label={<strong>{dish.name.en} · {dish.name.zhHant}</strong>} sub={`${dish.category} · ${dish.subcategory}`} /></li>)}</ul></section>}
      <p className="wild-dim-sum-node__source">{vocab('Catalog and photos:')} Ding-Ding-Projects/dim-sum-photos {vocab('public releases. No photo is copied into this project.')}</p>
    </div>
  </div>
}
