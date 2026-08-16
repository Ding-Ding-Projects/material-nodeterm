import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  publishMirrorGeneration,
  readMirrorGeneration,
  reserveMirrorGeneration
} from './mirror-publication'

let dir = ''
let file = ''

function body(generation: number, state: 'working' | 'done'): string {
  return JSON.stringify({
    v: 1,
    generation,
    updatedAt: generation,
    nodes: { n1: { state, updatedAt: generation } }
  })
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-mirror-publish-'))
  file = path.join(dir, 'agent-status.json')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('mirror publication generations', () => {
  it('upgrades a generation-less v1 mirror from generation zero', async () => {
    fs.writeFileSync(file, JSON.stringify({ v: 1, updatedAt: 1, nodes: {} }))
    expect(await readMirrorGeneration(file)).toBe(0)
    const generation = await reserveMirrorGeneration(file)
    expect(generation).toBe(1)
    await expect(publishMirrorGeneration(file, generation, body(generation, 'working')))
      .resolves.toBe('published')
    expect(await readMirrorGeneration(file)).toBe(1)
  })

  it('keeps a later complete generation when an earlier reservation arrives last', async () => {
    const older = await reserveMirrorGeneration(file)
    const newer = await reserveMirrorGeneration(file)
    expect([older, newer]).toEqual([1, 2])
    await expect(publishMirrorGeneration(file, newer, body(newer, 'done'))).resolves.toBe('published')
    await expect(publishMirrorGeneration(file, older, body(older, 'working'))).resolves.toBe('superseded')
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      generation: number
      nodes: { n1: { state: string } }
    }
    expect(doc).toMatchObject({ generation: 2, nodes: { n1: { state: 'done' } } })
  })

  it('does not reset a malformed durable counter to zero', async () => {
    fs.writeFileSync(`${file}.generation`, '{not json')
    await expect(reserveMirrorGeneration(file)).rejects.toBeInstanceOf(SyntaxError)
    expect(fs.readFileSync(`${file}.generation`, 'utf8')).toBe('{not json')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('refuses a body whose header does not match its reserved generation', async () => {
    const generation = await reserveMirrorGeneration(file)
    await expect(publishMirrorGeneration(file, generation, body(generation + 1, 'done')))
      .rejects.toThrow('does not match reservation')
    expect(fs.existsSync(file)).toBe(false)
  })
})
