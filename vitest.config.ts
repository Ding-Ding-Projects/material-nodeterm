import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import { cpus } from 'node:os'


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
      'src/session-host/**/*.test.ts',
      'test/server/**/*.test.ts',
      'test/remote/**/*.test.ts',
      // Cross-layer acceptance chains (e.g. renderer store + main's pure gates in one flow):
      // production layering forbids these imports inside src/, so the chain lives here, like
      // test/server's cross-layer boots.
      'test/acceptance/**/*.test.ts',
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
    // Vitest defaults to one worker per logical CPU, which is a bet that tests are CPU-bound.
    // 35 of these files are PROCESS-bound: they spawn git, cmd.exe, bash, node and a real sshd,
    // often several per test. At 32 workers the machine was scheduling hundreds of child
    // processes, and the heaviest tests lost — not by computing anything wrong, but by timing out
    // or having a temp directory refuse to delete while a handle was still open.
    //
    // The cap is not a trade of speed for reliability. Measured on this tree, 8405 tests, one
    // 32-CPU machine:
    //
    //   32 workers (default)   505 s   13 failures
    //   32 workers (default)   543 s    9 failures
    //    8 workers             393 s    1 failure
    //
    // Oversubscription was COSTING throughput as well as determinism, which is the usual result
    // once the bottleneck is process creation rather than arithmetic.
    //
    // Derived from the host rather than hard-coded, so a 4-CPU runner does not get told to run 8.
    maxWorkers: Math.max(2, Math.min(8, cpus().length)),
    testTimeout: 30_000,
    hookTimeout: 30_000,
    environment: 'node',
    // Node 26 ships a global `localStorage` getter that yields undefined without
    // --localstorage-file, and it occupies the slot before jsdom populates globals — so jsdom
    // suites got window === globalThis with localStorage undefined. Restores it per realm.
    setupFiles: ['./test/setup/jsdom-storage.ts']
  },
  plugins: [stripShebang],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer')
    }
  }
})
