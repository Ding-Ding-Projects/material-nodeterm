import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CO_ATTACH_ALT_SCREEN_SEQ } from './terminal-config'

const src = (rel: string) =>
  readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n')

describe('co-attach joiner alternate screen', () => {
  it('is the DECSET 1049 enable', () => {
    expect(CO_ATTACH_ALT_SCREEN_SEQ).toBe('\x1b[?1049h')
  })

  // Entering the alternate buffer CLEARS the display: the sequence must be written before the
  // captured screen is painted, or it erases the paint.
  for (const file of ['nodes/TerminalNode.tsx', 'components/kanban/ModalTerminal.tsx']) {
    it(`${file} writes it before painting the joiner screen`, () => {
      const s = src(file)
      const alt = s.indexOf('term.write(CO_ATTACH_ALT_SCREEN_SEQ)')
      const paint = s.indexOf('toXtermText(stripTrailingNewline(')
      expect(alt).toBeGreaterThan(-1)
      expect(paint).toBeGreaterThan(-1)
      expect(alt).toBeLessThan(paint)
    })
  }
})
