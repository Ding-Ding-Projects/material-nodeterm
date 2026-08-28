import { app, dialog } from 'electron'
import {
  desktopBootstrapFailureDialog,
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
  // This entry is deliberately smaller than the application graph, so it can still show a useful
  // native recovery dialog when a packaged runtime module is missing. Neither the log nor dialog
  // serializes the original exception, whose message may contain private local paths.
  console.error(publicDesktopBootstrapFailure(error))
  const failure = desktopBootstrapFailureDialog(error)
  try {
    dialog.showErrorBox(failure.title, failure.content)
  } catch {
    // The sanitized stderr line above remains available when the operating system cannot show UI.
  }
  app.exit(1)
})
