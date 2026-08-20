#!/usr/bin/env node
/**
 * check-docs-bundle.mjs — the in-app documentation browser's completeness guard. Wired into
 * `npm run build`, so a stale or incomplete committed `src/shared/docs-data.ts` fails the build
 * rather than shipping a docs browser that quietly disagrees with `docs/`.
 *
 *   node scripts/check-docs-bundle.mjs
 *
 * Bundling drops a file exactly as easily as it includes one, and the symptom is invisible: the
 * screen still opens, the sidebar still has articles, and the missing one simply is not there.
 * Five checks, each a real way this rots:
 *
 *   1. EVERY eligible article on disk appears in the committed bundle. This is the contract stated
 *      directly, so a dropped file fails with "missing from the bundle" rather than only being
 *      implied by a byte diff that says "stale".
 *   2. Every bundled article still exists on disk — a doc deleted or renamed without regenerating
 *      leaves the browser offering a page nobody can reach from the tree any more.
 *   3. Every markdown file under `docs/` is CLASSIFIED: bundled, or matching one of the small,
 *      explicit exclusions in build-docs-bundle.mjs. A new `docs/<something>/` subtree that is
 *      neither cannot silently fall out of the bundle.
 *   4. `docs-data.ts` is regenerated IN MEMORY from the current tree (calling the exact same
 *      `renderDocsModule` the generator uses) and diffed against what is committed — this is what
 *      catches an EDITED doc whose bundle was never regenerated, plus title/section drift.
 *   5. The check cannot pass vacuously: an empty or implausibly small bundle, a bundled article
 *      with no body, and a docs tree that produced nothing all fail.
 *
 * It also REPORTS (never fails on) how many article-to-article links resolve inside the bundle.
 * `docs/` already contains links to files that do not exist — failing on those would be failing
 * the build for a pre-existing condition, and the browser handles them as an honest
 * "not in this bundle" state with a route to the same file on the hui.
 */
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  DOCS_DATA_PATH,
  DOCS_DIR,
  EXCLUDED_DIRS,
  bundledPaths,
  isExcluded,
  listDocsMarkdown,
  loadArticles,
  loadDocsModule,
  renderDocsModule
} from './build-docs-bundle.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

/** A bundle this far below the tree's real size means something ate most of it. Deliberately a
 *  floor well under today's count (111 markdown files, ~90 bundled) rather than an exact number
 *  that would need bumping with every new doc. */
const MIN_ARTICLES = 40

let failures = 0
let checkedCount = 0
function fail(message) {
  failures += 1
  console.error(`✗ ${message}`)
}
function pass(message) {
  checkedCount += 1
  console.log(`✓ ${message}`)
}

/** Pull the bundled article paths out of the COMMITTED generated module by parsing its text, not
 *  by importing it: importing would need a TS toolchain and, more importantly, would tell us what
 *  the module evaluates to rather than what is literally on disk. */
function committedPaths(source) {
  const out = []
  const re = /^\s{4}path: (".*?"),$/gm
  let m
  while ((m = re.exec(source)) !== null) {
    try {
      out.push(JSON.parse(m[1]))
    } catch {
      // A path literal we cannot parse is itself a corruption of the generated file; the
      // byte-diff check below reports it precisely, so nothing is lost by skipping it here.
    }
  }
  return out
}

/** Every `](...)` target in a markdown body that points at a `.md` file. Deliberately crude: this
 *  is a report, not a gate, and a reference-style or HTML link it misses costs nothing. */
function markdownLinkTargets(body) {
  const out = []
  const re = /\]\(([^)\s]+\.md(?:#[^)\s]*)?)\)/g
  let m
  while ((m = re.exec(body)) !== null) out.push(m[1])
  return out
}

/**
 * Every backticked repository path an article cites, with any `:line` or `:line-line` suffix
 * stripped.
 *
 * This exists because a document that names a file which no longer exists is this repository’s
 * named disease, and these articles are BUNDLED — a dead path here is not a private
 * embarrassment, it ships to users in the documentation browser and tells them to open
 * something that is not there. When this was first measured: 594 cited paths, 10 dead.
 *
 * Deliberately narrow about what counts as a citation:
 *   - only the five real source roots, so prose like `npm run build` or `main` is not a path;
 *   - nothing containing a space, a glob, or an angle-bracket placeholder such as
 *     `src/foo/<id>.ts`, because those name a SHAPE rather than a file;
 *   - the excluded trees are whatever the bundle already excludes, which is the point: agent
 *     working plans are historical records and SHOULD cite files that have since been deleted.
 */
function citedRepoPaths(body) {
  const out = []
  const re = /`([^`]+)`/g
  let m
  while ((m = re.exec(body)) !== null) {
    const raw = m[1].trim()
    if (!/^(src|scripts|site|design|test)\//.test(raw)) continue
    if (/[\s*?<>|]/.test(raw)) continue
    out.push(raw.replace(/:\d+(-\d+)?$/, ""))
  }
  return out
}

async function main() {
  const docsDirPath = join(REPO_ROOT, DOCS_DIR)
  if (!existsSync(docsDirPath)) {
    fail(`cannot read ${DOCS_DIR}/ — nothing to verify`)
    finish()
    return
  }

  const onDisk = listDocsMarkdown(REPO_ROOT)
  const expectedPaths = bundledPaths(REPO_ROOT)
  const articles = await loadArticles(REPO_ROOT)

  // --- 5. never pass vacuously -------------------------------------------------
  checkedCount += 1
  if (articles.length < MIN_ARTICLES) {
    fail(
      `only ${articles.length} article(s) collected from ${DOCS_DIR}/ — expected at least ${MIN_ARTICLES}. ` +
        `Either the tree lost most of its documentation or the collector stopped walking it.`
    )
  } else {
    pass(`${articles.length} article(s) collected from ${DOCS_DIR}/`)
  }

  checkedCount += 1
  const empty = articles.filter((a) => !a.body.trim())
  if (empty.length > 0) {
    fail(`${empty.length} bundled article(s) have an empty body: ${empty.map((a) => a.path).join(', ')}`)
  } else {
    pass('every collected article carries a non-empty body')
  }

  // --- 3. every markdown file under docs/ is classified ------------------------
  const expectedSet = new Set(expectedPaths)
  const unclassified = onDisk.filter((p) => !expectedSet.has(p) && !isExcluded(p))
  checkedCount += 1
  if (unclassified.length > 0) {
    fail(
      `${unclassified.length} markdown file(s) under ${DOCS_DIR}/ are neither bundled nor excluded — ` +
        `add them to the bundle or add an explicit exclusion in scripts/build-docs-bundle.mjs:\n    ` +
        unclassified.join('\n    ')
    )
  } else {
    const excludedCount = onDisk.length - expectedPaths.length
    pass(
      `all ${onDisk.length} markdown file(s) under ${DOCS_DIR}/ are classified ` +
        `(${expectedPaths.length} bundled, ${excludedCount} explicitly excluded)`
    )
  }

  // --- 1 & 2. the committed bundle carries exactly the eligible articles -------
  const dataPath = join(REPO_ROOT, DOCS_DATA_PATH)
  const committedSource = existsSync(dataPath) ? readFileSync(dataPath, 'utf8') : null

  checkedCount += 1
  if (committedSource === null) {
    fail(`${DOCS_DATA_PATH} does not exist — run \`node scripts/build-docs-bundle.mjs\``)
  } else {
    pass(`${DOCS_DATA_PATH} exists`)

    const committed = committedPaths(committedSource)
    const committedSet = new Set(committed)

    checkedCount += 1
    const missingFromBundle = expectedPaths.filter((p) => !committedSet.has(p))
    if (missingFromBundle.length > 0) {
      fail(
        `${missingFromBundle.length} article(s) exist in ${DOCS_DIR}/ but are MISSING FROM THE BUNDLE ` +
          `— the in-app documentation browser cannot show them. Run \`node scripts/build-docs-bundle.mjs\` ` +
          `and commit the result:\n    ` +
          missingFromBundle.join('\n    ')
      )
    } else {
      pass(`all ${expectedPaths.length} eligible article(s) are present in ${DOCS_DATA_PATH}`)
    }

    checkedCount += 1
    const goneFromDisk = committed.filter((p) => !expectedSet.has(p))
    if (goneFromDisk.length > 0) {
      fail(
        `${goneFromDisk.length} article(s) are bundled but no longer eligible on disk (deleted, renamed ` +
          `or newly excluded) — run \`node scripts/build-docs-bundle.mjs\`:\n    ` +
          goneFromDisk.join('\n    ')
      )
    } else {
      pass('every bundled article still exists on disk')
    }

    // --- 4. the committed generated file is not stale --------------------------
    checkedCount += 1
    const expected = renderDocsModule(articles)
    // Compare with line endings normalized: the working tree is CRLF on Windows and LF on POSIX,
    // and a checkout-dependent diff would report a perfectly current bundle as stale.
    if (committedSource.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
      fail(
        `${DOCS_DATA_PATH} is stale relative to ${DOCS_DIR}/ — a bundled doc was edited (or its title/` +
          `section changed) without regenerating. Run \`node scripts/build-docs-bundle.mjs\` and commit the result.`
      )
    } else {
      pass(`${DOCS_DATA_PATH} matches what ${DOCS_DIR}/ generates`)
    }
  }

  // --- 6. no bundled article cites a repository path that does not exist ------
  checkedCount += 1
  {
    const dead = []
    let citedCount = 0
    for (const a of articles) {
      for (const cited of citedRepoPaths(a.body)) {
        citedCount += 1
        if (!existsSync(join(REPO_ROOT, cited))) dead.push(`${a.path} → ${cited}`)
      }
    }
    if (dead.length > 0) {
      fail(
        `${dead.length} of ${citedCount} cited repository path(s) do not exist — these articles are ` +
          `bundled, so this ships to users as an instruction to open a file that is not there:` +
          `\n    ${dead.join("\n    ")}`
      )
    } else {
      pass(`all ${citedCount} backticked repository path(s) cited by bundled articles exist on disk`)
    }
  }

  // --- report: how many article-to-article links land inside the bundle -------
  let linkCount = 0
  const unresolved = new Set()
  const mod = await loadDocsModule(REPO_ROOT)
  for (const a of articles) {
    for (const href of markdownLinkTargets(a.body)) {
      linkCount += 1
      const target = mod.resolveDocLink(a.path, href, expectedSet)
      if (target.kind !== 'article') unresolved.add(`${a.path} → ${href}`)
    }
  }
  console.log('')
  console.log(
    `${linkCount} article-to-article link(s); ${linkCount - unresolved.size} resolve inside the bundle, ` +
      `${unresolved.size} point outside it (rendered as an honest "not in this bundle" state, not a dead click).`
  )
  for (const u of [...unresolved].sort()) console.log(`    · ${u}`)

  console.log('')
  console.log(`Excluded trees (${EXCLUDED_DIRS.length}):`)
  for (const e of EXCLUDED_DIRS) console.log(`    · ${e.prefix} — ${e.reason}`)

  finish()
}

function finish() {
  console.log('')
  console.log(`check-docs-bundle.mjs: ${checkedCount} assertion(s) checked.`)
  if (failures > 0) {
    console.error(`\n${failures} FAILURE(S).`)
    process.exitCode = 1
  } else {
    console.log('\nAll clear. ✓')
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error('check-docs-bundle.mjs failed:', err)
    process.exitCode = 1
  })
}
