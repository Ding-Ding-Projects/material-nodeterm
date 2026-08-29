import { describe, expect, it } from 'vitest'
import {
  loadDesignParityInventory,
  loadDesignParityReceiptManifest,
  runDesignParitySelfTest,
  validateDesignParityInventory,
  validateDesignParityReceipts,
} from './design-parity-receipt.mjs'

describe('design parity inventory and receipts', () => {
  it('accepts exactly ten checked-in references with pending runtime receipts', () => {
    const inventory = loadDesignParityInventory()
    const receipts = loadDesignParityReceiptManifest()
    expect(validateDesignParityInventory(inventory).screens).toBe(10)
    expect(validateDesignParityReceipts(receipts, inventory)).toMatchObject({ receipts: 10, verified: 0, pending: 10 })
  })

  it('proves every exact inventory boundary turns red and then green again', () => {
    expect(runDesignParitySelfTest()).toEqual({ mutations: 16, restored: true })
  })

  it.each([
    ['renamed id', (copy) => { copy.screens[0].id = 'md3-canvas-renamed' }],
    ['descendant reference path', (copy) => { copy.screens[0].referenceFile = 'design/v2/MD3 Canvas.dc.html/child' }],
    ['missing comparison path', (copy) => { delete copy.screens[0].labelledComparison }],
  ])('rejects an exact-boundary mutation: %s', (_label, mutate) => {
    const inventory = loadDesignParityInventory()
    mutate(inventory)
    expect(() => validateDesignParityInventory(inventory)).toThrow()
  })

  it('rejects a pending receipt that claims one captured side', () => {
    const inventory = loadDesignParityInventory()
    const receipts = loadDesignParityReceiptManifest()
    receipts.receipts[0].referenceCaptured = true
    expect(() => validateDesignParityReceipts(receipts, inventory)).toThrow()
  })
})
