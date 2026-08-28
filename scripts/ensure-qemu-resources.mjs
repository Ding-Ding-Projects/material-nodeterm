#!/usr/bin/env node
/*
 * Obtain the pinned QEMU Windows bundle for packaging. Runtime never runs this script and never
 * downloads a tool. The installer URL and SHA-512 come from dependencies.manifest.json, then the
 * installer is launched with a fixed, shell-free, user-selected extraction directory. The final
 * payload check is what lets packaging prove qemu-system-x86_64.exe and qemu-img.exe exist.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.platform !== 'win32') throw new Error('The pinned QEMU resource bootstrap currently supports Windows x64 only.')
const manifest = JSON.parse(await readFile(path.join(root, 'dependencies.manifest.json'), 'utf8'))
const qemu = manifest.qemu
if (!qemu || typeof qemu.source !== 'string' || !/^[0-9a-f]{128}$/i.test(qemu.sha512)) {
  throw new Error('dependencies.manifest.json has no valid pinned QEMU SHA-512 entry.')
}
const outputIndex = process.argv.indexOf('--output')
const output = path.resolve(outputIndex >= 0 && process.argv[outputIndex + 1] ? process.argv[outputIndex + 1] : path.join(root, 'resources', 'qemu'))
const temp = path.join(output, `.qemu-w64-${process.pid}.exe`)
const transientSpawnCodes = new Set(['EACCES', 'EPERM', 'EBUSY'])
const maxSpawnAttempts = 3
const spawnRetryDelaysMs = [50, 100]
await mkdir(output, { recursive: true })
if (qemu.payload.every((entry) => !entry.required || existsSync(path.join(output, entry.path.replace(/^qemu[\\/]/, ''))))) {
  console.log(`QEMU ${qemu.version} payload already present in the package resources. Installer size disclosure: ${qemu.installerSizeDisclosure}.`)
  process.exit(0)
}
const response = await fetch(qemu.source)
if (!response.ok || !response.body) throw new Error(`QEMU download refused with HTTP ${response.status}.`)
const bytes = Buffer.from(await response.arrayBuffer())
const actual = createHash('sha512').update(bytes).digest('hex')
if (actual.toLowerCase() !== qemu.sha512.toLowerCase()) throw new Error(`QEMU SHA-512 mismatch: expected ${qemu.sha512}, actual ${actual}.`)
let tempOwned = false
let tempHandle
try {
  tempHandle = await open(temp, 'wx', 0o700)
  tempOwned = true
  await tempHandle.writeFile(bytes)
  await tempHandle.close()
  tempHandle = undefined
  for (let attempt = 0; attempt < maxSpawnAttempts; attempt += 1) {
    const result = await new Promise((resolve) => {
      let started = false
      let startError
      let settled = false
      const finish = (value) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      let child
      try {
        child = spawn(temp, ['/S', `/D=${output}`], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
      } catch (error) {
        finish({ kind: 'spawn-error', started: false, error })
        return
      }
      child.once('spawn', () => { started = true })
      child.once('error', (error) => {
        startError = error
        if (!started) finish({ kind: 'spawn-error', started: false, error })
      })
      child.once('close', (code, signal) => {
        if (startError) {
          finish({ kind: started ? 'child-error' : 'spawn-error', started, error: startError })
        } else {
          finish({ kind: 'exit', started: true, code, signal })
        }
      })
    })
    if (result.kind === 'exit') {
      if (result.code === 0) break
      throw new Error(`QEMU installer exited with code ${result.code ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}.`)
    }
    if (!result.started && transientSpawnCodes.has(result.error?.code) && attempt < maxSpawnAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, spawnRetryDelaysMs[attempt]))
      continue
    }
    if (result.error) throw result.error
    throw new Error('QEMU installer could not start.')
  }
  for (const entry of qemu.payload) {
    const target = path.join(output, entry.path.replace(/^qemu[\\/]/, ''))
    if (entry.required && !existsSync(target)) throw new Error(`QEMU package payload is missing after extraction: ${entry.path}.`)
  }
  console.log(`QEMU ${qemu.version} verified and extracted. Installer size disclosure: ${qemu.installerSizeDisclosure}.`)
} finally {
  if (tempHandle) await tempHandle.close().catch(() => {})
  if (tempOwned) await rm(temp, { force: true })
}

