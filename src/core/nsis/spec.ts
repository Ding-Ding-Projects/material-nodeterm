// Re-export shim. The canonical NSIS spec/escape/render modules moved to `src/shared/nsis/` so
// the shared UI-facing adapter (`src/shared/nsis-render.ts`) can call the real, security-reviewed
// renderer instead of maintaining a second implementation. `src/shared` is imported by main, the
// renderer AND core, so it cannot import `src/core` without inverting that dependency direction --
// the fix is to have the canonical implementation live at the lower layer (`src/shared`) and let
// `src/core` re-export it, which is what this file does. Every existing `src/core/nsis` consumer
// (e.g. `src/core/nsis-build/build-local.ts`'s sibling modules) keeps working unchanged.
export * from '../../shared/nsis/spec'
