import type { OpenDialogOptions } from 'electron'

/**
 * Sanitize renderer-supplied labelling for a native picker.
 *
 * Every picker in the app used to open as the OS's bare default — captioned "Open", confirmed with
 * "Open", no filters — whatever the flow that raised it was called. A picker raised BY A SAVE
 * therefore announced itself as an Open dialog, which is how "Save project as one file with media…"
 * read as the app answering a save with the wrong dialog.
 *
 * These labels cross the preload bridge, so they are renderer text heading for the OS. Take only
 * the three fields we mean, only when they are the right shape, and drop everything else: a
 * malformed option degrades to the bare default dialog rather than reaching Electron half-built.
 * Lengths are bounded because a title is a window caption, not a payload.
 */
export function pickerLabels(options?: unknown): OpenDialogOptions {
  const opts = options && typeof options === 'object' ? (options as Record<string, unknown>) : {}
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim() !== '' ? value.slice(0, 200) : undefined
  const filters = Array.isArray(opts.filters)
    ? opts.filters
        .filter(
          (f): f is { name: string; extensions: string[] } =>
            !!f &&
            typeof f === 'object' &&
            typeof (f as { name?: unknown }).name === 'string' &&
            Array.isArray((f as { extensions?: unknown }).extensions) &&
            (f as { extensions: unknown[] }).extensions.every((e) => typeof e === 'string')
        )
        .slice(0, 20)
        .map((f) => ({ name: f.name.slice(0, 100), extensions: f.extensions.slice(0, 50) }))
    : []
  const title = text(opts.title)
  const buttonLabel = text(opts.buttonLabel)
  return {
    ...(title ? { title } : {}),
    ...(buttonLabel ? { buttonLabel } : {}),
    ...(filters.length ? { filters } : {})
  }
}
