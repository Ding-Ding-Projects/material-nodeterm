#!/usr/bin/env node
/**
 * build-changelog.mjs — regenerates `src/shared/changelog-data.ts` from the root `CHANGELOG.md`.
 *
 * The renderer's changelog viewer never reads CHANGELOG.md at runtime (it does not ship in a
 * packaged app — see `build.files` in package.json — and Server Edition runs in a browser with no
 * filesystem to read it from). It imports the committed, compiled `changelog-data.ts` this script
 * produces instead. See docs/changelog-viewer.md.
 *
 * Run this after editing CHANGELOG.md, then commit the regenerated `changelog-data.ts` alongside
 * it. `scripts/check-changelog.mjs` (wired into `npm run build`) fails the build if the two have
 * drifted apart — it regenerates the same module in memory and diffs it against what's on disk,
 * so a CHANGELOG.md edit with no matching regeneration is caught before it ships silently stale.
 *
 * The actual parsing logic lives in `src/shared/changelog.ts` (TypeScript, unit-tested, and also
 * imported by the renderer for its types) — this script transpiles that ONE file with esbuild
 * (already a project devDependency; see `server:build`/`host:build` for the same tool used the
 * same way elsewhere in this repo) rather than re-implementing the parser a second time in plain
 * JS, which is exactly the kind of duplicated rule this codebase's own CLAUDE.md warns drifts.
 *
 * Usage:
 *   node scripts/build-changelog.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const CHANGELOG_SOURCE_MODULE = 'src/shared/changelog.ts'
export const CHANGELOG_MD_PATH = 'CHANGELOG.md'
export const CHANGELOG_DATA_PATH = 'src/shared/changelog-data.ts'

/** Transpile-and-load `src/shared/changelog.ts` (a leaf module — no imports of its own) so this
 *  plain-JS script can call its exported `parseChangelog` without a second, drift-prone copy of
 *  the parser. A data: URL import needs no temp file and leaves nothing to clean up. */
async function loadChangelogModule(repoRoot) {
  const src = readFileSync(join(repoRoot, CHANGELOG_SOURCE_MODULE), 'utf8')
  const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'esm', target: 'node18' })
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  return import(dataUrl)
}

function jsonBullet(value) {
  // JSON.stringify already escapes everything a TS string literal needs; the generated file is
  // read by tsc/esbuild, never eval'd, so this is a plain safe literal, not a template hazard.
  return JSON.stringify(value)
}

/** Render the parsed releases into the exact `changelog-data.ts` source text. A pure function of
 *  its input, so the generator and `check-changelog.mjs`'s in-memory regeneration always produce
 *  byte-identical output for the same CHANGELOG.md — which is the whole point of the diff check. */
export function renderChangelogModule(releases) {
  const lines = []
  lines.push('// GENERATED FILE — do not hand-edit.')
  lines.push('//')
  lines.push('// Produced by `node scripts/build-changelog.mjs` from the root CHANGELOG.md. Re-run that')
  lines.push('// script after editing CHANGELOG.md and commit the result — `npm run build` runs')
  lines.push('// `scripts/check-changelog.mjs`, which fails the build if this file has drifted from')
  lines.push('// CHANGELOG.md. See docs/changelog-viewer.md.')
  lines.push("import type { ChangelogRelease } from './changelog'")
  lines.push('')
  lines.push('export const CHANGELOG_RELEASES: ChangelogRelease[] = [')
  for (const r of releases) {
    lines.push('  {')
    lines.push(`    version: ${jsonBullet(r.version)},`)
    lines.push(`    date: ${r.date === null ? 'null' : jsonBullet(r.date)},`)
    lines.push(`    dateMs: ${r.dateMs === null ? 'null' : r.dateMs},`)
    lines.push('    commits: [')
    for (const c of r.commits) {
      lines.push(`      { sha: ${jsonBullet(c.sha)}, label: ${jsonBullet(c.label)}, url: ${jsonBullet(c.url)} },`)
    }
    lines.push('    ],')
    lines.push('    items: [')
    for (const it of r.items) {
      lines.push(`      { category: ${jsonBullet(it.category)}, text: ${jsonBullet(it.text)} },`)
    }
    lines.push('    ],')
    lines.push('  },')
  }
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

/** Parse CHANGELOG.md and return the releases it describes — the one function both this script's
 *  `main()` and `check-changelog.mjs` call, so "what did we parse" is asked exactly once. */
export async function loadReleases(repoRoot = REPO_ROOT) {
  const mod = await loadChangelogModule(repoRoot)
  const markdown = readFileSync(join(repoRoot, CHANGELOG_MD_PATH), 'utf8')
  return mod.parseChangelog(markdown)
}

async function main() {
  const releases = await loadReleases(REPO_ROOT)
  const out = renderChangelogModule(releases)
  writeFileSync(join(REPO_ROOT, CHANGELOG_DATA_PATH), out, 'utf8')
  console.log(`Wrote ${CHANGELOG_DATA_PATH} — ${releases.length} release(s) from ${CHANGELOG_MD_PATH}.`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error('build-changelog.mjs failed:', err)
    process.exitCode = 1
  })
}
