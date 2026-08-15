import { randomUUID } from 'crypto'
import { quoteRemotePath } from '../shared/ssh'

export interface RemoteAtomicWrite {
  command: string
  temporaryPath: string
}

export interface RemoteAtomicWriteOptions {
  /** Apply umask 077 before creating either the parent or the temp. */
  restrictPermissions?: boolean
  /** Belt-and-braces for credential files: enforce 0600 on the temp before it is published. */
  chmod600?: boolean
  /** False when the caller already created and permissioned the parent directory. */
  makeParent?: boolean
}

function remoteDirname(path: string): string {
  const end = path.replace(/\/+$/, '')
  const slash = end.lastIndexOf('/')
  if (slash < 0) return '.'
  if (slash === 0) return '/'
  return end.slice(0, slash)
}

/**
 * Build the remote-shell half of a stdin → sibling-temp → rename write.
 *
 * The UUID is minted locally for every call. A fixed `<target>.tmp` lets overlapping SSH clients
 * share one inode: one rename can publish the other writer's partial bytes, then the loser cannot
 * find the temp it still intends to rename. The nonce contains only shell-inert ASCII, while the
 * complete paths still go through quoteRemotePath so spaces, apostrophes, literal backslashes and
 * a leading `~/` keep their existing meanings.
 *
 * The cleanup preserves the write/move status. Unique temps do not self-heal on the next write,
 * so a normal cat/mv failure must remove the exact temp this invocation owns.
 */
export function remoteAtomicWrite(
  path: string,
  options: RemoteAtomicWriteOptions = {}
): RemoteAtomicWrite {
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  const target = quoteRemotePath(path)
  const temporary = quoteRemotePath(temporaryPath)
  const prefix = options.restrictPermissions ? 'umask 077; ' : ''
  const parent = options.makeParent === false
    ? ''
    : `mkdir -p -- ${quoteRemotePath(remoteDirname(path))} && `
  const protect = options.chmod600 ? ` && chmod 600 -- ${temporary}` : ''
  const command =
    `${prefix}${parent}{ cat > ${temporary}${protect} && mv -f -- ${temporary} ${target}; ` +
    `nt_status=$?; ` +
    `rm -f -- ${temporary}; exit "$nt_status"; }`
  return { command, temporaryPath }
}
