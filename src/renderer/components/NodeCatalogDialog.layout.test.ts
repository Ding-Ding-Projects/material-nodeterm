import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(__dirname, '..', 'styles.md3.css'), 'utf8').replace(/\r\n/g, '\n')

function rule(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = CSS.indexOf('\n}', start)
  expect(end).toBeGreaterThan(start)
  return CSS.slice(start, end)
}

describe('Node Catalog layout containment', () => {
  it('keeps fixed dialog sections non-shrinking and the result list flexible', () => {
    const dialog = rule('.mdx-dialog.node-catalog-dialog')
    const list = rule('.node-catalog-dialog__list')
    const profiles = rule('.node-catalog-dialog__profiles')
    expect(dialog).toMatch(/min-height:\s*0/)
    expect(dialog).toMatch(/overflow:\s*hidden/)
    expect(list).toMatch(/flex:\s*1 1 auto/)
    expect(list).toMatch(/min-height:\s*0/)
    expect(list).toMatch(/overflow-y:\s*auto/)
    expect(profiles).toMatch(/flex-shrink:\s*0|flex:\s*0 0 auto/)
    expect(profiles).toMatch(/max-height:\s*132px/)
    expect(profiles).toMatch(/overflow-y:\s*auto/)
  })

  it('keeps every result row from shrinking its bilingual content', () => {
    const row = rule('.node-catalog-dialog__row')
    expect(row).toMatch(/flex:\s*0 0 auto/)
    expect(row).toMatch(/min-width:\s*0/)
  })
})
