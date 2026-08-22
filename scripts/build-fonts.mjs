#!/usr/bin/env node
// Regenerates every committed font asset under src/renderer/assets/fonts/ from the pinned npm
// packages in devDependencies (@fontsource-variable/outfit, @fontsource/roboto-mono,
// material-symbols -- see package.json for the exact pinned versions) plus
// scripts/subset-material-symbols.py for the Material Symbols icon subset.
//
// Build-time only. Nothing here fetches from the network: every byte written comes from a
// package already unpacked under node_modules by `npm install`. The renderer's CSP
// (font-src 'self' data:) makes a runtime font fetch impossible anyway -- see
// scripts/check-app-contract.mjs's forbidden-CDN-host scan, which this script's OWN output
// must also never trip (no font/icon CDN host name may appear anywhere under src/renderer).
//
// Usage: node scripts/build-fonts.mjs
//
// Regenerates:
//   src/renderer/assets/fonts/outfit/*.woff2
//   src/renderer/assets/fonts/roboto-mono/*.woff2
//   src/renderer/assets/fonts/material-symbols/material-symbols-rounded-subset.woff2
//   src/renderer/components/materialSymbols.generated.ts
//
// Does NOT touch src/renderer/fonts.css or src/renderer/components/MaterialSymbol.tsx --
// those are hand-maintained and read the generated files above.

import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const OUTFIT_SRC_DIR = join(REPO_ROOT, 'node_modules', '@fontsource-variable', 'outfit', 'files')
const OUTFIT_OUT_DIR = join(REPO_ROOT, 'src', 'renderer', 'assets', 'fonts', 'outfit')
// Both Latin subsets: covers ASCII plus the accented Latin characters (café, naïve, …) a
// terminal/canvas UI can plausibly need in a file name or a person's own text. Combined this
// is ~47 KB -- cheap enough not to bother trimming further.
const OUTFIT_FILES = ['outfit-latin-wght-normal.woff2', 'outfit-latin-ext-wght-normal.woff2']

const ROBOTO_MONO_SRC_DIR = join(REPO_ROOT, 'node_modules', '@fontsource', 'roboto-mono', 'files')
const ROBOTO_MONO_OUT_DIR = join(REPO_ROOT, 'src', 'renderer', 'assets', 'fonts', 'roboto-mono')
// Regular + italic, at 400 (regular) and 700 (bold): the standard four-face terminal/code set,
// so bold and italic terminal output renders from real hinted faces instead of a
// browser-synthesized (faux) bold/oblique. Latin subset only -- Roboto Mono is not variable,
// so each weight/style is its own static file.
const ROBOTO_MONO_FILES = [
  'roboto-mono-latin-400-normal.woff2',
  'roboto-mono-latin-400-italic.woff2',
  'roboto-mono-latin-700-normal.woff2',
  'roboto-mono-latin-700-italic.woff2',
]

const MATERIAL_SYMBOLS_SUBSET_SCRIPT = join(REPO_ROOT, 'scripts', 'subset-material-symbols.py')
const MATERIAL_SYMBOLS_MANIFEST = join(
  REPO_ROOT,
  'scripts',
  'material-symbols-codepoints.generated.json',
)
const MATERIAL_SYMBOLS_OUT_WOFF2 = join(
  REPO_ROOT,
  'src',
  'renderer',
  'assets',
  'fonts',
  'material-symbols',
  'material-symbols-rounded-subset.woff2',
)
const MATERIAL_SYMBOLS_TS_OUT = join(
  REPO_ROOT,
  'src',
  'renderer',
  'components',
  'materialSymbols.generated.ts',
)

const WOFF2_MAGIC = Buffer.from('wOF2', 'ascii')

function assertWoff2(path) {
  const stat = statSync(path)
  if (stat.size === 0) {
    throw new Error(`FATAL: ${path} is zero bytes.`)
  }
  const fd = readFileSync(path)
  if (!fd.subarray(0, 4).equals(WOFF2_MAGIC)) {
    throw new Error(
      `FATAL: ${path} does not start with the woff2 'wOF2' signature -- it is not a valid ` +
        'woff2 font file.',
    )
  }
  return stat.size
}

function copyFonts(srcDir, outDir, files, label) {
  mkdirSync(outDir, { recursive: true })
  const results = []
  for (const file of files) {
    const src = join(srcDir, file)
    if (!existsSync(src)) {
      throw new Error(
        `FATAL: ${src} not found. Run \`npm install\` first (the ${label} package is a ` +
          'pinned devDependency; see package.json).',
      )
    }
    const dest = join(outDir, file)
    copyFileSync(src, dest)
    const size = assertWoff2(dest)
    results.push({ file, size })
  }
  return results
}

function resolvePython() {
  // Windows commonly has no bare `python3`, and `python` may be the Microsoft Store
  // app-execution alias that opens a store prompt instead of running anything -- `py -3` is
  // the reliable Windows launcher. Try in an order that works on every platform this repo
  // targets without ever invoking the Store alias by accident.
  const candidates = [
    ['py', ['-3', '--version']],
    ['python3', ['--version']],
    ['python', ['--version']],
  ]
  for (const [cmd, args] of candidates) {
    const probe = spawnSync(cmd, args, { stdio: 'ignore', shell: false })
    if (probe.status === 0) return cmd
  }
  throw new Error(
    'FATAL: no working Python interpreter found (tried `py -3`, `python3`, `python`). ' +
      'Install Python 3 with `pip install "fonttools[woff]==4.55.3"` to regenerate the ' +
      'Material Symbols subset.',
  )
}

function runMaterialSymbolsSubset() {
  const python = resolvePython()
  const args = python === 'py' ? ['-3', MATERIAL_SYMBOLS_SUBSET_SCRIPT] : [MATERIAL_SYMBOLS_SUBSET_SCRIPT]
  const result = spawnSync(python, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: false })
  if (result.status !== 0) {
    throw new Error(
      `FATAL: ${MATERIAL_SYMBOLS_SUBSET_SCRIPT} exited with code ${result.status}. See output above.`,
    )
  }
}

function generateMaterialSymbolsTs() {
  if (!existsSync(MATERIAL_SYMBOLS_MANIFEST)) {
    throw new Error(
      `FATAL: ${MATERIAL_SYMBOLS_MANIFEST} not found -- did the subset script run and write ` +
        'its manifest?',
    )
  }
  const manifest = JSON.parse(readFileSync(MATERIAL_SYMBOLS_MANIFEST, 'utf8'))
  const glyphs = manifest.glyphs // { name: "U+XXXX", ... }
  const names = Object.keys(glyphs).sort()

  const entries = names
    .map((name) => {
      const hex = glyphs[name].replace(/^U\+/, '')
      // Every Material Symbols PUA codepoint here is in the BMP (U+E000-U+F8FF), so a plain
      // \uXXXX escape is exact -- no surrogate pair needed.
      return `  ${JSON.stringify(name)}: '\\u${hex}',`
    })
    .join('\n')

  const aliasNote = Object.entries(manifest.aliasesApplied || {})
    .map(([requested, actual]) => `//   - "${requested}" was requested but does not exist in this exact material-symbols version; rendering "${actual}" instead.`)
    .join('\n')

  const ts = `// GENERATED by scripts/build-fonts.mjs (via scripts/subset-material-symbols.py) -- do not edit by hand.
// Regenerate with: node scripts/build-fonts.mjs
//
// Maps every bundled Material Symbols Rounded glyph NAME to its private-use-area codepoint in
// the subsetted font at
// src/renderer/assets/fonts/material-symbols/material-symbols-rounded-subset.woff2 (see
// scripts/material-symbols-glyphs.json for the source glyph list, and
// scripts/material-symbols-codepoints.generated.json for the full build manifest).
//
// The MaterialSymbol component renders the codepoint character directly -- never the ligature
// name as text -- so a typo in a call site is a TypeScript compile error (an unknown key),
// never invisible tofu in a shipped build.
${aliasNote ? '//\n' + aliasNote + '\n' : ''}
export const MATERIAL_SYMBOLS = {
${entries}
} as const

export type MaterialSymbolName = keyof typeof MATERIAL_SYMBOLS
`
  writeFileSync(MATERIAL_SYMBOLS_TS_OUT, ts, 'utf8')
  return names.length
}

function main() {
  console.log('== nodeterm font pipeline ==\n')

  console.log('-- Outfit Variable --')
  const outfitResults = copyFonts(OUTFIT_SRC_DIR, OUTFIT_OUT_DIR, OUTFIT_FILES, '@fontsource-variable/outfit')
  for (const { file, size } of outfitResults) console.log(`  ${file}: ${size.toLocaleString()} bytes`)

  console.log('\n-- Roboto Mono --')
  const robotoResults = copyFonts(
    ROBOTO_MONO_SRC_DIR,
    ROBOTO_MONO_OUT_DIR,
    ROBOTO_MONO_FILES,
    '@fontsource/roboto-mono',
  )
  for (const { file, size } of robotoResults) console.log(`  ${file}: ${size.toLocaleString()} bytes`)

  console.log('\n-- Material Symbols Rounded (subsetting via Python/fontTools) --')
  runMaterialSymbolsSubset()
  const materialSymbolsSize = assertWoff2(MATERIAL_SYMBOLS_OUT_WOFF2)
  console.log(`  material-symbols-rounded-subset.woff2: ${materialSymbolsSize.toLocaleString()} bytes`)

  console.log('\n-- Generating MaterialSymbol codepoint map --')
  const count = generateMaterialSymbolsTs()
  console.log(`  wrote ${MATERIAL_SYMBOLS_TS_OUT.replace(REPO_ROOT + '\\', '').replace(REPO_ROOT + '/', '')} (${count} glyphs)`)

  const total =
    outfitResults.reduce((n, r) => n + r.size, 0) +
    robotoResults.reduce((n, r) => n + r.size, 0) +
    materialSymbolsSize
  console.log(`\nTotal committed font bytes: ${total.toLocaleString()}`)
  console.log('\nDone. Remember: this script never fetches over the network -- rerun `npm install` first if a source file is missing.')
}

main()
