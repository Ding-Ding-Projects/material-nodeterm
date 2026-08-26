/// <reference types="vite/client" />

/**
 * Build provenance stamped in by `electron.vite.config.ts`. Absent in a dev server, which is why
 * every reader goes through `readBuildProvenance` rather than touching this directly.
 */
declare const __APP_BUILD__: { builtAt: string; commit: string; version: string } | undefined
