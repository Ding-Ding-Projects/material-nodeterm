import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Build provenance, stamped into the renderer bundle so the app can say WHICH build is running.
 *
 * Computed here, once, at build time. That is what makes it provenance rather than decoration:
 * launch time or a file mtime would look identical on screen and change every run, and a
 * hand-written constant would quietly describe a build nobody is running any more.
 *
 * The commit is best effort. A tarball with no .git is a legitimate way to build this, so a failed
 * `git rev-parse` yields 'unknown' rather than failing the build: the TIME is the load-bearing
 * half, and it is always available.
 */
function buildStamp(): { builtAt: string; commit: string; version: string } {
  let commit = 'unknown'
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || 'unknown'
  } catch {
    // No git, or no repository. Not an error: see above.
  }
  // The VERSION is stamped here too, from package.json, rather than read at runtime from
  // `app.getVersion()`. Electron's `getVersion` returns ELECTRON's own version in an unpackaged
  // run - measured: the front screen read "v42.8.1" instead of the app's version - so the runtime
  // value is only correct in a packaged build. The stamp describes the artifact in both.
  const version = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version
  return { builtAt: new Date().toISOString(), commit, version: typeof version === 'string' ? version : 'unknown' }
}

export default defineConfig({
  main: {
    // node-pty is a native module; keep it external so it is required from node_modules at runtime.
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        // Keep the emitted entry name (`out/main/index.js`, as declared in package.json) while
        // routing through the tiny Squirrel.Windows lifecycle gate. The normal main module is a
        // dynamic import from startup.ts, so install/update/uninstall invocations cannot run any
        // userData, settings, session, or window bootstrap as an import side effect.
        input: {
          index: resolve(__dirname, 'src/main/startup.ts'),
          'codex-relay': resolve(__dirname, 'src/main/codex-relay-daemon.ts')
        },
        // 'electron' is a devDependency, so externalizeDepsPlugin (which reads
        // dependencies) does not externalize it — the npm wrapper at
        // node_modules/electron/index.js would get bundled in, making the app
        // try to download Electron at runtime. node-pty is a native module
        // whose internal require() calls use relative paths that break when
        // bundled. List both explicitly.
        external: ['electron', /^node-pty/, 'node-pty'],
        output: {
          // Force CJS output (.js) — electron-vite v5 defaults to ESM (.mjs), but
          // asar-packaged Electron apps need CJS for the main process entry point.
          format: 'cjs',
          entryFileNames: '[name].js',
          // startup.ts loads the application graph lazily so Squirrel lifecycle processes do
          // not evaluate it. Keep that dynamic chunk beside the entry: index.ts resolves the
          // preload, renderer, HUD, and unpackaged icon relative to out/main, and Vite's default
          // chunks/ directory would silently move that __dirname boundary.
          chunkFileNames: '[name]-[hash].js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // Tiny HUD-only preload for the macOS Notch HUD window (src/main/notch-hud.ts).
          hud: resolve(__dirname, 'src/preload/hud.ts')
        },
        external: ['electron'],
        output: {
          // Same CJS requirement for the preload script inside asar.
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react(), tailwindcss()],
    // Read through `readBuildProvenance` (src/shared/build-provenance.ts), which answers an honest
    // "unavailable" when this define is absent: a dev server never sets it.
    define: {
      __APP_BUILD__: JSON.stringify(buildStamp())
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Second renderer entry: the macOS Notch HUD overlay window (src/main/notch-hud.ts).
          hud: resolve(__dirname, 'src/renderer/hud.html')
        }
      }
    }
  }
})
