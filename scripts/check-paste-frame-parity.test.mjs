import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { checkPasteFrameParity, sharedContractProblems } from './check-paste-frame-parity.mjs'

const sanitizer = (value) => value.replace(/[\x1b\u009b]/g, '')
const sibling = {
  PASTE_START: '\x1b[200~',
  PASTE_END: '\x1b[201~',
  sanitizePasteText: sanitizer,
  bracketedInjection: () => '',
  legacyInjection: () => ({ text: '', enter: '' })
}

describe('check-paste-frame-parity', () => {
  it('accepts the shared sanitizer contract while allowing the intentional tmux-incompatible framers only in the sibling', () => {
    expect(sharedContractProblems({ PASTE_START: '\x1b[200~', PASTE_END: '\x1b[201~', sanitizePasteText: sanitizer }, sibling)).toEqual([])
  })

  it('goes red when the vendored sanitizer leaves a bracketed-paste control byte behind', () => {
    const unsafe = (value) => value.replace(/\u009b/g, '')
    expect(sharedContractProblems({ PASTE_START: '\x1b[200~', PASTE_END: '\x1b[201~', sanitizePasteText: unsafe }, sibling)).toContain('sanitizePasteText differs for payload "\\u001b[200~nested\\u001b[201~"')
  })

  it('goes red against an explicit TypeScript source fixture when the local sanitizer drifts', async () => {
    const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'paste-frame-parity-'))
    const localPath = path.join(fixtureDir, 'local.ts')
    const siblingPath = path.join(fixtureDir, 'sibling.ts')
    const common = `export const PASTE_START = '\\x1b[200~'\nexport const PASTE_END = '\\x1b[201~'\n`
    try {
      await writeFile(localPath, `${common}export function sanitizePasteText(value: string) { return value.replace(/\\u009b/g, '') }\n`)
      await writeFile(siblingPath, `${common}export function sanitizePasteText(value: string) { return value.replace(/[\\x1b\\u009b]/g, '') }\nexport function bracketedInjection() { return '' }\nexport function legacyInjection() { return { text: '', enter: '' } }\n`)
      const result = await checkPasteFrameParity({ localPath, siblingPath })
      expect(result.problems).toContain('sanitizePasteText differs for payload "\\u001b[200~nested\\u001b[201~"')
    } finally {
      await rm(fixtureDir, { recursive: true, force: true })
    }
  })
})
