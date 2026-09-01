// Best-effort local hardware detection for the Ollama fit evaluator (src/shared/ollama.ts's
// evaluateFit). Every field that cannot be determined honestly is `null`, never a guess — see
// docs/ollama-manager.md for exactly what is and isn't detected on each platform.

import { execFile } from 'node:child_process'
import os from 'node:os'
import { promisify } from 'node:util'
import type { HardwareEvidence } from '../../shared/ollama'
import { freeDiskBytes } from '../disk-space'

const execFileAsync = promisify(execFile)
const NVIDIA_SMI_TIMEOUT_MS = 2500

/** Best-effort NVIDIA VRAM probe via `nvidia-smi`, present on many Windows and Linux machines with
 *  an NVIDIA GPU and its driver installed. AMD/Intel GPUs and missing binaries yield `null`. */
async function probeNvidiaSmi(): Promise<{ name: string; vramBytes: number } | null> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: NVIDIA_SMI_TIMEOUT_MS }
    )
    const line = stdout.split('\n').find((l) => l.trim().length > 0)
    if (!line) return null
    const [name, memMiB] = line.split(',').map((s) => s.trim())
    const mb = parseFloat(memMiB)
    if (!name || !Number.isFinite(mb)) return null
    return { name, vramBytes: mb * 1024 * 1024 }
  } catch {
    return null
  }
}

export async function detectHardware(destDirForDisk: string): Promise<HardwareEvidence> {
  const supportedHost = process.platform === 'win32' || process.platform === 'linux'
  const nvidia = supportedHost ? await probeNvidiaSmi() : null
  return {
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    gpuName: nvidia?.name ?? null,
    vramBytes: nvidia?.vramBytes ?? null,
    freeDiskBytes: freeDiskBytes(destDirForDisk),
    arch: process.arch,
    platform: process.platform,
    computedAt: Date.now()
  }
}
