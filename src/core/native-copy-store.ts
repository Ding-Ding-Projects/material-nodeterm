import {
  emptyNativeCopyProjection,
  joinNativeSegments,
  type NativeCopyProjection,
  type NativeCopySlot,
  validateNativeCopyProjection
} from '../shared/native-copy-projection'

export type NativeCopyReplaceResult =
  | { ok: true; epoch: number }
  | { ok: false; reason: string; epoch: number }

/**
 * In-memory owner-bound store for native text. It intentionally has no persistence, logging,
 * export, or relay hooks. A new renderer or navigation receives a fresh epoch before it can write.
 */
export class NativeCopyStore {
  private ownerWebContentsId: number | null = null
  private epochValue = 0
  private projectionValue: NativeCopyProjection = emptyNativeCopyProjection(0)

  attach(webContentsId: number): number {
    if (!Number.isSafeInteger(webContentsId) || webContentsId <= 0) return this.epochValue
    this.ownerWebContentsId = webContentsId
    return this.reset()
  }

  detach(webContentsId?: number): number {
    if (webContentsId !== undefined && webContentsId !== this.ownerWebContentsId) return this.epochValue
    this.ownerWebContentsId = null
    return this.reset()
  }

  reset(): number {
    this.epochValue = this.epochValue >= Number.MAX_SAFE_INTEGER ? 0 : this.epochValue + 1
    this.projectionValue = emptyNativeCopyProjection(this.epochValue)
    return this.epochValue
  }

  epoch(): number {
    return this.epochValue
  }

  owns(webContentsId: number): boolean {
    return this.ownerWebContentsId === webContentsId
  }

  replace(webContentsId: number, input: unknown): NativeCopyReplaceResult {
    if (!this.owns(webContentsId)) return { ok: false, reason: 'native-copy sender is not the main window', epoch: this.epochValue }
    const checked = validateNativeCopyProjection(input, this.epochValue)
    if (!checked.ok) return { ok: false, reason: checked.reason, epoch: this.epochValue }
    // The validator creates a fresh normalized object, so the swap is atomic and no caller-owned
    // arrays or objects remain reachable by the host process.
    this.projectionValue = checked.projection
    return { ok: true, epoch: this.epochValue }
  }

  get(slot: NativeCopySlot, fallback: string): string {
    const entry = this.projectionValue.entries.find((candidate) => candidate.slot === slot)
    if (!entry) return fallback
    const value = joinNativeSegments(entry.segments)
    return value.length > 0 ? value : fallback
  }

  projection(): NativeCopyProjection {
    return {
      protocol: this.projectionValue.protocol,
      epoch: this.projectionValue.epoch,
      entries: this.projectionValue.entries.map((entry) => ({
        slot: entry.slot,
        segments: entry.segments.map((segment) => ({ ...segment }))
      }))
    }
  }
}

export const nativeCopyStore = new NativeCopyStore()
