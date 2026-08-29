// Reads remote files over the project's existing ControlMaster (`ssh <childArgs> 'tail …'`).
// Pure builders + an injected-runner class so the read logic is electron-free and unit-testable;
// the actual ssh spawn is injected by the caller (Tasks 2/3 wire it to the project's runner).
import { childArgs } from '../../core/remote-ssh/control-master'
import { posixQuote, type SshConnection } from '../../shared/ssh'

export interface RemoteFileRef {
  conn: SshConnection
  controlPath: string
  path: string
}

export const MAX_REMOTE_FILE_BYTES = 512 * 1024 * 1024
export const MAX_REMOTE_READ_BYTES = 1024 * 1024

function boundedOffset(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_REMOTE_FILE_BYTES
}

function boundedReadSize(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_REMOTE_READ_BYTES
}

export function tailFromOffsetArgs(conn: SshConnection, controlPath: string, path: string, offset: number): string[] {
  if (!boundedOffset(offset)) return []
  return childArgs(conn, controlPath, `tail -c +${offset + 1} ${posixQuote(path)} | head -c ${MAX_REMOTE_READ_BYTES}`)
}
export function tailFromOffsetCappedArgs(
  conn: SshConnection,
  controlPath: string,
  path: string,
  offset: number,
  maxBytes: number
): string[] {
  if (!boundedOffset(offset) || !boundedReadSize(maxBytes)) return []
  // base64 wraps at 76 cols on GNU and not at all on BSD — the reader strips whitespace, so
  // no -w flag is used (macOS/BSD base64 has none).
  return childArgs(conn, controlPath, `tail -c +${offset + 1} ${posixQuote(path)} | head -c ${maxBytes} | base64`)
}
export function tailLastBytesArgs(conn: SshConnection, controlPath: string, path: string, bytes: number): string[] {
  if (!boundedReadSize(bytes)) return []
  return childArgs(conn, controlPath, `tail -c ${bytes} ${posixQuote(path)}`)
}

/** Read a bounded tail and the remote file's absolute byte length in one round trip. */
export function tailLastBytesWithSizeArgs(
  conn: SshConnection,
  controlPath: string,
  path: string,
  bytes: number
): string[] {
  if (!boundedReadSize(bytes)) return []
  const quoted = posixQuote(path)
  return childArgs(
    conn,
    controlPath,
    `size=$(wc -c < ${quoted}) || exit 1; printf '%s\\n' "$size"; tail -c ${bytes} ${quoted} | base64`
  )
}

/** Reads a remote file over the project's ControlMaster. Fail-open: errors → empty. */
export class RemoteFile {
  constructor(private run: (args: string[]) => Promise<{ code: number; stdout: string }>) {}

  async readFrom(ref: RemoteFileRef, offset: number): Promise<{ text: string; newOffset: number }> {
    try {
      const { code, stdout } = await this.run(tailFromOffsetArgs(ref.conn, ref.controlPath, ref.path, offset))
      if (code !== 0) return { text: '', newOffset: offset }
      return { text: stdout, newOffset: offset + Buffer.byteLength(stdout) }
    } catch {
      return { text: '', newOffset: offset }
    }
  }

  /** Capped, byte-exact read: base64 round-trips the bytes so a mid-multibyte cut cannot
   *  corrupt the offset accounting (stdout is a decoded string — see tailFromOffsetCappedArgs).
   *  Fail-open: errors → empty buffer, offset unchanged. */
  async readFromCapped(
    ref: RemoteFileRef,
    offset: number,
    maxBytes: number
  ): Promise<{ data: Buffer; newOffset: number }> {
    if (!boundedOffset(offset) || !boundedReadSize(maxBytes)) return { data: Buffer.alloc(0), newOffset: offset }
    try {
      const { code, stdout } = await this.run(
        tailFromOffsetCappedArgs(ref.conn, ref.controlPath, ref.path, offset, maxBytes)
      )
      if (code !== 0) return { data: Buffer.alloc(0), newOffset: offset }
      const encoded = stdout.replace(/\s+/g, '')
      if (encoded.length > Math.ceil(maxBytes / 3) * 4 + 8) return { data: Buffer.alloc(0), newOffset: offset }
      const data = Buffer.from(encoded, 'base64')
      if (data.length > maxBytes) return { data: Buffer.alloc(0), newOffset: offset }
      return { data, newOffset: offset + data.length }
    } catch {
      return { data: Buffer.alloc(0), newOffset: offset }
    }
  }

  async readTail(ref: RemoteFileRef, bytes: number): Promise<string> {
    if (!boundedReadSize(bytes)) return ''
    try {
      const { code, stdout } = await this.run(tailLastBytesArgs(ref.conn, ref.controlPath, ref.path, bytes))
      return code === 0 ? stdout : ''
    } catch {
      return ''
    }
  }

  /** The first tail read needs the absolute remote offset, not merely the bytes returned. */
  async readTailWithSize(
    ref: RemoteFileRef,
    bytes: number
  ): Promise<{ data: Buffer; size: number } | null> {
    if (!boundedReadSize(bytes)) return null
    try {
      const { code, stdout } = await this.run(tailLastBytesWithSizeArgs(ref.conn, ref.controlPath, ref.path, bytes))
      if (code !== 0) return null
      const newline = stdout.indexOf('\n')
      if (newline < 1) return null
      const size = Number(stdout.slice(0, newline).trim())
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_REMOTE_FILE_BYTES) return null
      const data = Buffer.from(stdout.slice(newline + 1).replace(/\s+/g, ''), 'base64')
      if (data.length > bytes) return null
      return { data, size }
    } catch {
      return null
    }
  }
}
