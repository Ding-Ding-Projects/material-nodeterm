// Landing area for file bytes that reach us WITHOUT a path on the machine the terminals run on.
//
// A drag-drop hands the renderer an OS file, and Electron can name its real path — so a desktop
// drop pastes that path and nothing is copied. Two cases have no such path:
//  • a CLIPBOARD paste of raw bytes (a screenshot, an image copied out of a browser). There is no
//    file anywhere yet; something has to write one before a path can be pasted.
//  • the Server Edition / a relay tab, where the bytes are in a BROWSER on another machine and the
//    terminal runs here — the client's own path, if it even had one, names a stranger's disk.
//
// Both resolve the same way: write the bytes under `<userData>/uploads/<token>/<name>` on the
// machine that owns the terminal, and hand back that absolute path. `<token>` per save, so two
// pastes of `image.png` never collide and the name the user recognizes is kept.

import { constants as fsConstants, promises as fs } from 'fs'
import { basename, join } from 'path'
import { UPLOAD_MAX_BASE64_CHARS, UPLOAD_MAX_BYTES } from '../shared/uploads'

/** Anything bigger is refused by every carrier before it reaches the managed staging area. */
export { UPLOAD_MAX_BYTES } from '../shared/uploads'

/** Uploads older than this are swept on the next save — the directory is a staging area for a
 *  paste, not storage the user manages, and nothing is coming back to clean it up otherwise. */
export const UPLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000

let seq = 0

/** `<userData>/uploads` — exported so a caller can name the directory in a message/test. */
export const uploadsRoot = (userDataDir: string): string => join(userDataDir, 'uploads')

/**
 * A filename that is safe to JOIN — never to trust as given. `basename` strips any directory part
 * (`../../.bashrc` becomes `.bashrc`), and the leftovers that basename still allows through on
 * their own (`.`, `..`, empty) fall back to a generated name. Separators that are not this
 * platform's are stripped too, so a POSIX-looking name can't steer a Windows write.
 */
export function safeUploadName(name: string): string {
  const base = basename(String(name ?? '')).replace(/[/\\]/g, '')
  const clean = base.replace(/^\.+$/, '').trim()
  return clean || `upload-${Date.now().toString(36)}`
}

type ManagedEntryKind = 'directory' | 'file'

async function chmodManagedEntry(
  entryPath: string,
  kind: ManagedEntryKind,
  mode: number
): Promise<boolean> {
  const flags =
    fsConstants.O_RDONLY |
    fsConstants.O_NOFOLLOW |
    (kind === 'directory' ? fsConstants.O_DIRECTORY : 0)
  let handle: fs.FileHandle | null = null
  try {
    // O_NOFOLLOW makes the check and chmod operate on one opened inode. A preceding lstat followed
    // by path-based chmod would still have a symlink-swap window.
    handle = await fs.open(entryPath, flags)
    const stat = await handle.stat()
    if (kind === 'directory') {
      if (!stat.isDirectory()) return false
    } else {
      // chmod changes the inode, not the directory entry. A multiply-linked file may also live
      // outside the managed upload tree, so leave it alone rather than changing an unrelated path.
      if (!stat.isFile() || stat.nlink !== 1) return false
    }
    await handle.chmod(mode)
    return true
  } finally {
    await handle?.close().catch(() => {})
  }
}

function isVanishedOrSymlinkRace(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP'
}

/**
 * Tighten a tree made by an older build that relied on the ambient umask. Scope is deliberately
 * shallow: the managed root, its per-save directories, and regular single-link files immediately
 * inside those directories. Symlinks, hard-linked files, root-level files, and nested directories
 * are not ours to chmod. Windows has no compatible POSIX mode contract, so it keeps its existing
 * behavior and relies on the private modes requested when entries are first created.
 */
export async function tightenUploadPermissions(root: string): Promise<void> {
  if (process.platform === 'win32') return

  // The root is the boundary that makes any legacy child private immediately. Refuse a symlinked
  // root instead of following it into an operator- or attacker-chosen directory.
  if (!(await chmodManagedEntry(root, 'directory', 0o700))) {
    throw new Error('Upload root is not a directory')
  }

  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    try {
      if (!(await chmodManagedEntry(dir, 'directory', 0o700))) continue
      for (const child of await fs.readdir(dir, { withFileTypes: true })) {
        if (!child.isFile()) continue
        try {
          await chmodManagedEntry(join(dir, child.name), 'file', 0o600)
        } catch (error) {
          if (!isVanishedOrSymlinkRace(error)) throw error
        }
      }
    } catch (error) {
      if (!isVanishedOrSymlinkRace(error)) throw error
    }
  }
}

/** Delete upload folders older than the TTL. Best-effort: a sweep that fails changes nothing. */
export async function sweepUploads(root: string): Promise<void> {
  try {
    const now = Date.now()
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(root, entry.name)
      try {
        const st = await fs.stat(dir)
        if (now - st.mtimeMs > UPLOAD_TTL_MS) await fs.rm(dir, { recursive: true, force: true })
      } catch {
        /* a directory that vanished mid-sweep needs no removing */
      }
    }
  } catch {
    /* no uploads dir yet */
  }
}

/**
 * Write base64 `data` as `<userData>/uploads/<token>/<name>` and resolve its ABSOLUTE path, or
 * null when it could not be written (too large, undecodable, unwritable disk). Never throws — the
 * caller pastes what it got and silently drops what it didn't, exactly like a failed drop.
 */
export async function saveUpload(
  userDataDir: string,
  name: string,
  dataBase64: string
): Promise<string | null> {
  let createdDir: string | null = null
  try {
    // Guard on the ENCODED length first: decoding a hostile 2 GB string to measure it is the
    // allocation this limit exists to prevent.
    if (typeof dataBase64 !== 'string' || dataBase64.length > UPLOAD_MAX_BASE64_CHARS) return null
    const buf = Buffer.from(dataBase64, 'base64')
    if (!buf.length || buf.length > UPLOAD_MAX_BYTES) return null
    const root = uploadsRoot(userDataDir)
    // Clipboard images and dropped documents can contain secrets. The app data parent is not a
    // permission boundary on every Unix installation, so make the staging tree private itself.
    // Windows ignores POSIX mode bits; these options are harmless there and keep one code path.
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    await tightenUploadPermissions(root)
    void sweepUploads(root)
    const token = `${Date.now().toString(36)}${(seq++).toString(36)}`
    const dir = join(root, token)
    await fs.mkdir(dir, { recursive: false, mode: 0o700 })
    createdDir = dir
    const target = join(dir, safeUploadName(name))
    await fs.writeFile(target, buf, { flag: 'wx', mode: 0o600 })
    return target
  } catch {
    // writeFile can leave a short file behind when the disk fills. Remove only the directory this
    // invocation successfully created; setting createdDir after mkdir avoids deleting a colliding
    // directory that belonged to another save.
    if (createdDir) {
      try {
        await fs.rm(createdDir, { recursive: true, force: true })
      } catch {
        /* best-effort cleanup; the original save still reports failure */
      }
    }
    return null
  }
}
