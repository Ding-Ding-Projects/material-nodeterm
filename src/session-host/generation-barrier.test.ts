import { describe, expect, it } from 'vitest'
import {
  currentSessionAfterRetirement,
  retireSessionGeneration,
  type RetiringSessionGeneration
} from './generation-barrier'

interface Generation extends RetiringSessionGeneration {
  subscribers: Array<(frame: string) => void>
}

describe('same-name session generation barrier', () => {
  it('publishes the old data and exit before a replacement can attach to that wire name', async () => {
    let releaseOutput!: () => void
    const outputBarrier = new Promise<void>((resolve) => {
      releaseOutput = resolve
    })
    let replacementAttached = false
    const oldFrames: string[] = []
    const replacementFrames: string[] = []
    // The same transport socket can issue the replacement attach. Because frames carry only the
    // session name, anything arriving after that attach would be interpreted as replacement data.
    const sharedSocket = (frame: string): void => {
      if (replacementAttached) replacementFrames.push(frame)
      else oldFrames.push(frame)
    }
    const old: Generation = { exited: true, ending: null, subscribers: [sharedSocket] }
    const sessions = new Map<string, Generation>([['same-name', old]])

    old.ending = retireSessionGeneration(sessions, 'same-name', old, async () => {
      await outputBarrier
      for (const subscriber of old.subscribers) subscriber('old-data')
      for (const subscriber of old.subscribers) subscriber('old-exit')
    }).then(() => {})

    const attachReplacement = (async () => {
      const active = await currentSessionAfterRetirement(sessions, 'same-name')
      expect(active).toBeUndefined()
      const replacement: Generation = {
        exited: false,
        ending: null,
        subscribers: [sharedSocket]
      }
      sessions.set('same-name', replacement)
      replacementAttached = true
      return replacement
    })()

    await Promise.resolve()
    const attachedBeforeOutputRelease = replacementAttached
    const generationBeforeOutputRelease = sessions.get('same-name')

    releaseOutput()
    const replacement = await attachReplacement

    expect(replacementFrames).toEqual([])
    expect(oldFrames).toEqual(['old-data', 'old-exit'])
    expect(attachedBeforeOutputRelease).toBe(false)
    expect(generationBeforeOutputRelease).toBe(old)
    expect(sessions.get('same-name')).toBe(replacement)
  })
})
