import type { AppLogoSettings } from '@shared/types'

/**
 * Change the visible preset without discarding the processed custom image kept for later.
 *
 * Settings patches are shallow, so `{ appLogo: { selection } }` replaces the entire nested
 * object. Keeping this merge in one helper prevents a harmless preset preview from becoming an
 * accidental, irreversible "remove custom image" operation.
 */
export function selectLogoPreset(current: AppLogoSettings, selection: string): AppLogoSettings {
  return current.customImage
    ? { selection, customImage: current.customImage }
    : { selection }
}

/**
 * Monotonic ownership for asynchronous logo processing.
 *
 * Decoding and canvas compositing can finish out of order. A completion may update settings only
 * while it still owns the latest generation; a synchronous preset choice calls `cancel()` too, so
 * an old upload cannot spring back after the user has visibly selected something else.
 */
export class LogoProcessGeneration {
  private generation = 0

  begin(): number {
    this.generation += 1
    return this.generation
  }

  cancel(): void {
    this.generation += 1
  }

  owns(generation: number): boolean {
    return generation === this.generation
  }
}
