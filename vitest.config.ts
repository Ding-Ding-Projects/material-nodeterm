import { defineConfig } from 'vitest/config'
import { resolve } from 'path'


/**
 * Strip a leading `#!` shebang before Vite's transform sees a source `.mjs`.
 *
 * Every executable script under scripts/ opens with `#!/usr/bin/env node` so a POSIX host can run
 * it directly. Node parses that fine — it is specified — but Vite's transform does not, and a test
 * that IMPORTS one of those modules dies during collection with a bare
 * `SyntaxError: Invalid or unexpected token` carrying no frame and no mention of the shebang. It
 * reads as a broken test file rather than a toolchain limitation, which is how three suites sat
 * unloadable while reporting "no tests" — a state that scans as a pass.
 *
 * Deliberately narrow: only `.mjs`, only a `#!` at the very start of the file, and the shebang is
 * blanked IN PLACE rather than removed so every stack frame keeps its real line number. The file on
 * disk is untouched, so the scripts stay directly executable.
 */
const stripShebang = {
  name: 'nodeterm:strip-mjs-shebang',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.split('?')[0].endsWith('.mjs') || !code.startsWith('#!')) return null
    const lineEnd = code.search(/[\r\n]/)
    return { code: lineEnd === -1 ? '' : code.slice(lineEnd), map: null }
  }
}

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
    // Vitest defaults to 5 s, which is a bet on the hardware rather than a statement about the
    // code. The tests that lose that bet here are the ones that spawn real subprocesses — a
    // workflow-contract mutation spawns the checker once per mutation, and a packaging or Git
    // gate shells out repeatedly — so they pass on an idle machine and fail on a shared runner
    // or beside a build, which reads as flake rather than as a timeout. Measured on 2026-08-18:
    // two release-contract tests timed out at exactly 5,000 ms while asserting nothing wrong.
    //
    // 30 s is still far below a genuine hang, so a real deadlock is caught in the same run
    // rather than being papered over. Set here, once, deliberately instead of per test as CI
    // discovers them: a per-test timeout argument is invisible to the next author, and the last
    // person to add one has no idea how many others are one busy runner away from failing.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node'
  },
  plugins: [stripShebang],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  }
})
