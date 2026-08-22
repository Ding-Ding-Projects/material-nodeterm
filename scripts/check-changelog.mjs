#!/usr/bin/env node
/**
 * check-changelog.mjs — the changelog viewer's completeness guard. Wired into `npm run build`, so
 * a stale or malformed committed `src/shared/changelog-data.ts` fails the build rather than
 * shipping a changelog viewer that quietly disagrees with CHANGELOG.md.
 *
 *   node scripts/check-changelog.mjs
 *
 * Four checks, each one a real way this feature can silently rot:
 *
 *   1. Every commit SHA referenced in CHANGELOG.md resolves in THIS checkout's git history
 *      (`git cat-file -e <sha>^{commit}`). Offline and deterministic — no network call, no GitHub
 *      API — so a bad/typo'd SHA is caught the same way in CI, on a laptop, or on a packaging
 *      machine, as long as the checkout has the object (full history, not a shallow fetch of just
 *      the tip — the same requirement scripts/count-lines.mjs already has for `git blame`).
 *   2. Every commit link's visible TEXT agrees with its HREF: a short label (the "Unreleased"
 *      section's 8-char prefixes) must `git rev-parse` to the exact 40-char SHA the link points
 *      at; a full-length label must equal it outright. A link whose text and href disagree is a
 *      changelog that shows the reader one commit and sends them to another.
 *   3. `src/shared/changelog-data.ts` is regenerated IN MEMORY from the current CHANGELOG.md
 *      (calling the exact same `renderChangelogModule` build-changelog.mjs uses) and diffed
 *      byte-for-byte against what is actually committed on disk. CHANGELOG.md is hand-maintained;
 *      nothing stops someone editing it without re-running `node scripts/build-changelog.mjs` —
 *      this is what catches that before it ships a viewer showing an old release list.
 *   4. The parse cannot pass vacuously: fewer than 3 parsed releases, or a mismatch between the
 *      number of `## [` headings in CHANGELOG.md and the number of releases actually parsed
 *      (a parser regression that silently drops or merges a release), both fail the build.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { CHANGELOG_MD_PATH, CHANGELOG_DATA_PATH, loadReleases, renderChangelogModule } from './build-changelog.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

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

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
}

async function main() {
  const changelogPath = join(REPO_ROOT, CHANGELOG_MD_PATH)
  if (!existsSync(changelogPath)) {
    fail(`cannot read ${CHANGELOG_MD_PATH} — nothing to verify`)
    finish()
    return
  }
  const markdown = readFileSync(changelogPath, 'utf8')
  const releases = await loadReleases(REPO_ROOT)

  // --- 4. never pass vacuously -------------------------------------------------
  checkedCount += 1
  if (releases.length < 3) {
    fail(`only ${releases.length} release(s) parsed from ${CHANGELOG_MD_PATH} — that is not a real changelog window (expected at least 3)`)
  } else {
    pass(`${releases.length} release(s) parsed`)
  }

  checkedCount += 1
  const headingCount = (markdown.match(/^## \[/gm) || []).length
  if (headingCount !== releases.length) {
    fail(
      `${CHANGELOG_MD_PATH} has ${headingCount} "## [" heading(s) but the parser produced ${releases.length} release(s) — ` +
        `the parser silently dropped or merged one`
    )
  } else {
    pass(`heading count (${headingCount}) matches parsed release count`)
  }

  // --- 3. the committed generated file is not stale ----------------------------
  checkedCount += 1
  const dataPath = join(REPO_ROOT, CHANGELOG_DATA_PATH)
  const expected = renderChangelogModule(releases)
  const actual = existsSync(dataPath) ? readFileSync(dataPath, 'utf8') : null
  if (actual === null) {
    fail(`${CHANGELOG_DATA_PATH} does not exist — run \`node scripts/build-changelog.mjs\``)
  } else if (actual.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n')) {
    fail(`${CHANGELOG_DATA_PATH} is stale relative to ${CHANGELOG_MD_PATH} — run \`node scripts/build-changelog.mjs\` and commit the result`)
  } else {
    pass(`${CHANGELOG_DATA_PATH} matches what ${CHANGELOG_MD_PATH} generates`)
  }

  // --- 1 & 2. commit SHAs resolve, and every link's text agrees with its href --
  const uniqueShas = new Set()
  let commitLinkCount = 0
  for (const r of releases) {
    for (const c of r.commits) {
      commitLinkCount += 1
      uniqueShas.add(c.sha)

      checkedCount += 1
      if (c.label.length === 40) {
        if (c.label !== c.sha) {
          fail(`${r.version}: commit link text "${c.label}" (full length) does not equal its href sha ${c.sha}`)
        } else {
          pass(`${r.version}: commit link text agrees with its href (${c.sha})`)
        }
      } else {
        try {
          const resolved = git(['rev-parse', c.label])
          if (resolved !== c.sha) {
            fail(`${r.version}: commit link text "${c.label}" resolves to ${resolved}, not the linked ${c.sha}`)
          } else {
            pass(`${r.version}: commit link text "${c.label}" resolves to its linked sha`)
          }
        } catch (err) {
          fail(`${r.version}: \`git rev-parse ${c.label}\` failed — ${err.message.split('\n')[0]}`)
        }
      }
    }
  }

  for (const sha of uniqueShas) {
    checkedCount += 1
    try {
      git(['cat-file', '-e', `${sha}^{commit}`])
      pass(`commit ${sha} exists in this checkout's history`)
    } catch {
      fail(`commit ${sha} (referenced in CHANGELOG.md) does not exist in this checkout — a shallow clone, or a bad SHA`)
    }
  }

  console.log('')
  console.log(
    `Checked ${releases.length} release(s), ${commitLinkCount} commit link(s), ${uniqueShas.size} unique commit(s).`
  )
  finish()
}

function finish() {
  console.log('')
  console.log(`check-changelog.mjs: ${checkedCount} assertion(s) checked.`)
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
    console.error('check-changelog.mjs failed:', err)
    process.exitCode = 1
  })
}
