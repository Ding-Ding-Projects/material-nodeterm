/** Downloadable whisper.cpp models (ggml files on HuggingFace).
 *
 * There is no `pro` field and there must not be one again: every model here is downloaded from
 * HuggingFace and transcribes ON THE USER'S OWN MACHINE via smart-whisper. Nothing is metered,
 * nothing calls an API, and nobody pays per minute — so a tier gate was charging rent on the
 * user's own CPU. Removed 2026-08-17 for the same reason the phone-relay gate went (2026-08-01):
 * self-hosted work is free. The only real cost is the user's disk (`approxMB`), which the UI
 * shows so they can decide for themselves. */
export interface WhisperModelInfo {
  id: string
  file: string
  approxMB: number
}

export const WHISPER_MODELS: WhisperModelInfo[] = [
  { id: 'tiny', file: 'ggml-tiny.bin', approxMB: 75 },
  { id: 'base', file: 'ggml-base.bin', approxMB: 142 },
  { id: 'small', file: 'ggml-small.bin', approxMB: 466 },
  { id: 'large-v3-turbo', file: 'ggml-large-v3-turbo.bin', approxMB: 1600 },
]

/** The model a session falls back to when none is chosen, or when the chosen one is not a model
 *  this build knows. `tiny` is the smallest and the one that is free, so it is the only safe
 *  automatic choice: falling back to a larger one would download 1.6 GB nobody asked for. */
export const DEFAULT_WHISPER_MODEL = 'tiny'

export const WHISPER_DOWNLOAD_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/'

export function whisperModel(id: string): WhisperModelInfo | undefined {
  return WHISPER_MODELS.find((m) => m.id === id)
}

/** The download/selection state a surface needs to keep the two in step. Deliberately narrower
 *  than `SpeechModelInfo` so the mobile-shaped lists fit it too. */
export interface ModelDownloadState {
  id: string
  downloaded: boolean
}

/**
 * The model to select after `justDownloaded` finished, or null to leave the choice alone.
 *
 * Downloading is not selecting — but a settings default (`tiny`) means there is ALWAYS a
 * selection, so a user who downloads `base` first ends up pointed at a model that is not on disk
 * and dictation fails with "model not downloaded". They downloaded a model and reasonably believe
 * they are done. So: adopt the fresh download whenever the current selection has nothing behind
 * it, and never when it does — a working setup is not hijacked by trying a second model out.
 */
export function modelAfterDownload(
  models: readonly ModelDownloadState[],
  current: string,
  justDownloaded: string
): string | null {
  if (current === justDownloaded) return null
  // An id that is not in the list at all (a renamed/removed model) has nothing behind it either.
  return models.find((m) => m.id === current)?.downloaded ? null : justDownloaded
}

/**
 * The model to select after a delete, or null to leave it alone. Deleting the selected model
 * leaves the same dangling pointer a first download does — so fall back to whatever else is on
 * disk. Null when nothing is: there is nothing truthful to select, and the row list already says
 * so louder than a silent switch would.
 */
export function modelAfterDelete(
  models: readonly ModelDownloadState[],
  current: string
): string | null {
  if (models.find((m) => m.id === current)?.downloaded) return null
  return models.find((m) => m.downloaded)?.id ?? null
}
