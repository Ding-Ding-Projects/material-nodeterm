import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: [
      'src/core/**/*.test.ts',
      'src/session-host/**/*.test.ts',
      'src/shared/**/*.test.ts',
      'src/main/**/*.test.ts',
      'src/preload/**/*.test.ts',
      // .tsx too: component tests (jsdom via a per-file pragma; everything else stays node).
      'src/renderer/**/*.test.{ts,tsx}',
      'src/server/**/*.test.ts',
      // The Pages playground is unbundled browser JavaScript. Run its behavior tests as the
      // actual JS modules so persistence/search regressions are not hidden behind TS fixtures.
      'site/app/**/*.test.js',
      // Executable harness cores are plain ESM. Their gates run the same environment builder and
      // PowerShell predicate as the live app launch instead of pinning source text.
      'scripts/**/*.test.mjs',
      'test/server/**/*.test.ts',
      'test/remote/**/*.test.ts',
      // Build bootstrap behavior lives beside the shipped plain-Node script it exercises.
      'scripts/check-build-preflight.test.mjs',
      'scripts/ensure-windows-build-toolchain.test.mjs',
      'scripts/ensure-windows-python.test.mjs',
      // Opt-in end-to-end tests against a real sshd in Docker. They self-skip unless
      // NODETERM_SSH_DOCKER is set, so a machine without Docker still runs a green suite.
      'test/ssh-docker/**/*.test.ts'
    ],
    environment: 'node'
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  }
})
