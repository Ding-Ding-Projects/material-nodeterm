/**
 * The capture tuple: the exact conditions one screenshot was taken under.
 *
 * Why this module exists at all. The harness used to pin every capture to `1600x1000` at
 * `deviceScaleFactor: 1`, in one theme and one language — so it only ever photographed the
 * comfortable case and structurally could not see a clipping defect. A layout claim about narrow
 * widths, high display scale, or the longest localized strings had nothing behind it, because no
 * capture had ever been taken there. This turns those conditions into an axis the run reports.
 *
 * The minimum window size is READ FROM SOURCE rather than restated here. Two copies of that number
 * are two numbers that disagree eventually, and the failure is nasty in a specific way: a capture
 * would prove a width the application never actually permits, which reads as evidence rather than
 * as a mistake. `readWindowMinimum` therefore parses `src/shared/window-minimum.ts` and THROWS if
 * either constant is missing or unparseable — a renamed or deleted constant has to stop the run,
 * not silently fall back to a guess.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Display scales Windows actually offers, and the ones the clipping contract names. */
export const SUPPORTED_SCALES = [1, 1.25, 1.5, 2]

/** The three language modes. Bilingual renders the longest strings, so it clips first. */
export const SUPPORTED_LANGUAGE_MODES = ['en', 'yue', 'bilingual']

/** Dark is the app's shipped default (`:root`); light is the restatement. */
export const SUPPORTED_THEMES = ['dark', 'light']

/** The comfortable viewport the harness used to be pinned to. Kept as the `normal` end of the axis. */
export const NORMAL_VIEWPORT = { width: 1600, height: 1000 }

/**
 * Parse the declared minimum client area out of the shared TypeScript constant.
 *
 * Anchored to the start of a line and to the exact `export const` form, so a commented-out
 * declaration or a same-named string inside a comment cannot satisfy it.
 */
export function readWindowMinimum(root = ROOT) {
  const path = join(root, 'src', 'shared', 'window-minimum.ts')
  const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  // No regex and no split here, deliberately. A pattern or a newline literal written through a
  // shell heredoc loses a backslash on the way to disk, and this parse is what supplies the
  // clipping floor -- a silently-empty match would have read as 'the constant is gone' rather
  // than as a mangled needle. indexOf plus parseInt names no escape at all: parseInt stops at the
  // first non-digit, which is the line ending, whatever that line ending happens to be.
  const read = (name) => {
    const prefix = `export const ${name} = `
    const at = source.indexOf(prefix)
    // Require a line start, so a commented-out declaration cannot satisfy this.
    const atLineStart = at === 0 || (at > 0 && source.charCodeAt(at - 1) === 10)
    const value = at < 0 || !atLineStart
      ? NaN
      : Number.parseInt(source.slice(at + prefix.length), 10)
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `capture-tuple: ${name} not found at a line start in ${path}. The minimum window size is ` +
          'the floor every clipping capture is taken at; refusing to guess one.'
      )
    }
    return value
  }
  return { width: read('MIN_WINDOW_WIDTH'), height: read('MIN_WINDOW_HEIGHT') }
}

/** Resolve a `--viewport` value: `min`, `normal`, or an explicit `WxH`. */
export function resolveViewport(value, root = ROOT) {
  if (value === undefined || value === null || value === true || value === 'normal') {
    return { ...NORMAL_VIEWPORT, name: 'normal' }
  }
  if (value === 'min' || value === 'minimum') {
    return { ...readWindowMinimum(root), name: 'min' }
  }
  const explicit = String(value).match(/^(\d{3,5})x(\d{3,5})$/)
  if (!explicit) {
    throw new Error(`capture-tuple: --viewport expects "min", "normal", or WxH; got ${String(value)}`)
  }
  return { width: Number(explicit[1]), height: Number(explicit[2]), name: `${explicit[1]}x${explicit[2]}` }
}

/** Resolve a `--scale` value against the scales the contract names. */
export function resolveScale(value) {
  if (value === undefined || value === null || value === true) return 1
  const scale = Number(value)
  if (!SUPPORTED_SCALES.includes(scale)) {
    throw new Error(
      `capture-tuple: --scale expects one of ${SUPPORTED_SCALES.join(', ')}; got ${String(value)}`
    )
  }
  return scale
}

/** Resolve a member of a fixed set, refusing anything outside it rather than defaulting quietly. */
function resolveMember(value, allowed, flag, fallback) {
  if (value === undefined || value === null || value === true) return fallback
  const picked = String(value)
  if (!allowed.includes(picked)) {
    throw new Error(`capture-tuple: --${flag} expects one of ${allowed.join(', ')}; got ${picked}`)
  }
  return picked
}

/**
 * Build the whole tuple from raw flag values.
 *
 * `label` is the identity a capture directory and a probe receipt are filed under. It is built
 * from every axis, so two captures taken under different conditions can never land on one path and
 * overwrite each other — the shape that makes a matrix report more coverage than it has.
 */
export function resolveCaptureTuple(
  { viewport, scale, theme, lang } = {},
  root = ROOT
) {
  const resolvedViewport = resolveViewport(viewport, root)
  const resolvedScale = resolveScale(scale)
  const resolvedTheme = resolveMember(theme, SUPPORTED_THEMES, 'theme', 'dark')
  const resolvedLanguage = resolveMember(lang, SUPPORTED_LANGUAGE_MODES, 'lang', 'en')
  return {
    viewport: {
      width: resolvedViewport.width,
      height: resolvedViewport.height,
      deviceScaleFactor: resolvedScale,
      mobile: false
    },
    viewportName: resolvedViewport.name,
    scale: resolvedScale,
    theme: resolvedTheme,
    languageMode: resolvedLanguage,
    label: [
      `${resolvedViewport.width}x${resolvedViewport.height}`,
      `s${String(resolvedScale).replace('.', '_')}`,
      resolvedTheme,
      resolvedLanguage
    ].join('-')
  }
}

/**
 * The settings the app must already hold when it boots for this tuple.
 *
 * Theme and language are persisted settings, not runtime overrides, so they are written into the
 * sandbox profile BEFORE launch. Setting them afterwards through the renderer would capture the
 * app mid-transition and, worse, would prove that the attribute can be forced rather than that the
 * saved setting is honoured.
 */
export function tupleSettings(tuple) {
  // `appTheme` is verified against src/shared/types.ts and renderer/state/useAppTheme.ts -- it is
  // not an invented key. A settings field nobody reads persists perfectly and renders identically,
  // so a misnamed key here would leave the theme axis with no effect while every capture still
  // looked valid.
  return { languageMode: tuple.languageMode, appTheme: tuple.theme }
}
