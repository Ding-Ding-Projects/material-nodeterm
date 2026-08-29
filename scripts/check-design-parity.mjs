#!/usr/bin/env node

/**
 * Fail-closed source guard for the ten checked-in v2 design references.
 *
 * This guard checks the inventory itself, not merely rows it discovers. Runtime receipts may be
 * pending, but every screen, route, deterministic tuple, audit link, evidence path, and approval
 * field must be present before a runtime parity run can begin.
 */
import {
  loadDesignParityInventory,
  loadDesignParityReceiptManifest,
  runDesignParitySelfTest,
  validateDesignParityInventory,
  validateDesignParityReceipts,
} from './design-parity-receipt.mjs'

function main(argv) {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== '--self-test')) {
    throw new Error('usage: node scripts/check-design-parity.mjs [--self-test]')
  }
  if (argv[0] === '--self-test') {
    const result = runDesignParitySelfTest()
    console.log(`design parity guard self-test: red then green for ${result.mutations} exact mutations`)
    return
  }
  const inventory = loadDesignParityInventory()
  const inventoryResult = validateDesignParityInventory(inventory)
  const receipts = loadDesignParityReceiptManifest()
  const receiptResult = validateDesignParityReceipts(receipts, inventory)
  console.log(`design parity guard: ${inventoryResult.screens} exact design references declared`)
  console.log(`design parity receipts: ${receiptResult.verified} verified, ${receiptResult.pending} pending-runtime`)
  if (receiptResult.pending > 0) {
    console.log('runtime parity is not yet verified; no capture or comparison claim is made')
  }
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(`check-design-parity: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
