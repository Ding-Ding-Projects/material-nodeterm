import type { ProjectCanvasState, CanvasNodeState } from '@shared/types'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'

export interface UniverseCanvasViewProps {
  canvas: ProjectCanvasState
  nodes: readonly CanvasNodeState[]
  onExit: () => void
  onOpenCatalog: () => void
}

/** A real child-canvas view. The parent Canvas owns routing and persistence; this view renders the
 * child title, scope, membership and its fixed Shop without pretending the root is still active. */
export function UniverseCanvasView({ canvas, nodes, onExit, onOpenCatalog }: UniverseCanvasViewProps): JSX.Element {
  const ts = useLocalizedVocabularyText()
  const members = new Set(canvas.nodeIds)
  const childNodes = nodes.filter((node) => members.has(node.id))
  const shop = childNodes.find((node) => node.kind === 'shop')
  return (
    <section className="universe-canvas-view" role="region" aria-label={ts('universeCanvas.aria', '{title} canvas', { title: canvas.title })}>
      <header className="universe-canvas-view__header">
        <button type="button" className="sc-btn" onClick={onExit} aria-label={ts('universeCanvas.return.aria', 'Return to root canvas')}>← {ts('universeCanvas.root', 'Root canvas')}</button>
        <div>
          <h2>{canvas.title}</h2>
          <p>{canvas.scope === 'aws-universe' ? ts('universeShop.scope.aws', 'AWS Universe') : ts('universeShop.scope.multiverse', 'Multiverse')} · {ts('universeCanvas.depth', 'depth {depth}', { depth: String(canvas.depth) })}</p>
        </div>
      </header>
      <div className="universe-canvas-view__body">
        {shop ? <article className="universe-canvas-view__shop" data-universe-shop-id={shop.id}><h3>{ts('universeShop.title', 'Shop')}</h3><p>{ts('universeCanvas.shopDescription', 'Use this universe\'s scoped Node Catalog to create nodes here.')}</p><p>{ts('universeCanvas.members', '{count} members', { count: String(childNodes.length) })}</p><button type="button" className="sc-btn" onClick={onOpenCatalog}>{ts('universeCanvas.openCatalog', 'Open scoped catalog')}</button></article> : <p role="status">{ts('universeCanvas.missingShop', 'This child canvas has no Shop yet. Repair the canvas projection before creating nodes.')}</p>}
      </div>
    </section>
  )
}
