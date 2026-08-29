// The site's copy of the app captures must be byte-identical to the canonical set.
//
// GitHub Pages serves ONLY site/ (.github/workflows/pages.yml: `path: site`), so a capture that
// lives solely under docs/assets/shots/ is a 404 on the site. scripts/capture-shots.mjs therefore
// writes BOTH locations in one run — but "written by one run" is a property of the code, not of the
// tree, and the tree is what ships. Someone re-crops one copy, or restores one from an old commit,
// and the site starts publishing a picture the docs disagree with. Nothing else would notice.
//
// So this compares the actual bytes. It also fails when the site copy is MISSING, which is the more
// likely direction: a new required surface added to the harness by someone running an older
// checkout leaves docs/ ahead of site/.
//
//     node scripts/check-site-shots.mjs
//
// Wired into `npm run check:app-contract`'s neighbours rather than the build, because a mismatch is
// a publishing defect, not a compile error.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CANON = join(ROOT, 'docs/assets/shots')
const SITE = join(ROOT, 'site/assets/shots')

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

// Only the app captures are mirrored. The site-*.png set are captures OF the site and have no
// reason to be served back to it, so they are deliberately not copied and not checked here.
const appShots = readdirSync(CANON).filter((f) => f.startsWith('app-') && f.endsWith('.png'))

const problems = []

if (appShots.length === 0) {
  // A sweep that finds nothing passes vacuously, which is exactly how a screenshot check ends up
  // proving nothing at all.
  problems.push('no app-*.png captures found in docs/assets/shots — run `npm run shots -- --launch`')
}

for (const name of appShots) {
  const sitePath = join(SITE, name)
  if (!existsSync(sitePath)) {
    problems.push(`${name}: missing from site/assets/shots — the site would 404 this image`)
    continue
  }
  const a = sha(join(CANON, name))
  const b = sha(sitePath)
  if (a !== b) {
    problems.push(`${name}: site copy differs from the canonical capture (${a.slice(0, 12)} vs ${b.slice(0, 12)})`)
  }
}

// The reverse direction matters too: a site copy with no canonical original is an image nobody can
// re-take, and it will quietly outlive the interface it shows.
if (existsSync(SITE)) {
  for (const name of readdirSync(SITE).filter((f) => f.startsWith('app-') && f.endsWith('.png'))) {
    if (!existsSync(join(CANON, name))) {
      problems.push(`${name}: in site/assets/shots with no canonical capture behind it`)
    }
  }
}

if (problems.length) {
  console.error('Site capture mirror is out of sync:\n')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error('\nRe-run `npm run shots -- --launch`, which writes both locations in one pass.')
  process.exit(1)
}

console.log(`✓ site capture mirror: ${appShots.length} app captures byte-identical in docs/ and site/`)
