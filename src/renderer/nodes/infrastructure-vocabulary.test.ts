import { describe, expect, it } from 'vitest'
import { RECOVERY_CORE, RECOVERY_ENERGY_KEYS, createRecoveryGameSnapshot } from '@shared/recovery-game'
import { pointLabel, recoveryMeta } from './RecoveryGameNode'
import { valueText } from './WindowsDiagnosticsNode'

describe('infrastructure node vocabulary fact boundaries', () => {
  it('keeps recovery coordinates, point labels, and counts exact while mapping authored labels', () => {
    const snapshot = { ...createRecoveryGameSnapshot(), player: { ...RECOVERY_CORE }, energizedKeys: [...RECOVERY_ENERGY_KEYS], hazardHits: 12, coreActivated: false }
    const map = (value: string): string => value === 'Hazard contacts:' ? 'Hazard tally:' : value

    expect(pointLabel(RECOVERY_CORE, snapshot)).toBe('Column 5, row 4, player, activation core')
    expect(recoveryMeta(snapshot, map)).toBe('Hazard tally: 12. Energized keys: 3 of 3.')
  })

  it('keeps diagnostics values factual, including numeric units and missing state', () => {
    expect(valueText(1_048_576)).toBe('1,048,576')
    expect(valueText('C:\\Program Files\\Tool')).toBe('C:\\Program Files\\Tool')
    expect(valueText(null)).toBe('Not reported')
  })
})
