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

/** Best-effort NVIDIA VRAM probe via `nvidia-smi`, present on most machines with an NVIDIA GPU and
 *  its driver installed (Windows/Linux). Absent everywhere else (Apple Silicon, AMD/Intel GPUs
 *  without it installed, no GPU) — a failure or missing binary yields `null`, not zero. */
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

/** Apple Silicon reports "unified memory" — GPU and CPU share the same RAM pool, so there is no
 *  separate VRAM figure to detect. We still name the chip (from the CPU model string) so the
 *  troubleshooter/evidence text is accurate, but deliberately do NOT report a `vramBytes` figure —
 *  evaluateFit already falls back to total RAM for a host with no VRAM, which is the honest
 *  behavior for unified memory. */
function appleSiliconHint(): string | null {
  const model = os.cpus()[0]?.model ?? ''
  return process.platform === 'darwin' && /Apple/i.test(model) ? model : null
}

export async function detectHardware(destDirForDisk: string): Promise<HardwareEvidence> {
  const nvidia = process.platform !== 'darwin' ? await probeNvidiaSmi() : null
  const apple = appleSiliconHint()
  return {
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    gpuName: nvidia?.name ?? apple ?? null,
    vramBytes: nvidia?.vramBytes ?? null,
    freeDiskBytes: freeDiskBytes(destDirForDisk),
    arch: process.arch,
    platform: process.platform,
    computedAt: Date.now()
  }
}
