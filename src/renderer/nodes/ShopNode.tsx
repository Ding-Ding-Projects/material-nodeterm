import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  catalogForUniverse,
  requestUniverseShopCatalogCreation,
  universeShopCatalogProvider,
  newUniverseCreationEventId,
  searchShopCatalog,
  type ShopCatalogEntry,
  type SpecialUniverseScope
} from '../../core/universe-shop'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { type CanvasNode } from '../state/workspace'
import { nodeBorderStyle, nodeColorStyle } from '../lib/nodeColor'
import { appearanceId } from '../lib/appearance/registry'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { Button } from '../ui/Button'
import { AwsOperationWizard } from '../components/aws/AwsOperationWizard'
import { buildAwsWizardDefinition, type AwsWizardModelSource } from '@shared/aws-wizard'
import type { AwsWizardCommandOption, AwsWizardServiceOption } from '@shared/aws-wizard'
import type { AwsManagerRequest, AwsManagerResult, AwsOperationPreview, AwsManagerProgress } from '@shared/aws-resource'
import { useActiveSessionApi } from '../session/session'
import { openDestructiveGate } from '../state/destructiveGate'

function newOperationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `aws-operation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * The permanent catalog surface owned by a Multiverse or AWS Universe child canvas.
 *
 * It is intentionally a small, real control surface: the search field is local to this Shop,
 * its regex builder is anchored to that field, and each entry records the chosen creation intent
 * on the node. The actual node executor remains shared with the catalog coordinator, so this
 * surface cannot invent an AWS entry on a Multiverse canvas or vice versa.
 */
export function ShopNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const api = useActiveSessionApi()
  const ts = useLocalizedVocabularyText()
  const search = useRegexSearchField({ mode: 'text' })
  const inputRef = useRef<HTMLInputElement>(null)
  const wizardAnchorRef = useRef<HTMLButtonElement>(null)
  const wizardServiceSearchRef = useRef<HTMLInputElement>(null)
  const wizardCommandSearchRef = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<string | null>((data.shopSelection as string | undefined) ?? null)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardLoadError, setWizardLoadError] = useState<string | null>(null)
  const [wizardServices, setWizardServices] = useState<readonly AwsWizardServiceOption[]>([])
  const [wizardCommands, setWizardCommands] = useState<readonly AwsWizardCommandOption[]>([])
  const [wizardServiceId, setWizardServiceId] = useState('')
  const [wizardCommandName, setWizardCommandName] = useState('')
  const [wizardSource, setWizardSource] = useState<AwsWizardModelSource | undefined>(data.awsWizardSource as AwsWizardModelSource | undefined)
  const [genericPreview, setGenericPreview] = useState<AwsOperationPreview | null>(null)
  const [genericRequest, setGenericRequest] = useState<AwsManagerRequest | null>(null)
  const [genericResult, setGenericResult] = useState<AwsManagerResult | null>(null)
  const [genericProgress, setGenericProgress] = useState<AwsManagerProgress | null>(null)
  const [genericBusy, setGenericBusy] = useState(false)
  const wizardServiceSearch = useRegexSearchField()
  const wizardCommandSearch = useRegexSearchField()
  const rawScope = data.universeScope
  const scope: SpecialUniverseScope | null = rawScope === 'aws-universe' || rawScope === 'multiverse' ? rawScope : null
  const canvasId = typeof data.universeCanvasId === 'string' && data.universeCanvasId.trim() ? data.universeCanvasId : null
  const rawDepth = Number(data.universeDepth)
  const depth = Number.isInteger(rawDepth) && rawDepth >= 1 ? rawDepth : null
  const provider = universeShopCatalogProvider()
  const entries = useMemo(() => scope && canvasId && depth !== null ? catalogForUniverse({ scope, depth, catalog: provider }) : [], [scope, canvasId, depth, provider])
  const result = useMemo(
    () => searchShopCatalog(entries, search.value, { mode: search.mode, flags: search.flags }),
    [entries, search.value, search.mode, search.flags]
  )
  const border = nodeBorderStyle(data.color)
  const header = nodeColorStyle(data.color, 0.18)
  const scopeLabel = scope === 'aws-universe' ? 'AWS Universe' : scope === 'multiverse' ? 'Multiverse' : 'Unknown universe'
  // The model-documentation lane supplies this shared, already validated source when an AWS
  // operation is selected. The Shop owns the route and the wizard owns the shape mapping, so a
  // future manager cannot grow a second catalog or a second form renderer.
  useEffect(() => {
    if (scope !== 'aws-universe') return
    let active = true
    void window.nodeTerminal.awsWizardModels.catalog().then((services) => {
      if (!active) return
      setWizardServices(services)
      if (services.length > 0) setWizardServiceId((current) => current || services[0].id)
    }).catch((error) => {
      if (active) setWizardLoadError(error instanceof Error ? error.message : 'The current AWS model inventory could not be loaded.')
    })
    return () => { active = false }
  }, [scope])

  useEffect(() => {
    if (scope !== 'aws-universe' || !wizardServiceId) {
      setWizardCommands([])
      setWizardCommandName('')
      return
    }
    let active = true
    void window.nodeTerminal.awsWizardModels.commands(wizardServiceId).then((commands) => {
      if (!active) return
      setWizardCommands(commands)
      setWizardCommandName((current) => commands.some((command) => command.name === current) ? current : (commands[0]?.name ?? ''))
    }).catch((error) => {
      if (active) setWizardLoadError(error instanceof Error ? error.message : 'The selected AWS service commands could not be loaded.')
    })
    return () => { active = false }
  }, [scope, wizardServiceId])

  const visibleWizardServices = useMemo(
    () => wizardServices.filter((service) => wizardServiceSearch.test(`${service.label} ${service.id}`)),
    [wizardServices, wizardServiceSearch]
  )
  const visibleWizardCommands = useMemo(
    () => wizardCommands.filter((command) => wizardCommandSearch.test(`${command.name} ${command.documentation}`)),
    [wizardCommands, wizardCommandSearch]
  )
  const wizardState = useMemo(() => {
    if (!wizardSource || scope !== 'aws-universe') return { definition: null, error: null }
    try { return { definition: buildAwsWizardDefinition(wizardSource), error: null } }
    catch (error) { return { definition: null, error: error instanceof Error ? error.message : 'The AWS model source could not be used.' } }
  }, [scope, wizardSource])
  const wizardDefinition = wizardState.definition
  const wizardError = wizardState.error ?? wizardLoadError

  const loadSelectedWizard = (): void => {
    if (!wizardServiceId || !wizardCommandName) return
    setWizardLoadError(null)
    void window.nodeTerminal.awsWizardModels.source(wizardServiceId, wizardCommandName).then((source) => {
      if (!source) {
        setWizardLoadError('The selected AWS operation is not present in the current model inventory.')
        return
      }
      setWizardSource(source)
      setWizardOpen(true)
    }).catch((error) => setWizardLoadError(error instanceof Error ? error.message : 'The selected AWS operation model could not be loaded.'))
  }

  const prepareGenericOperation = async (input: Record<string, unknown>): Promise<void> => {
    if (!api.awsResource || !wizardServiceId || !wizardCommandName) return
    const request: AwsManagerRequest = {
      operation: 'generic',
      generic: { serviceId: wizardServiceId, commandName: wizardCommandName, input },
      maxResults: 100
    }
    setGenericBusy(true)
    setGenericResult(null)
    setWizardLoadError(null)
    try {
      setGenericPreview(await api.awsResource.preview(id, request))
      setGenericRequest(request)
    } catch (error) {
      setWizardLoadError(error instanceof Error ? error.message : 'The modeled AWS operation could not be prepared.')
    } finally {
      setGenericBusy(false)
    }
  }

  const runGenericOperation = (): void => {
    if (!api.awsResource || !genericPreview || !genericRequest || genericBusy) return
    const run = async (): Promise<void> => {
      const operationId = newOperationId()
      setGenericBusy(true)
      setGenericResult(null)
      setWizardLoadError(null)
      try {
        setGenericResult(await api.awsResource!.execute(id, operationId, { ...genericRequest, confirmed: true }))
      } catch (error) {
        setWizardLoadError(error instanceof Error ? error.message : 'The modeled AWS operation failed.')
      } finally {
        setGenericBusy(false)
      }
    }
    if (!genericPreview.destructive) {
      void run()
      return
    }
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const rect = target?.getBoundingClientRect()
    openDestructiveGate({
      title: 'Run destructive AWS operation',
      description: 'This modeled AWS operation can permanently change or delete provider resources. Review the exact preview before authorizing it.',
      affected: [`${genericPreview.service} ${genericPreview.operation}`, genericPreview.profileName, genericPreview.region],
      confirmLabel: 'Run operation',
      anchor: rect ? { x: rect.left, y: rect.bottom } : undefined,
      restoreFocusEl: target,
      onConfirm: () => { void run() }
    })
  }

  useEffect(() => api.awsResource?.onProgress((item) => {
    if (item.nodeId === id) setGenericProgress(item)
  }), [api.awsResource, id])

  const choose = (entry: ShopCatalogEntry): void => {
    if (entry.available === false || !canvasId || !scope || !provider?.create || depth === null) return
    if (entry.id === 'aws-service') {
      if (!wizardServiceId || !wizardCommandName) {
        setWizardLoadError('Choose an AWS service and operation from the current model inventory first.')
        return
      }
      setChosen(entry.id)
      loadSelectedWizard()
      return
    }
    const result = requestUniverseShopCatalogCreation({
      canvasId,
      scope,
      depth,
      entryId: entry.id,
      creationEventId: newUniverseCreationEventId(),
      catalog: provider
    })
    if (!result.created) {
      setCreationError(result.reason ?? ts('universeShop.creation.refused', 'This catalog entry could not be created. Review its unavailable reason and try again.'))
      return
    }
    setCreationError(null)
    setChosen(entry.id)
    updateNodeData(id, { shopSelection: entry.id })
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
      <div className="shop-node__body">
        <p className="shop-node__description">{ts('universeShop.description', 'Choose a node to create in this universe. The catalog is scoped and stays local to this Shop.')}</p>
        {scope === 'aws-universe' && (
          <div className="shop-node__aws-wizard-entry">
            <label>Search AWS services
              <div className="shop-node__aws-wizard-search"><input ref={wizardServiceSearchRef} value={wizardServiceSearch.value} onChange={(event) => wizardServiceSearch.setValue(event.target.value)} /><AnchoredRegexBuilder search={wizardServiceSearch} fieldRef={wizardServiceSearchRef} label="Regex for AWS service search" zIndex={96} /></div>
            </label>
            <select value={wizardServiceId} onChange={(event) => setWizardServiceId(event.target.value)} aria-label="Choose AWS service">
              {visibleWizardServices.map((service) => <option key={service.id} value={service.id}>{service.label} ({service.id})</option>)}
            </select>
            <label>Search operations
              <div className="shop-node__aws-wizard-search"><input ref={wizardCommandSearchRef} value={wizardCommandSearch.value} onChange={(event) => wizardCommandSearch.setValue(event.target.value)} /><AnchoredRegexBuilder search={wizardCommandSearch} fieldRef={wizardCommandSearchRef} label="Regex for AWS operation search" zIndex={96} /></div>
            </label>
            <select value={wizardCommandName} onChange={(event) => setWizardCommandName(event.target.value)} aria-label="Choose AWS operation">
              {visibleWizardCommands.map((command) => <option key={command.name} value={command.name}>{command.name}</option>)}
            </select>
            <Button ref={wizardAnchorRef} type="button" variant="primary" disabled={!wizardServiceId || !wizardCommandName} onClick={loadSelectedWizard} title={!wizardServiceId || !wizardCommandName ? 'Choose an AWS service and operation from the current model inventory first.' : 'Open the typed AWS operation wizard'}>
              Open typed AWS operation wizard
            </Button>
            <span role="status">{wizardServices.length ? 'Uses the current installed AWS model inventory.' : 'Loading the current AWS model inventory.'}</span>
          </div>
        )}
        <div className="shop-node__search-row">
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
        <ul className="shop-node__entries" aria-label={ts('universeShop.entries.aria', 'Available catalog entries')}>
          {!scope || !canvasId || depth === null ? (
            <p className="shop-node__empty">{ts('universeShop.invalidScope', 'This Shop has incomplete universe scope metadata, so catalog creation is unavailable.')}</p>
          ) : !provider ? (
            <p className="shop-node__empty">{ts('universeShop.catalogUnavailable', 'The unified Node Catalog is unavailable in this build. Enable the catalog dependency before creating nodes.')}</p>
          ) : result.entries.length === 0 ? (
            <p className="shop-node__empty">{ts('universeShop.empty', 'No catalog entries match this search.')}</p>
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
                    ? ts(entry.disabledReasonKey ?? 'universeShop.entryUnavailable', entry.disabledReason ?? 'This catalog entry is unavailable until its executor is available.')
                    : ts(entry.descriptionKey, 'Catalog entry details')}
                >
                  <span className="shop-node__entry-label">{ts(entry.labelKey, 'Catalog entry')}</span>
                  <span className="shop-node__entry-kind">{entry.nodeKind}</span>
                  {entry.available === false && <span id={`${id}-entry-${entry.id}-note`} className="shop-node__entry-disabled">{ts(entry.disabledReasonKey ?? 'universeShop.entryUnavailable', entry.disabledReason ?? 'This catalog entry is unavailable until its executor is available.')}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
        {creationError && <p className="shop-node__creation-error" role="alert">{creationError}</p>}
        <p className="shop-node__hint">
          {chosen
            ? ts('universeShop.selected', '{entry} selected. Use the shared creation action to continue.', {
                entry: entries.find((entry) => entry.id === chosen)
                  ? ts(entries.find((entry) => entry.id === chosen)!.labelKey, 'Catalog entry')
                  : chosen
              })
            : ts('universeShop.hint', 'This Shop stays available as the one catalog entry point for this universe.')}
        </p>
      </div>
      {wizardOpen && wizardDefinition && (
        <AnchoredPopover anchorRef={wizardAnchorRef} open={wizardOpen} onClose={() => setWizardOpen(false)} width={1080} className="shop-node__aws-wizard-popover" zIndex={110}>
          <AwsOperationWizard
            definition={wizardDefinition}
            onCancel={() => setWizardOpen(false)}
            onSubmit={(value, portable) => {
              updateNodeData(id, { awsWizardIntent: portable.safeIntent })
              setWizardOpen(false)
              void prepareGenericOperation(value)
            }}
          />
        </AnchoredPopover>
      )}
      {genericPreview && (
        <section className="shop-node__aws-preview" aria-label="AWS operation preview">
          <h3>Execution preview</h3>
          <dl>
            <div><dt>Service</dt><dd>{genericPreview.service}</dd></div>
            <div><dt>Operation</dt><dd>{genericPreview.operation}</dd></div>
            <div><dt>Profile</dt><dd>{genericPreview.profileName}</dd></div>
            <div><dt>Region</dt><dd>{genericPreview.region}</dd></div>
            <div><dt>Risk</dt><dd>{genericPreview.risk}</dd></div>
            <div><dt>Pagination</dt><dd>{genericPreview.pagination}</dd></div>
          </dl>
          <pre>{genericPreview.argv.join(' ')}</pre>
          <div className="shop-node__aws-actions">
            <Button type="button" variant="primary" disabled={genericBusy} onClick={runGenericOperation}>Run modeled operation</Button>
            {genericProgress?.phase === 'started' && api.awsResource && <Button type="button" onClick={() => void api.awsResource!.cancel(genericProgress.operationId)}>Cancel operation</Button>}
          </div>
          {genericProgress && <p role="status">{genericProgress.phase}: {genericProgress.message}</p>}
          {genericResult && <div role="status"><p>{genericResult.summary}</p><pre>{JSON.stringify(genericResult.rows.slice(0, 20), null, 2)}</pre></div>}
        </section>
      )}
      {wizardError && <p className="shop-node__creation-error" role="alert">{wizardError}</p>}
    </div>
  )
}

export default ShopNode
