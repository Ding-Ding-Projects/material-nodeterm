import { app } from 'electron'
import {
  publicDesktopBootstrapFailure,
  runDesktopStartup,
  type SquirrelLifecycleEvent
} from './squirrel-lifecycle'

function reportLifecycleFailure(event: SquirrelLifecycleEvent): void {
  // Lifecycle child-process errors can contain usernames and install paths. Keep the public log
  // useful but deliberately limited to the trusted event category.
  console.error(`[startup] Squirrel.Windows ${event} action failed.`)
}

void runDesktopStartup({
  platform: process.platform,
  argv: process.argv,
  executablePath: process.execPath,
  loadNormalBootstrap: () => import('./index'),
  exit: (code) => app.exit(code),
  reportLifecycleFailure
}).catch((error: unknown) => {
  // The ordinary bootstrap historically terminated on an uncaught module-load error. Preserve
  // that fail-closed behavior without printing an exception that may contain private local paths.
  console.error(publicDesktopBootstrapFailure(error))
  app.exit(1)
})
