import { describe, expect, it } from 'vitest'
import { parsePortableBoardLog } from './board-log'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BoardLogStore } from './board-log'

const line = JSON.stringify({
  id: 'comment-1',
  ts: 1,
  author: { name: 'User', color: '#6750A4' },
  kind: 'comment',
  nodeId: 'sticky-1',
  text: 'hello'
})

describe('portable board-log sidecar parser', () => {
  it('accepts valid JSONL and rejects malformed or foreign records', () => {
    expect(parsePortableBoardLog(line + '\n')).toHaveLength(1)
    expect(() => parsePortableBoardLog('{')).toThrow(/malformed JSON/)
    expect(() => parsePortableBoardLog(JSON.stringify({ ...JSON.parse(line), extra: true }))).toThrow(/unknown entry key/)
    expect(() => parsePortableBoardLog(JSON.stringify({ ...JSON.parse(line), author: { name: 'x', color: '#fff', extra: true } }))).toThrow(/unknown author key/)
    expect(() => parsePortableBoardLog(line.replace('"kind":"comment"', '"kind":"comment","kind":"event"'))).toThrow(/duplicate JSON key/)
  })

  it('distinguishes absent, empty, valid, and malformed raw sidecars', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nodeterm-board-'))
    const store = new BoardLogStore({})
    try {
      expect((await store.readRaw(root)).state).toBe('absent')
      await writeFile(join(root, '.nodeterm'), '', 'utf8').catch(() => {})
      await rm(join(root, '.nodeterm'), { force: true })
      await (await import('node:fs/promises')).mkdir(join(root, '.nodeterm'))
      expect((await store.readRaw(root)).state).toBe('absent')
      await writeFile(join(root, '.nodeterm', 'board-log.jsonl'), '')
      expect((await store.readRaw(root)).state).toBe('empty')
      await writeFile(join(root, '.nodeterm', 'board-log.jsonl'), line + '\n')
      expect((await store.readRaw(root)).state).toBe('ok')
      await writeFile(join(root, '.nodeterm', 'board-log.jsonl'), '{')
      expect((await store.readRaw(root)).state).toBe('malformed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
