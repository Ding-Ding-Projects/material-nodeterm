import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  catalogForUniverse,
  universeShopCatalogProvider,
  subscribeUniverseShopCatalog,
  newUniverseCreationEventId,
  searchShopCatalog,
  type ShopCatalogEntry,
  type SpecialUniverseScope
} from '../../core/universe-shop'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { type CanvasNode } from '../state/workspace'
import { useProjects } from '../state/projects'
import { nodeBorderStyle, nodeColorStyle } from '../lib/nodeColor'
import { appearanceId } from '../lib/appearance/registry'

/**
 * The permanent catalog surface owned by a Multiverse or AWS Universe child canvas.
 *
 * It is intentionally a small, real control surface: the search field is local to this Shop,
 * its regex builder is anchored to that field, and each entry records the chosen creation intent
 * on the node. The actual node executor remains shared with the catalog coordinator, so this
 * surface cannot invent an AWS entry on a Multiverse canvas or vice versa.
 */
export function ShopNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData, getNode } = useReactFlow()
  const activeProjectId = useProjects((state) => state.activeProjectId)
  const ts = useLocalizedVocabularyText()
  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<string | null>((data.shopSelection as string | undefined) ?? null)
  const pendingCreationEventsRef = useRef(new Map<string, string>())
  const rawScope = data.universeScope
  const scope: SpecialUniverseScope | null = rawScope === 'aws-universe' || rawScope === 'multiverse' ? rawScope : null
  const canvasId = typeof data.universeCanvasId === 'string' && data.universeCanvasId.trim() ? data.universeCanvasId : null
  const rawDepth = Number(data.universeDepth)
  const depth = Number.isInteger(rawDepth) && rawDepth >= 1 ? rawDepth : null
  const [provider, setProvider] = useState(universeShopCatalogProvider(activeProjectId))
  useEffect(() => subscribeUniverseShopCatalog(() => setProvider(universeShopCatalogProvider(activeProjectId))), [activeProjectId])
  const entries = useMemo(() => scope && canvasId && depth !== null ? catalogForUniverse({ scope, depth, catalog: provider, projectId: activeProjectId }) : [], [scope, canvasId, depth, provider, activeProjectId])
  const resolvedEntries = useMemo(() => entries.map((entry) => ({
    ...entry,
    searchText: [ts(entry.labelKey, 'Catalog entry'), ts(entry.descriptionKey, 'Catalog entry details')].join(' ')
  })), [entries, ts])
  const result = useMemo(
    () => searchShopCatalog(resolvedEntries, search.value, { mode: search.mode, flags: search.flags }),
    [resolvedEntries, search.value, search.mode, search.flags]
  )
  const border = nodeBorderStyle(data.color)
  const header = nodeColorStyle(data.color, 0.18)
  const scopeLabel = scope === 'aws-universe'
    ? ts('universeShop.scope.aws', 'AWS Universe')
    : scope === 'multiverse'
      ? ts('universeShop.scope.multiverse', 'Multiverse')
      : ts('universeShop.scope.unknown', 'Unknown universe')

  const choose = (entry: ShopCatalogEntry): void => {
    if (entry.available === false || !canvasId || !scope || depth === null || !provider?.create) return
    const creationEventId = pendingCreationEventsRef.current.get(entry.id) ?? newUniverseCreationEventId()
    pendingCreationEventsRef.current.set(entry.id, creationEventId)
    const position = getNode(id)?.position
    const result = provider.create(entry, { canvasId, scope, depth, creationEventId, placement: position, projectId: activeProjectId })
    if (result.status !== 'refused') {
      pendingCreationEventsRef.current.delete(entry.id)
      setChosen(entry.id)
      updateNodeData(id, { shopSelection: entry.id })
    }
  }

  return (
    <div
      className={`shop-node${selected ? ' selected' : ''}`}
      style={border.style}
      role="region"
      aria-label={ts('universeShop.aria.label', 'Shop for {scope}', { scope: scopeLabel })}
      data-universe-shop="true"
      data-universe-shop-scope={scope}
      data-appearance-id={appearanceId('node', id)}
    >
      <NodeResizer minWidth={360} minHeight={300} isVisible={selected} color={data.color} />
      <div className={`shop-node__header ${header.className}`} style={header.style} data-appearance-id={appearanceId('node', `${id}:shop-header`)}>
        <span className="shop-node__icon" aria-hidden="true">⌘</span>
        <div>
          <h2 className="shop-node__title">{ts('universeShop.title', 'Shop')}</h2>
          <p className="shop-node__scope">{ts('universeShop.scope', '{scope} catalog', { scope: scopeLabel })}</p>
        </div>
        <span className="shop-node__fixed" title={ts('universeShop.fixed.title', 'This Shop belongs to its universe and cannot be moved or deleted.')}>🔒</span>
      </div>
      <div className="shop-node__body" aria-describedby={`${id}-shop-description`} data-appearance-id={appearanceId('node', `${id}:shop-body`)}>
        <p id={`${id}-shop-description`} className="shop-node__description" data-appearance-id={appearanceId('node', `${id}:shop-description`)}>{ts('universeShop.description', 'Choose a node to create in this universe. The catalog is scoped and stays local to this Shop.')}</p>
        <div className="shop-node__search-row" data-appearance-id={appearanceId('node', `${id}:shop-search-row`)}>
          <label className="shop-node__search-label" htmlFor={`${id}-catalog-search`}>
            {ts('universeShop.search.label', 'Search catalog')}
          </label>
          <div className="shop-node__search-control">
            <input
              ref={inputRef}
              id={`${id}-catalog-search`}
              data-appearance-id={appearanceId('node', `${id}:shop-search`)}
              className="shop-node__search nodrag"
              type="search"
              value={search.value}
              placeholder={ts('universeShop.search.placeholder', 'Search nodes')}
              aria-describedby={`${id}-catalog-search-note`}
              onChange={(event) => search.setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') search.reset()
              }}
            />
            <AnchoredRegexBuilder
              search={search}
              fieldRef={inputRef}
              label={ts('universeShop.search.regex', 'Open regex builder for this catalog')}
              zIndex={95}
            />
          </div>
        </div>
        <p id={`${id}-catalog-search-note`} className="shop-node__search-note" role="status">
          {result.error
            ? ts('universeShop.search.error', 'Pattern is invalid. Showing all scoped entries.')
            : ts('universeShop.search.count', '{count} scoped entries', { count: String(result.entries.length) })}
        </p>
        <ul className="shop-node__entries" aria-label={ts('universeShop.entries.aria', 'Available catalog entries')} data-appearance-id={appearanceId('node', `${id}:shop-entries`)}>
          {!scope || !canvasId || depth === null ? (
            <li className="shop-node__empty" role="status">{ts('universeShop.invalidScope', 'This Shop has incomplete universe scope metadata, so catalog creation is unavailable.')}</li>
          ) : !provider ? (
            <li className="shop-node__empty" role="status">{ts('universeShop.catalogUnavailable', 'The unified Node Catalog is unavailable in this build. Enable the catalog dependency before creating nodes.')}</li>
          ) : result.entries.length === 0 ? (
            <li className="shop-node__empty" role="status">{ts('universeShop.empty', 'No catalog entries match this search.')}</li>
          ) : (
            result.entries.map((entry) => (
              <li key={entry.id} className="shop-node__entry-item">
                <button
                  type="button"
                  className={`shop-node__entry${chosen === entry.id ? ' selected' : ''} nodrag`}
                  disabled={entry.available === false}
                  aria-pressed={chosen === entry.id}
                  onClick={() => choose(entry)}
                  aria-describedby={entry.available === false ? `${id}-entry-${entry.id}-note` : undefined}
                  data-appearance-id={appearanceId('node', `${id}:shop-entry:${entry.id}`)}
                  title={entry.available === false
                    ? ts(entry.disabledReasonKey ?? 'universeShop.entryUnavailable', 'This catalog entry is unavailable until its executor is available.')
                    : ts(entry.descriptionKey, 'Catalog entry details')}
                >
                  <span className="shop-node__entry-label">{ts(entry.labelKey, 'Catalog entry')}</span>
                  <span className="shop-node__entry-kind">{entry.nodeKind}</span>
                  {entry.available === false && <span id={`${id}-entry-${entry.id}-note`} className="shop-node__entry-disabled">{ts(entry.disabledReasonKey ?? 'universeShop.entryUnavailable', 'This catalog entry is unavailable until its executor is available.')}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="shop-node__hint" data-appearance-id={appearanceId('node', `${id}:shop-hint`)}>
          {chosen
            ? ts('universeShop.selected', '{entry} selected. Use the shared creation action to continue.', {
                entry: resolvedEntries.find((entry) => entry.id === chosen)
                  ? ts(resolvedEntries.find((entry) => entry.id === chosen)!.labelKey, 'Catalog entry')
                  : chosen
              })
            : ts('universeShop.hint', 'This Shop stays available as the one catalog entry point for this universe.')}
        </p>
      </div>
    </div>
  )
}

export default ShopNode
