#!/usr/bin/env node
/**
 * build-docs-bundle.mjs — regenerates `src/shared/docs-data.ts` from the `docs/` tree.
 *
 * The in-app documentation browser never reads `docs/*.md` at runtime. The `docs/` tree is not
 * part of `build.files` in package.json, so it does not ship in a packaged app, and Server Edition
 * runs in a browser with no filesystem to read it from — a runtime read would ship an empty
 * documentation browser in every real install while looking perfect in `npm run dev`. The browser
 * imports the committed, compiled `docs-data.ts` this script produces instead. Same arrangement,
 * for the same two reasons, as `build-changelog.mjs` / `changelog-data.ts`.
 *
 * Run this after adding or editing any bundled doc, then commit the regenerated `docs-data.ts`
 * alongside it. `scripts/check-docs-bundle.mjs` (wired into `npm run build`) fails the build if
 * the two have drifted — bundling drops a file exactly as easily as it includes one.
 *
 * The article-shaping logic lives in `src/shared/docs.ts` (TypeScript, unit-tested, and imported
 * by the renderer for its types) — this script transpiles that ONE file with esbuild rather than
 * re-implementing it in plain JS, which is exactly the kind of duplicated rule CLAUDE.md warns
 * drifts.
 *
 * Usage:
 *   node scripts/build-docs-bundle.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const DOCS_SOURCE_MODULE = 'src/shared/docs.ts'
export const DOCS_DIR = 'docs'
export const DOCS_DATA_PATH = 'src/shared/docs-data.ts'

/**
 * Directories under `docs/` that are deliberately NOT reader-facing articles, each with the reason
 * it is excluded. This list is small, explicit and reviewed on purpose: `check-docs-bundle.mjs`
 * fails when a markdown file is neither bundled nor covered here, so a new docs subtree cannot
 * quietly fall out of the bundle the way an "everything except what I remembered" filter allows.
 */
export const EXCLUDED_DIRS = [
  {
    prefix: 'docs/superpowers/',
    reason: 'agent working plans and specs — internal process notes, not product documentation'
  },
  {
    prefix: 'docs/assets/',
    reason: 'READMEs describing generated capture/social assets, not articles a reader navigates to'
  }
]

/** Transpile-and-load `src/shared/docs.ts` (a leaf module — no imports of its own) so this
 *  plain-JS script can call its exported helpers without a second, drift-prone copy of them. A
 *  data: URL import needs no temp file and leaves nothing to clean up. */
export async function loadDocsModule(repoRoot = REPO_ROOT) {
  const src = readFileSync(join(repoRoot, DOCS_SOURCE_MODULE), 'utf8')
  const { code } = esbuild.transformSync(src, { loader: 'ts', format: 'esm', target: 'node18' })
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  return import(dataUrl)
}

/** Every markdown file under `docs/`, as repo-relative POSIX paths, sorted. Sorted rather than
 *  directory-order because `readdirSync` order is filesystem-dependent, and the guard diffs this
 *  script's output byte-for-byte against what is committed — an unstable order would make the
 *  bundle "stale" on a different machine for no real reason. */
export function listDocsMarkdown(repoRoot = REPO_ROOT) {
  const out = []
  const walk = (relDir) => {
    const abs = join(repoRoot, relDir)
    for (const entry of readdirSync(abs)) {
      const rel = `${relDir}/${entry}`
      if (statSync(join(repoRoot, rel)).isDirectory()) walk(rel)
      else if (entry.toLowerCase().endsWith('.md')) out.push(rel)
    }
  }
  walk(DOCS_DIR)
  return out.sort()
}

/** True when this path is one of the deliberately-excluded trees above. */
export function isExcluded(path) {
  return EXCLUDED_DIRS.some((e) => path.startsWith(e.prefix))
}

/** The paths that belong in the bundle: every markdown file under `docs/` that is not explicitly
 *  excluded. Deliberately a subtraction, not an allowlist — a new article is included by default,
 *  so the failure mode of forgetting is a bigger bundle, never a missing article. */
export function bundledPaths(repoRoot = REPO_ROOT) {
  return listDocsMarkdown(repoRoot).filter((p) => !isExcluded(p))
}

/** Read + shape every bundled article. The ONE function this script's `main()` and the guard's
 *  in-memory regeneration both call, so "what did we bundle" is asked exactly once. */
export async function loadArticles(repoRoot = REPO_ROOT) {
  const mod = await loadDocsModule(repoRoot)
  return bundledPaths(repoRoot).map((path) => {
    // Normalize CRLF at the bundling boundary: this repo's working tree is CRLF on Windows and LF
    // on POSIX, and the generated module is diffed byte-for-byte by the guard. Without this, the
    // same commit generates two different files depending on the machine, and every Windows
    // checkout reports the bundle as permanently stale.
    const markdown = readFileSync(join(repoRoot, path), 'utf8').replace(/\r\n/g, '\n')
    return mod.buildArticle(path, markdown)
  })
}

/** Render the articles into the exact `docs-data.ts` source text. A pure function of its input, so
 *  the generator and the guard's in-memory regeneration always produce byte-identical output for
 *  the same tree — which is the whole point of the diff check. */
export function renderDocsModule(articles) {
  const lines = []
  lines.push('// GENERATED FILE — do not hand-edit.')
  lines.push('//')
  lines.push('// Produced by `node scripts/build-docs-bundle.mjs` from the `docs/` tree. Re-run that')
  lines.push('// script after adding or editing a bundled doc and commit the result — `npm run build`')
  lines.push('// runs `scripts/check-docs-bundle.mjs`, which fails the build if this file has drifted')
  lines.push('// from disk. See docs/features/help/in-app-documentation.md.')
  lines.push("import type { DocArticle } from './docs'")
  lines.push('')
  lines.push('export const DOC_ARTICLES: DocArticle[] = [')
  for (const a of articles) {
    lines.push('  {')
    lines.push(`    path: ${JSON.stringify(a.path)},`)
    lines.push(`    title: ${JSON.stringify(a.title)},`)
    lines.push(`    section: ${JSON.stringify(a.section)},`)
    // JSON.stringify escapes everything a TS string literal needs (quotes, backslashes, newlines,
    // U+2028/9 are emitted literally but are legal in a TS string). The generated file is read by
    // tsc/esbuild, never eval'd, so this is a plain safe literal.
    lines.push(`    body: ${JSON.stringify(a.body)}`)
    lines.push('  },')
  }
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const articles = await loadArticles(REPO_ROOT)
  writeFileSync(join(REPO_ROOT, DOCS_DATA_PATH), renderDocsModule(articles), 'utf8')
  const bytes = articles.reduce((n, a) => n + a.body.length, 0)
  console.log(
    `Wrote ${DOCS_DATA_PATH} — ${articles.length} article(s), ${(bytes / 1024).toFixed(0)} KiB of markdown from ${DOCS_DIR}/.`
  )
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error('build-docs-bundle.mjs failed:', err)
    process.exitCode = 1
  })
}
