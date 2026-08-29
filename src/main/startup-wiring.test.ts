import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import electronViteConfig from '../../electron.vite.config'

describe('desktop main entry wiring', () => {
  it('emits index.js from the early lifecycle router rather than the normal bootstrap', () => {
    const config = electronViteConfig as {
      main?: {
        build?: {
          rollupOptions?: {
            input?: Record<string, string>
            output?: { entryFileNames?: string }
          }
        }
      }
    }

    // The main build also carries an independent 'codex-relay' entry point (the codex relay
    // daemon, src/main/codex-relay-daemon.ts) alongside the Squirrel lifecycle router this test
    // is about. Both are real, intentional inputs — assert the full set rather than just 'index'
    // so a future entry silently reintroduces the same drift this one already caused once.
    expect(config.main?.build?.rollupOptions?.input).toEqual({
      index: resolve(__dirname, 'startup.ts'),
      'codex-relay': resolve(__dirname, 'codex-relay-daemon.ts')
    })
    expect(config.main?.build?.rollupOptions?.output?.entryFileNames).toBe('[name].js')
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf8')
    ) as { main?: unknown }
    expect(packageJson.main).toBe('./out/main/index.js')
    expect(config.main?.build?.rollupOptions?.input?.index).toBe(resolve(__dirname, 'startup.ts'))
  })
})
