import { describe, expect, it } from 'vitest'
import type { AppLogoCustomImage } from '@shared/types'
import { LogoProcessGeneration, selectLogoPreset } from './logoSelection'

const custom: AppLogoCustomImage = {
  dataUrl: 'data:image/png;base64,custom',
  mime: 'image/png',
  width: 512,
  height: 512,
  sourceName: 'kept.png',
  fit: 'contain',
  backgroundColor: '#00000000',
  crop: { x: 0, y: 0, width: 1, height: 1 }
}

describe('selectLogoPreset', () => {
  it('retains the processed custom image while a shipped preset is visible', () => {
    expect(selectLogoPreset({ selection: 'custom', customImage: custom }, 'ocean')).toEqual({
      selection: 'ocean',
      customImage: custom
    })
  })

  it('does not invent an absent custom-image field', () => {
    expect(selectLogoPreset({ selection: 'shipped' }, 'ember')).toEqual({ selection: 'ember' })
  })
})

describe('LogoProcessGeneration', () => {
  it('lets only the newest out-of-order completion commit', async () => {
    const guard = new LogoProcessGeneration()
    const commits: string[] = []
    let resolveOld!: (value: string) => void
    let resolveNew!: (value: string) => void
    const old = new Promise<string>((resolve) => { resolveOld = resolve })
    const newest = new Promise<string>((resolve) => { resolveNew = resolve })

    const oldGeneration = guard.begin()
    const oldCompletion = old.then((value) => {
      if (guard.owns(oldGeneration)) commits.push(value)
    })
    const newGeneration = guard.begin()
    const newCompletion = newest.then((value) => {
      if (guard.owns(newGeneration)) commits.push(value)
    })

    resolveNew('newest')
    await newCompletion
    resolveOld('old')
    await oldCompletion
    expect(commits).toEqual(['newest'])
  })

  it('invalidates an in-flight completion when a synchronous preset wins', () => {
    const guard = new LogoProcessGeneration()
    const upload = guard.begin()
    guard.cancel()
    expect(guard.owns(upload)).toBe(false)
  })
})
