import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { evaluate, readAllowlist, scanRawControls } from '../../../../scripts/check-md3-controls.mjs'

describe('raw form-control guard (scripts/check-md3-controls.mjs)', () => {
  it('flags a raw control and ignores a commented one', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'md3-guard-'))
    mkdirSync(path.join(root, 'a'))
    writeFileSync(path.join(root, 'a', 'Raw.tsx'), 'export const X = () => <button type="button">x</button>\n')
    writeFileSync(path.join(root, 'a', 'Clean.tsx'), '// <button> only in a comment\nexport const Y = () => <Button>y</Button>\n')
    writeFileSync(path.join(root, 'a', 'Skipped.test.tsx'), 'export const Z = () => <input />\n')
    const found = scanRawControls(root)
    expect(found.some((file: string) => file.endsWith('a/Raw.tsx'))).toBe(true)
    expect(found.some((file: string) => file.endsWith('a/Clean.tsx'))).toBe(false)
    expect(found.some((file: string) => file.endsWith('Skipped.test.tsx'))).toBe(false)
  })

  it('reports new offenders and stale allowlist entries separately', () => {
    expect(evaluate(['a.tsx', 'b.tsx'], ['a.tsx', 'c.tsx'])).toEqual({ newOffenders: ['b.tsx'], stale: ['c.tsx'] })
  })

  it('the committed allowlist matches the tree exactly — it may only shrink', () => {
    const { newOffenders, stale } = evaluate(scanRawControls(), readAllowlist())
    expect(newOffenders).toEqual([])
    expect(stale).toEqual([])
  })
})
