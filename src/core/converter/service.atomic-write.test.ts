import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  type FileHandle
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ConvertQueueItem, ConvertItemStatus } from '../../shared/converter'
import { ConverterService } from './service'

let root: string

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function errno(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${code}: injected converter publish failure`)
  error.code = code
  return error
}

function interceptOutputOpens(
  destDir: string,
  onOpen: (path: string, handle: FileHandle) => void
): void {
  const realOpen = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation((async (path: never, flags: never, mode?: never) => {
    const handle = await realOpen(path, flags, mode)
    const outputPath = String(path)
    if (String(flags) === 'wx' && dirname(outputPath) === destDir) onOpen(outputPath, handle)
    return handle
  }) as typeof fs.open)
}

async function source(folder: string, name: string, contents: string): Promise<string> {
  const dir = join(root, folder)
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, contents, 'utf8')
  return path
}

async function enqueue(
  service: ConverterService,
  paths: string[],
  destDir: string,
  adapterId = 'text-to-lf',
  approveOverwrite = false
): Promise<ConvertQueueItem[]> {
  const result = await service.addFiles(paths, destDir, adapterId)
  expect(result.rejected).toEqual([])
  if (approveOverwrite) {
    for (const item of result.added) service.resolvePending([item.id], { overwrite: true })
  }
  return result.added
}

const SETTLED = new Set<ConvertItemStatus>(['done', 'failed', 'cancelled', 'needs-confirm'])

async function waitForItems(service: ConverterService, ids: string[]): Promise<ConvertQueueItem[]> {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const state = await service.state(0, 500)
    const items = ids.map((id) => state.items.find((item) => item.id === id))
    if (items.every((item) => item && SETTLED.has(item.status))) {
      // `touch()` intentionally persists in the background. Let its serialized queue drain before
      // the fixture directory is removed, or the teardown itself can manufacture an ENOENT.
      await delay(30)
      return items as ConvertQueueItem[]
    }
    await delay(5)
  }
  throw new Error(`Converter items did not settle: ${ids.join(', ')}`)
}

async function expectOnlyDestination(destDir: string, destination: string): Promise<void> {
  expect(await readdir(destDir)).toEqual([basename(destination)])
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nt-converter-atomic-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await delay(50)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('ConverterService atomic output publication', () => {
  it('gives explicitly-approved overlapping writers unique temps even in the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const first = await source('first', 'same.txt', 'alpha\r\n')
    const second = await source('second', 'same.txt', 'beta\r\n')
    const destDir = join(root, 'out')
    await mkdir(destDir, { recursive: true })
    const destination = join(destDir, 'same.txt')
    await writeFile(destination, 'prior\n', 'utf8')

    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const items = await enqueue(service, [first, second], destDir, 'text-to-lf', true)

    const tempPaths: string[] = []
    const bothWriting = deferred<void>()
    const releaseWrites = deferred<void>()
    interceptOutputOpens(destDir, (outputPath, handle) => {
      tempPaths.push(outputPath)
      const realWrite = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => {
        await realWrite(data, options)
        if (tempPaths.length === 2) bothWriting.resolve()
        await releaseWrites.promise
      })
    })

    service.setConcurrency(2)
    service.start()
    try {
      await withTimeout(bothWriting.promise, 'both converter temp writes')
    } finally {
      releaseWrites.resolve()
    }

    expect(tempPaths).toHaveLength(2)
    expect(new Set(tempPaths).size, `writers shared ${tempPaths.join(' and ')}`).toBe(2)
    const settled = await waitForItems(service, items.map((item) => item.id))
    expect(settled.map((item) => item.status)).toEqual(['done', 'done'])
    expect(['alpha\n', 'beta\n']).toContain(await readFile(destination, 'utf8'))
    await expectOnlyDestination(destDir, destination)
  })

  it('retries an occupied temp name and never cleans a path it failed to own', async () => {
    const input = await source('source', 'same.txt', 'replacement\r\n')
    const destDir = join(root, 'out')
    await mkdir(destDir, { recursive: true })
    const destination = join(destDir, 'same.txt')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir)

    const realOpen = fs.open.bind(fs)
    const foreignTemps: string[] = []
    vi.spyOn(fs, 'open').mockImplementation((async (path: never, flags: never, mode?: never) => {
      const candidate = String(path)
      if (String(flags) === 'wx' && dirname(candidate) === destDir) {
        foreignTemps.push(candidate)
        await writeFile(candidate, `foreign-${foreignTemps.length}\n`, 'utf8')
        if (foreignTemps.length === 1) throw errno('EEXIST')
        throw errno('EACCES')
      }
      return realOpen(path, flags, mode)
    }) as typeof fs.open)

    service.start()
    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('failed')
    expect(settled.error).toMatch(/EACCES/)
    expect(foreignTemps).toHaveLength(2)
    expect(new Set(foreignTemps).size).toBe(2)
    expect(await readFile(foreignTemps[0], 'utf8')).toBe('foreign-1\n')
    expect(await readFile(foreignTemps[1], 'utf8')).toBe('foreign-2\n')
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('atomically sends one unapproved same-destination writer back to the overwrite gate', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const first = await source('first', 'same.txt', 'one\r\n')
    const second = await source('second', 'same.txt', 'two\r\n')
    const destDir = join(root, 'out')
    const destination = join(destDir, 'same.txt')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const items = await enqueue(service, [first, second], destDir)

    let outputWrites = 0
    const bothWriting = deferred<void>()
    const releaseWrites = deferred<void>()
    interceptOutputOpens(destDir, (_outputPath, handle) => {
      const realWrite = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => {
        outputWrites++
        await realWrite(data, options)
        if (outputWrites === 2) bothWriting.resolve()
        await releaseWrites.promise
      })
    })

    service.setConcurrency(2)
    service.start()
    try {
      await withTimeout(bothWriting.promise, 'both no-clobber writes')
    } finally {
      releaseWrites.resolve()
    }

    const settled = await waitForItems(service, items.map((item) => item.id))
    expect(settled.map((item) => item.status).sort()).toEqual(['done', 'needs-confirm'])
    const waiting = settled.find((item) => item.status === 'needs-confirm')!
    expect(waiting.confirmReasons).toEqual(['overwrite'])
    const done = settled.find((item) => item.status === 'done')!
    const expectedOutput = done.sourcePath === first ? 'one\n' : done.sourcePath === second ? 'two\n' : undefined
    expect(expectedOutput).toBeDefined()
    expect(await readFile(destination, 'utf8')).toBe(expectedOutput)
    await expectOnlyDestination(destDir, destination)
  })

  it('reports post-publish temp cleanup trouble as a warning without lying that publication failed', async () => {
    const input = await source('source', 'same.txt', 'published\r\n')
    const destDir = join(root, 'out')
    const destination = join(destDir, 'same.txt')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir)

    const realUnlink = fs.unlink.bind(fs)
    let refusedTemp = ''
    vi.spyOn(fs, 'unlink').mockImplementation((async (path: never) => {
      const candidate = String(path)
      if (dirname(candidate) === destDir && candidate !== destination) {
        refusedTemp = candidate
        throw errno('EISDIR')
      }
      return realUnlink(path)
    }) as typeof fs.unlink)

    service.start()
    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('done')
    expect(settled.warnings).toEqual([
      expect.stringContaining(`Could not remove temporary output "${refusedTemp}"`)
    ])
    expect(await readFile(destination, 'utf8')).toBe('published\n')
    expect(await readFile(refusedTemp, 'utf8')).toBe('published\n')
  })

  it('fails closed when the filesystem cannot provide atomic no-clobber links', async () => {
    const input = await source('source', 'same.txt', 'replacement\r\n')
    const destDir = join(root, 'out')
    const destination = join(destDir, 'same.txt')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir)

    const realLink = fs.link.bind(fs)
    vi.spyOn(fs, 'link').mockImplementation((async (from: never, to: never) => {
      if (String(to) === destination) throw errno('ENOTSUP')
      return realLink(from, to)
    }) as typeof fs.link)

    service.start()
    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('failed')
    expect(settled.error).toMatch(/ENOTSUP/)
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(destDir)).toEqual([])
  })

  it('removes its partial and preserves the prior destination when renameAtomic fails', async () => {
    const input = await source('source', 'same.txt', 'replacement\r\n')
    const destDir = join(root, 'out')
    await mkdir(destDir, { recursive: true })
    const destination = join(destDir, 'same.txt')
    await writeFile(destination, 'sentinel\n', 'utf8')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir, 'text-to-lf', true)

    const realRename = fs.rename.bind(fs)
    let outputTemp = ''
    vi.spyOn(fs, 'rename').mockImplementation((async (from: never, to: never) => {
      if (String(to) === destination) {
        outputTemp = String(from)
        throw errno('ENOSPC')
      }
      return realRename(from, to)
    }) as typeof fs.rename)

    service.start()
    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('failed')
    expect(settled.error).toMatch(/ENOSPC/)
    expect(await readFile(destination, 'utf8')).toBe('sentinel\n')
    expect(outputTemp).not.toBe('')
    await expect(access(outputTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    await expectOnlyDestination(destDir, destination)
  })

  it('keeps the publication failure when cancellation arrives during temp cleanup', async () => {
    const input = await source('source', 'same.txt', 'replacement\r\n')
    const destDir = join(root, 'out')
    await mkdir(destDir, { recursive: true })
    const destination = join(destDir, 'same.txt')
    await writeFile(destination, 'sentinel\n', 'utf8')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir, 'text-to-lf', true)

    const realRename = fs.rename.bind(fs)
    let outputTemp = ''
    vi.spyOn(fs, 'rename').mockImplementation((async (from: never, to: never) => {
      if (String(to) === destination) {
        outputTemp = String(from)
        throw errno('ENOSPC')
      }
      return realRename(from, to)
    }) as typeof fs.rename)

    const realUnlink = fs.unlink.bind(fs)
    const cleanupStarted = deferred<void>()
    const releaseCleanup = deferred<void>()
    vi.spyOn(fs, 'unlink').mockImplementation((async (path: never) => {
      if (String(path) === outputTemp) {
        cleanupStarted.resolve()
        await releaseCleanup.promise
      }
      return realUnlink(path)
    }) as typeof fs.unlink)

    service.start()
    try {
      await withTimeout(cleanupStarted.promise, 'failed publication temp cleanup')
      service.cancelItem(item.id)
    } finally {
      releaseCleanup.resolve()
    }

    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('failed')
    expect(settled.error).toMatch(/ENOSPC/)
    expect(await readFile(destination, 'utf8')).toBe('sentinel\n')
    await expect(access(outputTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    await expectOnlyDestination(destDir, destination)
  })

  it('removes a partially-written temp and preserves the prior destination when writing fails', async () => {
    const input = await source('source', 'same.txt', 'replacement\r\n')
    const destDir = join(root, 'out')
    await mkdir(destDir, { recursive: true })
    const destination = join(destDir, 'same.txt')
    await writeFile(destination, 'sentinel\n', 'utf8')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir, 'text-to-lf', true)

    let outputTemp = ''
    interceptOutputOpens(destDir, (outputPath, handle) => {
      outputTemp = outputPath
      const realWrite = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile').mockImplementation(async () => {
        await realWrite('partial')
        throw errno('ENOSPC')
      })
    })

    service.start()
    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('failed')
    expect(settled.error).toMatch(/ENOSPC/)
    expect(await readFile(destination, 'utf8')).toBe('sentinel\n')
    expect(outputTemp).not.toBe('')
    await expect(access(outputTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    await expectOnlyDestination(destDir, destination)
  })

  it('does not write an exclusively-owned temp when cancellation arrives while opening it', async () => {
    const input = await source('source', 'same.txt', 'replacement\r\n')
    const destDir = join(root, 'out')
    await mkdir(destDir, { recursive: true })
    const destination = join(destDir, 'same.txt')
    await writeFile(destination, 'sentinel\n', 'utf8')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir, 'text-to-lf', true)

    const realOpen = fs.open.bind(fs)
    const tempOpened = deferred<void>()
    const releaseOpen = deferred<void>()
    let outputTemp = ''
    let writeCalls = 0
    vi.spyOn(fs, 'open').mockImplementation((async (path: never, flags: never, mode?: never) => {
      const handle = await realOpen(path, flags, mode)
      const candidate = String(path)
      if (String(flags) === 'wx' && dirname(candidate) === destDir) {
        outputTemp = candidate
        const realWrite = handle.writeFile.bind(handle)
        vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => {
          writeCalls++
          await realWrite(data, options)
        })
        tempOpened.resolve()
        await releaseOpen.promise
      }
      return handle
    }) as typeof fs.open)

    service.start()
    try {
      await withTimeout(tempOpened.promise, 'exclusive converter temp open')
      service.cancelItem(item.id)
    } finally {
      releaseOpen.resolve()
    }

    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('cancelled')
    expect(writeCalls).toBe(0)
    expect(await readFile(destination, 'utf8')).toBe('sentinel\n')
    expect(outputTemp).not.toBe('')
    await expect(access(outputTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    await expectOnlyDestination(destDir, destination)
  })

  it('removes its written temp and leaves the prior destination untouched when cancelled', async () => {
    const input = await source('source', 'same.txt', 'replacement\r\n')
    const destDir = join(root, 'out')
    await mkdir(destDir, { recursive: true })
    const destination = join(destDir, 'same.txt')
    await writeFile(destination, 'sentinel\n', 'utf8')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir, 'text-to-lf', true)

    const tempWritten = deferred<void>()
    const releaseWrite = deferred<void>()
    let outputTemp = ''
    interceptOutputOpens(destDir, (outputPath, handle) => {
      outputTemp = outputPath
      const realWrite = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile').mockImplementation(async (data, options) => {
        await realWrite(data, options)
        tempWritten.resolve()
        await releaseWrite.promise
      })
    })

    service.start()
    await withTimeout(tempWritten.promise, 'converter temp write before cancellation')
    service.cancelItem(item.id)
    releaseWrite.resolve()

    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('cancelled')
    expect(await readFile(destination, 'utf8')).toBe('sentinel\n')
    expect(outputTemp).not.toBe('')
    await expect(access(outputTemp)).rejects.toMatchObject({ code: 'ENOENT' })
    await expectOnlyDestination(destDir, destination)
  })

  it('does not create a temp or disturb the prior destination when conversion fails', async () => {
    const input = await source('source', 'same.json', '{ definitely not json')
    const destDir = join(root, 'out')
    await mkdir(destDir, { recursive: true })
    const destination = join(destDir, 'same.yaml')
    await writeFile(destination, 'sentinel: true\n', 'utf8')
    const service = new ConverterService({ userDataDir: join(root, 'data') })
    const [item] = await enqueue(service, [input], destDir, 'json-to-yaml', true)

    service.start()
    const [settled] = await waitForItems(service, [item.id])
    expect(settled.status).toBe('failed')
    expect(settled.error).toMatch(/Could not read source as JSON/)
    expect(await readFile(destination, 'utf8')).toBe('sentinel: true\n')
    await expectOnlyDestination(destDir, destination)
  })
})
