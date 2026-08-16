import { spawn } from 'node:child_process'
import { app } from 'electron'
import { beginDesktopStartup } from './squirrel-startup'

beginDesktopStartup(
  {
    argv: process.argv,
    platform: process.platform,
    execPath: process.execPath,
    quit: () => app.quit(),
    spawn: (command, args, options) => spawn(command, args, options)
  },
  // Keep this import dynamic: lifecycle processes must never evaluate the main application graph.
  () => void import('./index')
)
