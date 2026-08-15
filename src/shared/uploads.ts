// Upload constants shared by the renderer, core, and Server Edition shell.
//
// Keeping the byte ceiling here matters because the browser has to refuse an oversized base64
// payload BEFORE decoding it, while the HTTP receiver has to enforce the same ceiling again as
// untrusted bytes arrive. Two private constants would eventually drift and turn one side's safe
// refusal into the other side's large allocation.

/** Largest raw file the managed upload staging area accepts. */
export const UPLOAD_MAX_BYTES = 64 * 1024 * 1024

/** Stable human-facing refusal shared by the pre-decode and streaming size checks. */
export const UPLOAD_TOO_LARGE_MESSAGE = `File exceeds the ${UPLOAD_MAX_BYTES / (1024 * 1024)} MiB upload limit.`

/** Authenticated Server Edition route used for browser -> host uploads. */
export const UPLOAD_HTTP_PATH = '/upload'

/** Exact largest padded base64 string that can represent UPLOAD_MAX_BYTES raw bytes. */
export const UPLOAD_MAX_BASE64_CHARS = Math.ceil(UPLOAD_MAX_BYTES / 3) * 4

export interface UploadHttpSuccess {
  path: string
}

export interface UploadHttpError {
  error: string
  message: string
  maxBytes?: number
}
