// Local Linux ISO VM node contract. This module is deliberately free of Node/Electron imports so
// the desktop shell, Server Edition bridge, and canvas all agree on the same bounded shape.

export type VirtualMachineMode = 'persistent-install' | 'disposable-live'
export type VirtualMachinePhase = 'unconfigured' | 'ready' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

export interface VirtualMachineConfig {
  /** Persistent install keeps the selected disk; disposable live uses a throwaway overlay. */
  mode: VirtualMachineMode
  memoryMiB: number
  cpus: number
  diskSizeGiB: number
  /** Network is intentionally disabled by default and must be explicit in the project file. */
  networkEnabled: boolean
  /** Prefer WHPX on supported Windows hosts. The manager still reports the actual accelerator. */
  whpxPreferred: boolean
  /** Optional user-supplied SHA-256, checked before QEMU starts. */
  isoSha256?: string
}

export interface VirtualMachineLocalPaths {
  /** A user-selected local ISO, never written to the git-shared project projection. */
  isoPath?: string
  /** A user-selected persistent qcow2/raw disk, never written to the project projection. */
  diskPath?: string
  diskFormat?: 'qcow2' | 'raw' | 'unknown'
}

export interface VirtualMachineToolStatus {
  available: boolean
  qemuPath: string | null
  qemuImgPath: string | null
  source: 'bundled' | 'missing'
  resourceRoot: string | null
  packageProof: 'present' | 'absent'
  sizeDisclosure: string
  reason?: string
  whpxAvailable: boolean | null
}

export interface VirtualMachineStatus {
  id: string
  phase: VirtualMachinePhase
  mode: VirtualMachineMode
  configured: boolean
  isoPath: string | null
  diskPath: string | null
  diskFormat: 'qcow2' | 'raw' | 'unknown'
  diskFreeBytes: number | null
  isoSha256Expected: string | null
  isoSha256Actual: string | null
  accelerator: 'whpx' | 'tcg' | 'unknown'
  networkEnabled: boolean
  displayUrl: string | null
  qmpEndpoint: string | null
  memoryMiB: number
  cpus: number
  progress: number
  message: string
  error?: string
}

export interface VirtualMachineEvent {
  id: string
  status: VirtualMachineStatus
}

export interface VirtualMachineApi {
  tools(): Promise<VirtualMachineToolStatus>
  status(id: string): Promise<VirtualMachineStatus>
  configure(id: string, config: VirtualMachineConfig, local: VirtualMachineLocalPaths): Promise<VirtualMachineStatus>
  createDisk(id: string, folder: string): Promise<VirtualMachineStatus>
  start(id: string): Promise<VirtualMachineStatus>
  stop(id: string): Promise<VirtualMachineStatus>
  snapshot(id: string, name: string): Promise<VirtualMachineStatus>
  restore(id: string, name: string): Promise<VirtualMachineStatus>
  openDisplay(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }>
  reset(id: string): Promise<VirtualMachineStatus>
  onEvent(listener: (event: VirtualMachineEvent) => void): () => void
}

/** Catalog row used by node creation surfaces. Keeping the label beside the node kind prevents a
 * menu, palette, and documentation index from inventing three names for the same node. */
export const VIRTUAL_MACHINE_NODE_CATALOG = [
  {
    kind: 'linux-vm' as const,
    label: 'Linux ISO VM',
    description: 'One-shot Linux guest with persistent or disposable storage'
  }
] as const

export const DEFAULT_VIRTUAL_MACHINE_CONFIG: VirtualMachineConfig = {
  mode: 'disposable-live',
  memoryMiB: 2048,
  cpus: 2,
  diskSizeGiB: 32,
  networkEnabled: false,
  whpxPreferred: true
}

const VM_MIN_MEMORY = 512
const VM_MAX_MEMORY = 32768
const VM_MIN_CPUS = 1
const VM_MAX_CPUS = 16
const VM_MIN_DISK = 4
const VM_MAX_DISK = 2048

export function normalizeVirtualMachineConfig(value: unknown): VirtualMachineConfig {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  const bounded = (input: unknown, min: number, max: number, fallback: number): number => {
    const n = typeof input === 'number' && Number.isFinite(input) ? Math.round(input) : fallback
    return Math.min(max, Math.max(min, n))
  }
  return {
    mode: raw.mode === 'persistent-install' ? 'persistent-install' : 'disposable-live',
    memoryMiB: bounded(raw.memoryMiB, VM_MIN_MEMORY, VM_MAX_MEMORY, DEFAULT_VIRTUAL_MACHINE_CONFIG.memoryMiB),
    cpus: bounded(raw.cpus, VM_MIN_CPUS, VM_MAX_CPUS, DEFAULT_VIRTUAL_MACHINE_CONFIG.cpus),
    diskSizeGiB: bounded(raw.diskSizeGiB, VM_MIN_DISK, VM_MAX_DISK, DEFAULT_VIRTUAL_MACHINE_CONFIG.diskSizeGiB),
    networkEnabled: raw.networkEnabled === true,
    whpxPreferred: raw.whpxPreferred !== false,
    ...(typeof raw.isoSha256 === 'string' && /^[0-9a-f]{64}$/i.test(raw.isoSha256) ? { isoSha256: raw.isoSha256.toLowerCase() } : {})
  }
}

export function safeVirtualMachinePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

export function absoluteVirtualMachinePath(value: unknown): value is string {
  return safeVirtualMachinePath(value) && (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('\\\\'))
}

export function normalizeVirtualMachineLocalPaths(value: unknown): VirtualMachineLocalPaths {
  const raw = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    ...(safeVirtualMachinePath(raw.isoPath) ? { isoPath: raw.isoPath } : {}),
    ...(safeVirtualMachinePath(raw.diskPath) ? { diskPath: raw.diskPath } : {}),
    ...(raw.diskFormat === 'qcow2' || raw.diskFormat === 'raw' || raw.diskFormat === 'unknown' ? { diskFormat: raw.diskFormat } : {})
  }
}

export function virtualMachineConfigReady(config: VirtualMachineConfig, local: VirtualMachineLocalPaths): boolean {
  return absoluteVirtualMachinePath(local.isoPath) &&
    (config.mode === 'disposable-live' || absoluteVirtualMachinePath(local.diskPath))
}
