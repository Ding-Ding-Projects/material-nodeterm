import { describe, expect, it } from 'vitest'
import {
  NODE_CATALOG,
  NODE_CATALOG_COMPLETENESS,
  nodeCatalogAvailability,
  searchNodeCatalog,
  validateNodeCatalogCompleteness
} from './node-catalog'

describe('unified node catalog contract', () => {
  it('covers the hand-written current, ephemeral, and planned inventory', () => {
    expect(validateNodeCatalogCompleteness()).toEqual([])
    expect(NODE_CATALOG_COMPLETENESS.length).toBeGreaterThan(30)
    for (const entry of NODE_CATALOG) {
      expect(entry.documentationPath).toMatch(/^docs\//)
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('turns duplicate, unscoped, planned, and wrong-scope mutations red', () => {
    const entry = NODE_CATALOG[0]
    expect(validateNodeCatalogCompleteness([...NODE_CATALOG, entry])).toContain(`duplicate catalog id: ${entry.id}`)
    expect(validateNodeCatalogCompleteness([...NODE_CATALOG, { ...entry, id: 'not-in-inventory' }])).toContain('unscoped catalog id: not-in-inventory')
    const planned = NODE_CATALOG.find((candidate) => candidate.status === 'planned')!
    expect(validateNodeCatalogCompleteness(NODE_CATALOG.filter((candidate) => candidate.id !== planned.id))).toContain(`missing catalog id: ${planned.id}`)
    expect(validateNodeCatalogCompleteness(NODE_CATALOG.map((candidate) => candidate.id === planned.id ? { ...candidate, status: 'available' } : candidate))).toContain(`planned row is not disabled: ${planned.id}`)
    const scoped = NODE_CATALOG.find((candidate) => candidate.scope === 'multiverse')!
    expect(validateNodeCatalogCompleteness(NODE_CATALOG.map((candidate) => candidate.id === scoped.id ? { ...candidate, scope: 'aws-universe' } : candidate))).toContain(`wrong catalog scope: ${scoped.id}`)
  })

  it('keeps disabled reasons and local search truthful', () => {
    const planned = NODE_CATALOG.find((candidate) => candidate.status === 'planned')!
    const availability = nodeCatalogAvailability(planned, {
      sessionSource: 'local', hasProjectFolder: true, isSshProject: false, hasRemoteConnection: false,
      supportsWindowsTerminalProfiles: true, universeScope: 'root', universeDepth: 0, hasShopNode: false
    })
    expect(availability.available).toBe(false)
    expect(availability.reason).toContain('planned')
    expect(searchNodeCatalog(NODE_CATALOG, 'terminal').length).toBeGreaterThan(0)
    expect(searchNodeCatalog(NODE_CATALOG, 'terminal', (value) => /remote/i.test(value)).map((item) => item.id)).toContain('remote-terminal')
  })
})
