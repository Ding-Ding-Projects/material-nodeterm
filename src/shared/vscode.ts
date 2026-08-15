// Shared types for "Open in Visual Studio Code" (src/core/vscode-detect.ts). Kept in src/shared so
// both the core implementation and the renderer's NodeTerminalApi surface import the same shape.

export type VsCodeKind = 'code' | 'code-insiders'

export interface VsCodeInstall {
  /** The exact command/path this install was verified with. */
  command: string
  kind: VsCodeKind
  /** True when found via PATH resolution rather than a fixed per-platform install path. */
  fromPath: boolean
}

export type VsCodeOpenResult = { ok: true } | { ok: false; error: string }
