// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ShopNode from './ShopNode'
import { registerUniverseShopCatalog } from '../../core/universe-shop'
import { UNIVERSE_SHOP_CATALOG_PROVIDER } from '../state/universeShopCatalogProvider'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@xyflow/react', () => ({
  NodeResizer: () => null,
  useReactFlow: () => ({
    updateNodeData: vi.fn(),
    getNode: () => ({ position: { x: 24, y: 36 } })
  })
}))

vi.mock('../lib/personalVocabulary/useLocalizedVocabularyText', () => ({
  useLocalizedVocabularyText: () => (key: string, fallback: string, values?: Record<string, string>) =>
    values ? fallback.replace('{scope}', values.scope ?? '').replace('{count}', values.count ?? '').replace('{entry}', values.entry ?? '') : fallback
}))

vi.mock('../session/session', () => ({ useActiveSessionApi: () => ({}) }))
vi.mock('../lib/appearance/registry', () => ({ appearanceId: (_kind: string, id: string) => `appearance-${id}` }))
vi.mock('../lib/nodeColor', () => ({ nodeBorderStyle: () => ({ style: {} }), nodeColorStyle: () => ({ className: '', style: {} }) }))

describe('ShopNode runtime surface', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    registerUniverseShopCatalog(UNIVERSE_SHOP_CATALOG_PROVIDER)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    registerUniverseShopCatalog(null)
  })

  it('renders scoped entries, a valid list, and the anchored regex affordance', () => {
    act(() => root.render(<ShopNode {...({ id: 'shop-mv', data: { title: 'Shop', color: '#6750a4', group: null, universeCanvasId: 'mv', universeScope: 'multiverse', universeDepth: 1 }, selected: false, type: 'shop', xPos: 0, yPos: 0, zIndex: 0 } as any)} />))
    expect(host.querySelector('[data-universe-shop="true"]')).not.toBeNull()
    expect(host.querySelector('input[type="search"]')).not.toBeNull()
    expect(host.querySelector('.md3-regex-trigger')).not.toBeNull()
    expect(host.querySelectorAll('ul.shop-node__entries > li').length).toBeGreaterThan(0)
  })

  it('keeps malformed scope visible with an honest empty li instead of creating', () => {
    act(() => root.render(<ShopNode {...({ id: 'shop-bad', data: { title: 'Shop', color: '#6750a4', group: null, universeCanvasId: 'bad', universeScope: 'multiverse', universeDepth: 0 }, selected: false, type: 'shop', xPos: 0, yPos: 0, zIndex: 0 } as any)} />))
    expect(host.querySelector('ul.shop-node__entries > li[role="status"]')).not.toBeNull()
  })
})
