import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
        input: { index: resolve(__dirname, 'src/main/startup.ts') },
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
          // bootstrap.ts loads the application graph lazily so Squirrel lifecycle processes do
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
