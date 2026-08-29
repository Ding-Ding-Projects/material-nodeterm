import type { CorePlatform } from './platform'
import { IPC } from '../shared/ipc'
import { detectVsCode, openInVsCode } from './vscode-detect'

/** Registers the two `vscode:*` channels on `platform` — called from BOTH src/main/index.ts and
 *  src/server/handlers/index.ts (the same `platform.handle` seam every other core service uses),
 *  so "Open in Visual Studio Code" works identically on Desktop and the Server Edition: it always
 *  opens on the machine actually running the shell that answered the call. */
export function registerVsCodeHandlers(platform: CorePlatform): void {
  platform.handle(IPC.vscodeDetect, () => detectVsCode())
  platform.handle(IPC.vscodeOpen, (targetPath: string) => openInVsCode(targetPath))
}
