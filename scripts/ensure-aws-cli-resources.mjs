import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(path.join(root, 'dependencies.manifest.json'), 'utf8'))
const entry = manifest.awsCliV2
if (!entry || typeof entry.source !== 'string' || !/^[0-9a-f]{64}$/iu.test(entry.sha256)) {
  throw new Error('dependencies.manifest.json has no valid pinned AWS CLI v2 entry.')
}

const outputIndex = process.argv.indexOf('--output')
const output = path.resolve(outputIndex >= 0 && process.argv[outputIndex + 1]
  ? process.argv[outputIndex + 1]
  : path.join(root, 'resources', 'aws-cli-v2'))
const filename = `AWSCLIV2-User-${entry.version}.msi`
const target = path.join(output, filename)
const stage = path.join(output, `.${filename}.${process.pid}.part`)

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

await mkdir(output, { recursive: true })
if (existsSync(target) && await sha256(target) === entry.sha256.toLowerCase()) {
  console.log(`AWS CLI v2 ${entry.version} verified package resource is already present.`)
  process.exit(0)
}

await rm(stage, { force: true })
const response = await fetch(entry.source, { redirect: 'error' })
if (!response.ok || !response.body) throw new Error(`AWS CLI v2 download returned HTTP ${response.status}.`)
const declared = Number(response.headers.get('content-length') ?? '')
if (Number.isFinite(declared) && declared > entry.maxDownloadBytes) throw new Error('AWS CLI v2 MSI exceeds the download limit.')
const bytes = Buffer.from(await response.arrayBuffer())
if (bytes.byteLength > entry.maxDownloadBytes) throw new Error('AWS CLI v2 MSI exceeds the download limit.')
await writeFile(stage, bytes, { mode: 0o600, flag: 'wx' })
const actual = await sha256(stage)
if (actual !== entry.sha256.toLowerCase()) {
  await rm(stage, { force: true })
  throw new Error(`AWS CLI v2 SHA-256 mismatch: expected ${entry.sha256}, actual ${actual}.`)
}
await rm(target, { force: true })
await rename(stage, target)
console.log(`AWS CLI v2 ${entry.version} verified and staged for packaging (${bytes.byteLength} bytes).`)
