import type { NativeCopyProjection, NativeCopySlot, NativeSegment } from '../../../shared/native-copy-projection'
import { SHIPPED_APP_NAME, resolveAppDisplayName } from '../../../shared/appIdentity'

/** Options shared by the desktop file and folder picker adapters. */
export interface NativePickerOptions {
  title?: string
  buttonLabel?: string
  filters?: readonly { name: string; extensions: readonly string[] }[]
  [key: string]: unknown
}

/** Map only prose-owned picker labels. Extensions, paths, and all other options remain exact. */
export function mapNativePickerOptions<T extends NativePickerOptions>(
  options: T,
  map: (text: string) => string
): T {
  return {
    ...options,
    ...(typeof options.title === 'string' ? { title: map(options.title) } : {}),
    ...(typeof options.buttonLabel === 'string' ? { buttonLabel: map(options.buttonLabel) } : {}),
    ...(options.filters
      ? {
          filters: options.filters.map((filter) => ({
            ...filter,
            name: map(filter.name),
            extensions: [...filter.extensions]
          }))
        }
      : {})
  } as T
}

const DEFAULT_NATIVE_COPY: Record<NativeCopySlot, string> = {
  'app.displayName': SHIPPED_APP_NAME,
  'menu.file': 'File',
  'menu.edit': 'Edit',
  'menu.view': 'View',
  'menu.window': 'Window',
  'menu.settings': 'Settings',
  'menu.snapToGrid': 'Snap to Grid',
  'menu.fitView': 'Fit View',
  'menu.toggleKanban': 'Toggle Kanban Board',
  'menu.quit': 'Quit',
  'quit.title': 'Quit nodeterm?',
  'quit.message': 'Quit nodeterm?',
  'quit.cancel': 'Cancel',
  'quit.confirm': 'Quit',
  'quit.detail.prefix': "One or more terminals here aren't using a persistent session, so quitting will end whatever is running in them right now. ",
  'quit.detail.suffix': 'Terminals using tmux or the session host will still be here next time you open nodeterm.',
  'update.available': 'Update available',
  'update.ready': 'Update ready',
  'update.ready.suffix': 'is ready to install.',
  'update.ready.fallback': 'An update is ready to install.',
  'update.restart': 'Restart to update',
  'update.later': 'Later',
  'alarm.title': 'Alarm',
  'alarm.missed.suffix': 'was missed while the app or computer was unavailable.',
  'alarm.due.suffix': 'is due now. This app cannot wake a powered-off computer.',
  'archive.picker.title': 'Choose a project archive',
  'archive.picker.button': 'Open archive',
  'archive.picker.filter': 'nodeterm project file',
  'archive.destination.prefix': 'Choose an EMPTY folder for ',
  'archive.destination.fallback': 'the imported project',
  'archive.destination.button': 'Import here',
  'icon.picker.title': 'Choose a project icon',
  'icon.picker.button': 'Choose icon',
  'icon.picker.filter': 'Images',
  'standing-host.title': 'Standing host',
  'standing-host.body': 'This host is available for paired devices.'
}

/** Construct a complete projection from already-mapped renderer-owned strings. */
export function nativeCopyProjection(
  epoch: number,
  map: (text: string) => string,
  options: { appDisplayName?: string | null } = {}
): NativeCopyProjection {
  return {
    protocol: 1,
    epoch,
    entries: (Object.keys(DEFAULT_NATIVE_COPY) as NativeCopySlot[]).map((slot) => ({
      slot,
      segments: [{
        kind: 'copy',
        // A user rename is already an explicit display value, not app-authored copy. Preserve it
        // byte-for-byte; only the shipped default is eligible for the local mapper.
        value: slot === 'app.displayName' && options.appDisplayName
          ? resolveAppDisplayName(options.appDisplayName)
          : map(DEFAULT_NATIVE_COPY[slot])
      } satisfies NativeSegment]
    }))
  }
}
