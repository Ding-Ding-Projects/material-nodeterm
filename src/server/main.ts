import { resolveConfig } from './config'
import { assertSupportedNodeRuntime } from '../core/node-runtime'

/**
 * Script entry point for the headless server. Kept separate from index.ts so that
 * `index.ts` stays side-effect-free (importable by tests without booting a server).
 */
// Last-resort loggers: a stray throw/rejection anywhere in the process should be
// logged, not silently exit the server (which would tear down every session's pty).
process.on('uncaughtException', (e) => console.error('[nodeterm-server] uncaughtException', e))
process.on('unhandledRejection', (e) => console.error('[nodeterm-server] unhandledRejection', e))

async function main(): Promise<void> {
  assertSupportedNodeRuntime()
  // Keep the service graph behind the runtime gate. In the bundled server, node-pty is a native
  // external; importing index.ts statically would load that ABI before an old Node reached the
  // actionable SQLite/version diagnostic.
  const { startServer } = await import('./index')
  const config = resolveConfig(process.env, process.argv.slice(2))
  const { port, close } = await startServer(config)
  // Headless binds no listener, so there is nothing to announce as "listening" (startServer already
  // logged the headless line). Only print the address in normal serving mode.
  if (!config.headless) {
    const scheme = config.insecureHttp ? 'http (insecure)' : 'http'
    console.log(`nodeterm-server listening on ${scheme} ${config.host}:${port}`)
  }

  const shutdown = (signal: string): void => {
    console.log(`\nReceived ${signal}, shutting down…`)
    void close().then(
      () => process.exit(0),
      (err) => {
        console.error('Error during shutdown:', err)
        process.exit(1)
      }
    )
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
