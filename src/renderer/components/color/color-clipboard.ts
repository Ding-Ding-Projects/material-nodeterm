import type { ClipboardApi } from '@shared/types'

export interface BrowserClipboardWriter {
  writeText(text: string): void | Promise<void>
}

export interface ColorClipboardWriters {
  /** The app-global clipboard bridge. This is the authoritative route whenever the renderer has
   *  booted inside nodeterm, because it selects the correct desktop or Server Edition behavior. */
  bridge?: Pick<ClipboardApi, 'writeText'>
  /** Browser-native fallback for isolated renderer use (component previews/tests). */
  browser?: BrowserClipboardWriter
  /** Called only after every available route has failed. */
  reportFailure?: () => void
}

function reportColorCopyFailure(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('nodeterm:toast', {
      detail: { kind: 'error', message: 'Copy failed — the system clipboard is unavailable.' }
    })
  )
}

function runtimeClipboardWriters(): ColorClipboardWriters {
  const bridge =
    typeof window === 'undefined'
      ? undefined
      : (window as unknown as { nodeTerminal?: { clipboard?: Pick<ClipboardApi, 'writeText'> } })
          .nodeTerminal?.clipboard
  const browser =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { clipboard?: BrowserClipboardWriter }).clipboard
  return { bridge, browser, reportFailure: reportColorCopyFailure }
}

/**
 * Copy a formatted colour through the app-global bridge, falling back to the browser clipboard
 * when the bridge is unavailable, returns false, or rejects. The bridge is asked to suppress its
 * own failure toast while another route remains: only the final exhausted outcome is reported, so
 * a successful browser fallback never sits beside a contradictory red banner.
 */
export async function copyColorText(
  text: string,
  writers: ColorClipboardWriters = runtimeClipboardWriters()
): Promise<boolean> {
  if (writers.bridge) {
    try {
      if (await writers.bridge.writeText(text, { reportFailure: false })) return true
    } catch {
      // The browser route below still gets one chance; this rejection is owned here.
    }
  }
  if (writers.browser) {
    try {
      await writers.browser.writeText(text)
      return true
    } catch {
      // Exhausted below. Owning this rejection prevents ignored copy clicks from leaking it.
    }
  }
  writers.reportFailure?.()
  return false
}
