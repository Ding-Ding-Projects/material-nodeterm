/**
 * AWS CLI v2 executor. It is deliberately argv-only: no shell, no command textbox, and no
 * credentials in arguments. JSON form values are encoded on stdin and the operation registry is
 * the only source of service and operation names.
 */
import { spawn } from 'node:child_process'
import type { AwsExecutionContext, AwsOperationSpec } from '../../shared/aws'

export interface AwsCommandResult {
  ok: boolean
  output: unknown
  stderr: string
  exitCode: number | null
}

export interface AwsCommandExecutor {
  run(operation: AwsOperationSpec, context: AwsExecutionContext, values: Record<string, unknown>, onProgress?: (completed: number, total: number | null) => void, signal?: AbortSignal): Promise<AwsCommandResult>
  wait?(operation: AwsOperationSpec, context: AwsExecutionContext, values: Record<string, unknown>, onState?: (state: string) => void): Promise<AwsCommandResult>
}

const SAFE_REGION = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d+$/i
const SAFE_PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

function assertContext(context: AwsExecutionContext): void {
  if (!SAFE_REGION.test(context.region)) throw new Error('AWS region is invalid.')
  if (context.profile && !SAFE_PROFILE.test(context.profile)) throw new Error('AWS profile is invalid.')
  if (context.endpointUrl) {
    const url = new URL(context.endpointUrl)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))) {
      throw new Error('AWS endpoint must use HTTPS, or bounded loopback HTTP for development.')
    }
    if (url.protocol === 'https:') {
      const official = url.hostname === 'amazonaws.com' || url.hostname.endsWith('.amazonaws.com')
      if (!official) throw new Error('AWS endpoint must be an official amazonaws.com endpoint or bounded loopback development endpoint.')
    }
    if (url.username || url.password) throw new Error('AWS endpoint must not contain credentials.')
  }
}

function appendValueArgs(args: string[], values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (key === 'region' || value === undefined || value === null || value === '') continue
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) throw new Error(`Unsupported AWS field: ${key}`)
    if (typeof value === 'boolean') {
      if (value) args.push(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)
      continue
    }
    const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    args.push(`--${kebab}`)
    args.push(typeof value === 'string' ? value : JSON.stringify(value))
  }
}

function awsValues(operation: AwsOperationSpec, values: Record<string, unknown>): Record<string, unknown> {
  if (operation.id !== 'route53.changeRecord') return values
  const { action, recordName, recordType, ttl, recordValue, ...rest } = values
  return { ...rest, changeBatch: { Changes: [{ Action: action, ResourceRecordSet: { Name: recordName, Type: recordType, TTL: ttl, ResourceRecords: [{ Value: recordValue }] } }] } }
}

export function buildAwsArgv(operation: AwsOperationSpec, context: AwsExecutionContext, values: Record<string, unknown>): string[] {
  assertContext(context)
  const args = [operation.service, operation.apiOperation, '--output', 'json', '--no-cli-pager', '--region', context.region]
  if (context.profile) args.push('--profile', context.profile)
  if (context.endpointUrl) args.push('--endpoint-url', context.endpointUrl)
  appendValueArgs(args, awsValues(operation, values))
  return args
}

export class SpawnAwsCommandExecutor implements AwsCommandExecutor {
  constructor(private readonly executable = 'aws') {}

  run(operation: AwsOperationSpec, context: AwsExecutionContext, values: Record<string, unknown>, onProgress?: (completed: number, total: number | null) => void, signal?: AbortSignal): Promise<AwsCommandResult> {
    const args = buildAwsArgv(operation, context, values)
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      const abort = () => { child.kill(); reject(new Error('AWS operation cancelled.')) }
      signal?.addEventListener('abort', abort, { once: true })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let size = 0
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size <= MAX_OUTPUT_BYTES) stdout.push(chunk)
        onProgress?.(size, null)
      })
      child.stderr.on('data', (chunk: Buffer) => { if (Buffer.concat(stderr).byteLength < 64 * 1024) stderr.push(chunk) })
      child.once('error', (error) => { signal?.removeEventListener('abort', abort); reject(error) })
      child.once('close', (exitCode) => {
        const text = Buffer.concat(stdout).toString('utf8')
        let output: unknown = text
        try { output = JSON.parse(text) } catch { /* the stderr and raw text remain useful */ }
        signal?.removeEventListener('abort', abort)
        resolve({ ok: exitCode === 0, output, stderr: Buffer.concat(stderr).toString('utf8').slice(0, 64 * 1024), exitCode })
      })
      child.stdin.end(JSON.stringify(values))
    })
  }

  wait(operation: AwsOperationSpec, context: AwsExecutionContext, values: Record<string, unknown>, onState?: (state: string) => void): Promise<AwsCommandResult> {
    if (!operation.waiter) return Promise.resolve({ ok: true, output: null, stderr: '', exitCode: 0 })
    assertContext(context)
    const args = [operation.service, 'wait', operation.waiter.name, '--output', 'json', '--no-cli-pager', '--region', context.region]
    if (context.profile) args.push('--profile', context.profile)
    if (context.endpointUrl) args.push('--endpoint-url', context.endpointUrl)
    appendValueArgs(args, awsValues(operation, values))
    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []; const stderr: Buffer[] = []
      const timer = setInterval(() => onState?.('waiting'), operation.waiter!.intervalMs)
      const timeout = setTimeout(() => { child.kill(); resolve({ ok: false, output: null, stderr: 'AWS waiter timed out.', exitCode: null }) }, operation.waiter!.timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk)); child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.once('error', (error) => { clearInterval(timer); clearTimeout(timeout); reject(error) })
      child.once('close', (exitCode) => { clearInterval(timer); clearTimeout(timeout); resolve({ ok: exitCode === 0, output: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8').slice(0, 64 * 1024), exitCode }) })
    })
  }
}
