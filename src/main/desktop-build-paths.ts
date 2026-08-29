import { basename, dirname, join } from 'path'

export interface DesktopBuildPaths {
  mainPreload: string
  mainRenderer: string
  hudPreload: string
  hudRenderer: string
  devIcon: string
}

/**
 * Resolve every Desktop build output whose location is anchored to the emitted main chunk.
 *
 * The Squirrel bootstrap deliberately imports the application graph lazily. Rollup therefore
 * emits this module as a dynamic chunk, and Electron's preload/renderer paths are only correct
 * while that chunk remains directly in out/main. Refuse a nested chunk explicitly: otherwise the
 * app opens a blank page with no preload bridge and looks like a renderer failure.
 */
export function desktopBuildPaths(mainChunkDir: string): DesktopBuildPaths {
  if (basename(mainChunkDir) !== 'main' || basename(dirname(mainChunkDir)) !== 'out') {
    throw new Error(`Desktop application chunks must be emitted directly in out/main; got ${mainChunkDir}`)
  }

  return {
    mainPreload: join(mainChunkDir, '../preload/index.js'),
    mainRenderer: join(mainChunkDir, '../renderer/index.html'),
    hudPreload: join(mainChunkDir, '../preload/hud.js'),
    hudRenderer: join(mainChunkDir, '../renderer/hud.html'),
    devIcon: join(mainChunkDir, '../../build/icon.png')
  }
}
