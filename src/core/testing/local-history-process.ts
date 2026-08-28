// Real child-process fixture for local-history's cross-process transaction gates. Vitest bundles
// this entry with esbuild, then launches two ordinary Node processes against one data directory.

import { promises as fs } from 'node:fs'
import { LocalHistoryStore, runLocalHistoryGit, type LocalHistoryGit } from '../local-history'

function arg(name: string): string {
  const prefix = `--${name}=`
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length)
  if (value === undefined) throw new Error(`Missing ${prefix}<value>`)
  return value
}

async function waitFor(path: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      await fs.stat(path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${path}`)
}

function gatedGit(): LocalHistoryGit {
  const entered = process.env.LOCAL_HISTORY_ENTERED
  const release = process.env.LOCAL_HISTORY_RELEASE
  const crash = process.env.LOCAL_HISTORY_CRASH === '1'
  let gated = false
  return async (cwd, args, options) => {
    if (
      !gated &&
      entered &&
      args[0] === 'update-ref' &&
      args[1]?.startsWith('refs/heads/')
    ) {
      gated = true
      await fs.writeFile(entered, JSON.stringify({ pid: process.pid }), {
        encoding: 'utf-8',
        mode: 0o600,
        flag: 'wx'
      })
      if (crash) process.exit(91)
      if (!release) throw new Error('The gate release path is missing.')
      await waitFor(release)
    }
    return runLocalHistoryGit(cwd, args, options)
  }
}

async function main(): Promise<void> {
  const mode = arg('mode')
  const root = arg('root')
  const store = new LocalHistoryStore(root, gatedGit())
  if (mode === 'record') {
    await store.record({
      domain: 'settings',
      filename: 'settings.json',
      content: arg('content'),
      label: arg('label'),
      action: 'updated'
    })
    process.stdout.write(JSON.stringify({ ok: true }))
    return
  }
  if (mode === 'list') {
    process.stdout.write(JSON.stringify(await store.list('settings')))
    return
  }
  if (mode === 'restore') {
    process.stdout.write(
      JSON.stringify(await store.restoreContent('settings', arg('sha'), 'settings.json'))
    )
    return
  }
  throw new Error(`Unknown mode: ${mode}`)
}

void main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
