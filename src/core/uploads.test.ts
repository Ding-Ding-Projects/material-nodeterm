import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { saveUpload, safeUploadName, uploadsRoot, UPLOAD_MAX_BYTES } from './uploads'

describe('safeUploadName', () => {
  it('strips any directory part — the name is a renderer string, never a write target', () => {
    expect(safeUploadName('../../../.bashrc')).toBe('.bashrc')
    expect(safeUploadName('/etc/passwd')).toBe('passwd')
    // A POSIX-looking name must not steer a Windows write either (basename only knows one sep).
    expect(safeUploadName('a\\b\\c.png')).not.toContain('\\')
  })

  it('falls back to a generated name for what basename still lets through', () => {
    for (const bad of ['', '..', '.', '   ']) {
      expect(safeUploadName(bad)).toMatch(/^upload-/)
    }
  })

  it('keeps an ordinary name — the user recognizes it in the prompt', () => {
    expect(safeUploadName('Bishop Drew order.xlsx')).toBe('Bishop Drew order.xlsx')
  })
})

describe('saveUpload', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('writes the bytes under the uploads root and answers an absolute path', async () => {
    const p = await saveUpload(dir, 'shot.png', Buffer.from('hello').toString('base64'))
    expect(p).toBeTruthy()
    expect(p!.startsWith(uploadsRoot(dir))).toBe(true)
    expect(path.basename(p!)).toBe('shot.png')
    expect(fs.readFileSync(p!, 'utf-8')).toBe('hello')
  })

  it('requests private modes for every staging directory and file on every platform', async () => {
    const mkdir = vi.spyOn(fs.promises, 'mkdir')
    const writeFile = vi.spyOn(fs.promises, 'writeFile')
    const p = await saveUpload(dir, 'private.txt', Buffer.from('private').toString('base64'))
    expect(p).toBeTruthy()
    const root = uploadsRoot(dir)
    expect(mkdir).toHaveBeenCalledWith(root, { recursive: true, mode: 0o700 })
    expect(mkdir).toHaveBeenCalledWith(path.dirname(p!), { recursive: false, mode: 0o700 })
    expect(writeFile).toHaveBeenCalledWith(p, Buffer.from('private'), { flag: 'wx', mode: 0o600 })
  })

  it('runs the legacy-tree migration before creating the next token on the POSIX code path', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    const chmod = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const open = vi.spyOn(fs.promises, 'open').mockResolvedValue({
      stat: async () => ({ isDirectory: () => true }),
      chmod,
      close
    } as never)

    const p = await saveUpload(dir, 'private.txt', Buffer.from('private').toString('base64'))

    expect(p).toBeTruthy()
    expect(open).toHaveBeenCalledWith(uploadsRoot(dir), expect.any(Number))
    expect(chmod).toHaveBeenCalledWith(0o700)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.skipIf(process.platform === 'win32')(
    'creates staging directories as 0700 and bytes as 0600',
    async () => {
      const p = await saveUpload(dir, 'private.txt', Buffer.from('private').toString('base64'))
      expect(p).toBeTruthy()
      expect(fs.statSync(uploadsRoot(dir)).mode & 0o777).toBe(0o700)
      expect(fs.statSync(path.dirname(p!)).mode & 0o777).toBe(0o700)
      expect(fs.statSync(p!).mode & 0o777).toBe(0o600)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'tightens a 0755/0644 legacy tree without following links or touching unrelated inodes',
    async () => {
      const root = uploadsRoot(dir)
      const legacyDir = path.join(root, 'legacy-token')
      const legacyFile = path.join(legacyDir, 'legacy.txt')
      const outsideDir = path.join(dir, 'outside-dir')
      const outsideFile = path.join(dir, 'outside.txt')
      fs.mkdirSync(legacyDir, { recursive: true })
      fs.mkdirSync(outsideDir)
      fs.writeFileSync(legacyFile, 'legacy')
      fs.writeFileSync(outsideFile, 'outside')
      fs.chmodSync(root, 0o755)
      fs.chmodSync(legacyDir, 0o755)
      fs.chmodSync(legacyFile, 0o644)
      fs.chmodSync(outsideDir, 0o755)
      fs.chmodSync(outsideFile, 0o644)
      fs.symlinkSync(outsideDir, path.join(root, 'linked-token'), 'dir')
      fs.symlinkSync(outsideFile, path.join(legacyDir, 'linked-file'))
      fs.linkSync(outsideFile, path.join(legacyDir, 'linked-hard-file'))

      const p = await saveUpload(dir, 'new.txt', Buffer.from('new').toString('base64'))

      expect(p).toBeTruthy()
      expect(fs.statSync(root).mode & 0o777).toBe(0o700)
      expect(fs.statSync(legacyDir).mode & 0o777).toBe(0o700)
      expect(fs.statSync(legacyFile).mode & 0o777).toBe(0o600)
      expect(fs.statSync(outsideDir).mode & 0o777).toBe(0o755)
      expect(fs.statSync(outsideFile).mode & 0o777).toBe(0o644)
      expect(fs.lstatSync(path.join(root, 'linked-token')).isSymbolicLink()).toBe(true)
      expect(fs.lstatSync(path.join(legacyDir, 'linked-file')).isSymbolicLink()).toBe(true)
      expect(fs.statSync(path.dirname(p!)).mode & 0o777).toBe(0o700)
      expect(fs.statSync(p!).mode & 0o777).toBe(0o600)

      const linkedUserData = path.join(dir, 'linked-user-data')
      const outsideRoot = path.join(dir, 'outside-root')
      fs.mkdirSync(linkedUserData)
      fs.mkdirSync(outsideRoot)
      fs.chmodSync(outsideRoot, 0o755)
      fs.symlinkSync(outsideRoot, uploadsRoot(linkedUserData), 'dir')
      expect(
        await saveUpload(linkedUserData, 'must-not-land.txt', Buffer.from('x').toString('base64'))
      ).toBeNull()
      expect(fs.statSync(outsideRoot).mode & 0o777).toBe(0o755)
      expect(fs.readdirSync(outsideRoot)).toEqual([])
    }
  )

  it('gives each save its own directory, so two pastes of one name never collide', async () => {
    const data = Buffer.from('x').toString('base64')
    const a = await saveUpload(dir, 'image.png', data)
    const b = await saveUpload(dir, 'image.png', data)
    expect(a).not.toBe(b)
    expect(fs.existsSync(a!)).toBe(true)
    expect(fs.existsSync(b!)).toBe(true)
  })

  it('escapes nothing into the parent of the uploads root', async () => {
    const p = await saveUpload(dir, '../../escaped.txt', Buffer.from('x').toString('base64'))
    expect(p!.startsWith(uploadsRoot(dir))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'escaped.txt'))).toBe(false)
  })

  it('refuses empty and oversized payloads instead of writing them', async () => {
    expect(await saveUpload(dir, 'empty.bin', '')).toBeNull()
    // Guarded on the ENCODED length: decoding a hostile string to measure it is the allocation
    // the limit exists to prevent.
    expect(await saveUpload(dir, 'huge.bin', 'A'.repeat(Math.ceil(UPLOAD_MAX_BYTES * 1.5)))).toBeNull()
  })

  it('never throws on an unwritable root — a failed save drops the file, like a failed drop', async () => {
    // A FILE where the data dir should be: mkdir under it fails (ENOTDIR) the way a read-only or
    // full disk would, and the caller must get null rather than an exception.
    const asFile = path.join(dir, 'not-a-dir')
    fs.writeFileSync(asFile, 'x')
    expect(await saveUpload(asFile, 'x.png', Buffer.from('x').toString('base64'))).toBeNull()
  })

  it('removes its unique directory when a failed write leaves a partial file', async () => {
    vi.spyOn(fs.promises, 'writeFile').mockImplementationOnce(async (target) => {
      fs.writeFileSync(target as fs.PathLike, 'partial bytes', { flag: 'wx', mode: 0o600 })
      throw new Error('simulated disk-full write')
    })

    expect(await saveUpload(dir, 'partial.bin', Buffer.from('complete').toString('base64'))).toBeNull()
    expect(fs.readdirSync(uploadsRoot(dir))).toEqual([])
  })
})
