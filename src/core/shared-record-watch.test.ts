import path from 'path'
import { describe, expect, it, vi } from 'vitest'

import {
  readSharedJson,
  SharedRecordWatcher,
  type DirectoryWatchHandle,
  type WatchDirectory
} from './shared-record-watch'

function fsError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}

class FakeWatcher implements DirectoryWatchHandle {
  closed = false
  private errorListener: ((error: Error) => void) | null = null

  constructor(
    readonly directory: string,
    private readonly listener: (eventType: string, filename: string | Buffer | null) => void
  ) {}

  close(): void {
    this.closed = true
  }

  on(event: 'error', listener: (error: Error) => void): this {
    if (event === 'error') this.errorListener = listener
    return this
  }

  emit(eventType: string, filename: string | null): void {
    this.listener(eventType, filename)
  }

  emitError(error: Error): void {
    this.errorListener?.(error)
  }
}

function fakeFs(recordFile: string) {
  const target = path.dirname(recordFile)
  const home = path.dirname(path.dirname(target))
  const available = new Set([home])
  const opened: FakeWatcher[] = []
  const createWatcher: WatchDirectory = (directory, listener) => {
    if (!available.has(directory)) throw fsError('ENOENT')
    const watcher = new FakeWatcher(directory, listener)
    opened.push(watcher)
    return watcher
  }
  return { available, createWatcher, home, opened, target }
}

describe('readSharedJson', () => {
  it('keeps absence, corrupt JSON and a failed read as three different facts', async () => {
    await expect(readSharedJson('x', async () => Promise.reject(fsError('ENOENT')))).resolves.toEqual({
      kind: 'absent'
    })
    await expect(readSharedJson('x', async () => '{ nope')).resolves.toEqual({ kind: 'invalid' })

    const denied = fsError('EACCES')
    await expect(readSharedJson('x', async () => Promise.reject(denied))).resolves.toEqual({
      kind: 'error',
      error: denied
    })
    await expect(readSharedJson('x', async () => '{"enabled":true}')).resolves.toEqual({
      kind: 'value',
      value: { enabled: true }
    })
  })
})

describe('SharedRecordWatcher', () => {
  const root = path.parse(process.cwd()).root
  const recordFile = path.join(root, 'watch-fixture', 'person', '.nodeterm', 'shared', 'mode.json')

  it('promotes one watcher from the nearest existing ancestor and reloads after promotion', () => {
    const fake = fakeFs(recordFile)
    const changed = vi.fn()
    const watcher = new SharedRecordWatcher(recordFile, changed, fake.createWatcher)

    const initial = watcher.start()
    expect(initial).not.toBeNull()
    expect(watcher.acknowledge(initial!)).toBe(true)
    expect(fake.opened).toHaveLength(1)
    expect(fake.opened[0].directory).toBe(fake.home)

    fake.available.add(path.dirname(fake.target))
    fake.available.add(fake.target)
    fake.opened[0].emit('rename', '.nodeterm')

    expect(fake.opened).toHaveLength(2)
    expect(fake.opened[0].closed).toBe(true)
    expect(fake.opened[1].directory).toBe(fake.target)
    expect(changed, 'the record may have landed before the target watcher was armed').toHaveBeenCalledTimes(1)
    expect(watcher.acknowledge(changed.mock.calls[0][0])).toBe(true)

    fake.opened[1].emit('change', path.basename(recordFile))
    expect(changed).toHaveBeenCalledTimes(2)
    expect(watcher.acknowledge(changed.mock.calls[1][0])).toBe(true)

    watcher.dispose()
    expect(fake.opened[1].closed).toBe(true)
    fake.opened[1].emit('change', path.basename(recordFile))
    expect(changed, 'a disposed store must ignore a late queued watcher callback').toHaveBeenCalledTimes(2)
  })

  it('does not mistake a watch failure for an absent directory, and retries after a local write', () => {
    const target = path.dirname(recordFile)
    const opened: FakeWatcher[] = []
    let denied = true
    const createWatcher: WatchDirectory = (directory, listener) => {
      if (directory === target && denied) throw fsError('EACCES')
      const handle = new FakeWatcher(directory, listener)
      opened.push(handle)
      return handle
    }
    const watcher = new SharedRecordWatcher(recordFile, vi.fn(), createWatcher)

    expect(watcher.start()).toBeNull()
    expect(opened, 'EACCES must not fall back to an ancestor as if the target were absent').toHaveLength(0)

    denied = false
    watcher.recordWritten()
    expect(opened).toHaveLength(1)
    expect(opened[0].directory).toBe(target)
    watcher.dispose()
  })

  it('promotes immediately after a local write without waiting for an ancestor event', () => {
    const fake = fakeFs(recordFile)
    const changed = vi.fn()
    const health = vi.fn()
    const watcher = new SharedRecordWatcher(recordFile, changed, fake.createWatcher, health)

    const initial = watcher.start()
    expect(initial).not.toBeNull()
    expect(watcher.acknowledge(initial!)).toBe(true)
    const ancestorWatcher = fake.opened[0]
    fake.available.add(fake.target)
    watcher.recordWritten()

    expect(ancestorWatcher.closed).toBe(true)
    expect(fake.opened.at(-1)?.directory).toBe(fake.target)
    expect(health).toHaveBeenLastCalledWith(false)
    expect(changed, 'a local write must start a strict canonical reread').toHaveBeenCalledOnce()
    expect(watcher.acknowledge(changed.mock.calls[0][0])).toBe(true)
    expect(health).toHaveBeenLastCalledWith(true)
    watcher.dispose()
  })

  it('falls back after an ENOENT watcher error, promotes again, and leaks no handle', () => {
    const fake = fakeFs(recordFile)
    fake.available.add(fake.target)
    const changed = vi.fn()
    const watcher = new SharedRecordWatcher(recordFile, changed, fake.createWatcher)

    const initial = watcher.start()
    expect(initial).not.toBeNull()
    expect(watcher.acknowledge(initial!)).toBe(true)
    const targetWatcher = fake.opened[0]
    expect(targetWatcher.directory).toBe(fake.target)

    fake.available.delete(fake.target)
    targetWatcher.emitError(fsError('ENOENT'))
    expect(targetWatcher.closed).toBe(true)
    expect(fake.opened.at(-1)?.directory).toBe(fake.home)
    expect(changed, 'fallback is recovering until its exact read is acknowledged').toHaveBeenCalledTimes(1)
    expect(watcher.acknowledge(changed.mock.calls[0][0])).toBe(true)

    fake.available.add(fake.target)
    const ancestorWatcher = fake.opened.at(-1)!
    ancestorWatcher.emit('rename', '.nodeterm')
    expect(ancestorWatcher.closed).toBe(true)
    expect(fake.opened.at(-1)?.directory).toBe(fake.target)
    expect(changed).toHaveBeenCalledTimes(2)
    expect(watcher.acknowledge(changed.mock.calls[1][0])).toBe(true)

    watcher.dispose()
    expect(fake.opened.filter((handle) => !handle.closed)).toHaveLength(0)
  })

  it('stays unavailable after rearm until the exact recovery read is acknowledged', () => {
    const fake = fakeFs(recordFile)
    fake.available.add(fake.target)
    const changed = vi.fn()
    const health = vi.fn()
    const watcher = new SharedRecordWatcher(recordFile, changed, fake.createWatcher, health)

    const initial = watcher.start()
    expect(initial).not.toBeNull()
    expect(health, 'opening a handle alone is not canonical-record evidence').not.toHaveBeenCalledWith(true)
    expect(watcher.acknowledge(initial!)).toBe(true)
    expect(health).toHaveBeenLastCalledWith(true)

    const target = fake.opened.at(-1)!
    fake.available.delete(fake.target)
    target.emitError(fsError('ENOENT'))

    expect(health).toHaveBeenLastCalledWith(false)
    expect(changed).toHaveBeenCalledOnce()
    expect(health, 'fallback must remain recovering before its read completes').toHaveBeenCalledTimes(2)

    const recovery = changed.mock.calls[0][0]
    expect(watcher.acknowledge(recovery)).toBe(true)
    expect(health).toHaveBeenLastCalledWith(true)
    watcher.dispose()
  })

  it('rejects a late read acknowledgement after a newer record event', () => {
    const fake = fakeFs(recordFile)
    fake.available.add(fake.target)
    const changed = vi.fn()
    const health = vi.fn()
    const watcher = new SharedRecordWatcher(recordFile, changed, fake.createWatcher, health)

    const initial = watcher.start()!
    expect(watcher.acknowledge(initial)).toBe(true)
    const target = fake.opened.at(-1)!

    target.emit('change', path.basename(recordFile))
    const firstRead = changed.mock.calls[0][0]
    target.emit('change', path.basename(recordFile))
    const secondRead = changed.mock.calls[1][0]

    expect(watcher.acknowledge(firstRead), 'an old read cannot heal the newer gap').toBe(false)
    expect(health).toHaveBeenLastCalledWith(false)
    expect(watcher.acknowledge(secondRead)).toBe(true)
    expect(health).toHaveBeenLastCalledWith(true)
    watcher.dispose()
  })
})
