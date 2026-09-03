import { describe, expect, it } from 'vitest'

import { timerAlarmBody } from './TimerNode'

describe('TimerNode personal vocabulary boundary', () => {
  it('maps authored silent-alarm copy while preserving alarm tone facts', () => {
    const map = (value: string): string => value.replace('Alarm is silent.', 'Alarm is quiet.')

    expect(timerAlarmBody('silent', map)).toBe('Alarm is quiet.')
    expect(timerAlarmBody('bell', map)).toBe('Alarm tone: bell.')
  })
})
