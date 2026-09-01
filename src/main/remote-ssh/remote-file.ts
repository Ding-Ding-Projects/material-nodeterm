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

export function tailFromOffsetArgs(conn: SshConnection, controlPath: string, path: string, offset: number): string[] {
  return childArgs(conn, controlPath, `tail -c +${offset + 1} ${posixQuote(path)}`)
}
export function tailFromOffsetCappedArgs(
  conn: SshConnection,
  controlPath: string,
  path: string,
  offset: number,
  maxBytes: number
): string[] {
  // Base64 wrapping varies between remote tools. The reader strips whitespace, so no optional
  // wrapping flag is needed and the command stays portable across Linux hosts.
  return childArgs(conn, controlPath, `tail -c +${offset + 1} ${posixQuote(path)} | head -c ${maxBytes} | base64`)
}
export function tailLastBytesArgs(conn: SshConnection, controlPath: string, path: string, bytes: number): string[] {
  return childArgs(conn, controlPath, `tail -c ${bytes} ${posixQuote(path)}`)
}

/** Read a bounded tail and the remote file's absolute byte length in one round trip. */
export function tailLastBytesWithSizeArgs(
  conn: SshConnection,
  controlPath: string,
  path: string,
  bytes: number
): string[] {
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
    try {
      const { code, stdout } = await this.run(
        tailFromOffsetCappedArgs(ref.conn, ref.controlPath, ref.path, offset, maxBytes)
      )
      if (code !== 0) return { data: Buffer.alloc(0), newOffset: offset }
      const data = Buffer.from(stdout.replace(/\s+/g, ''), 'base64')
      return { data, newOffset: offset + data.length }
    } catch {
      return { data: Buffer.alloc(0), newOffset: offset }
    }
  }

  async readTail(ref: RemoteFileRef, bytes: number): Promise<string> {
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
    try {
      const { code, stdout } = await this.run(tailLastBytesWithSizeArgs(ref.conn, ref.controlPath, ref.path, bytes))
      if (code !== 0) return null
      const newline = stdout.indexOf('\n')
      if (newline < 1) return null
      const size = Number(stdout.slice(0, newline).trim())
      if (!Number.isSafeInteger(size) || size < 0) return null
      const data = Buffer.from(stdout.slice(newline + 1).replace(/\s+/g, ''), 'base64')
      return { data, size }
    } catch {
      return null
    }
  }
}
