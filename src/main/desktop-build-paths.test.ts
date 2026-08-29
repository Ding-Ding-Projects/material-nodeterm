import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { desktopBuildPaths } from './desktop-build-paths'

describe('desktopBuildPaths', () => {
  it('resolves the main window, HUD, and unpackaged icon from the emitted main chunk boundary', () => {
    const appRoot = resolve('fixture-app')
    const mainChunkDir = join(appRoot, 'out', 'main')

    expect(desktopBuildPaths(mainChunkDir)).toEqual({
      mainPreload: join(appRoot, 'out', 'preload', 'index.js'),
      mainRenderer: join(appRoot, 'out', 'renderer', 'index.html'),
      hudPreload: join(appRoot, 'out', 'preload', 'hud.js'),
      hudRenderer: join(appRoot, 'out', 'renderer', 'hud.html'),
      devIcon: join(appRoot, 'build', 'icon.png')
    })
  })

  it('rejects Vite\'s nested chunks layout instead of opening a window without its bridge', () => {
    const nestedChunkDir = resolve('fixture-app', 'out', 'main', 'chunks')

    expect(() => desktopBuildPaths(nestedChunkDir)).toThrow(/directly in out[\\/]main/)
  })
})
