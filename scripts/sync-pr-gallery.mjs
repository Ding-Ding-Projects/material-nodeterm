// Keep a pull request's screenshot gallery in step with the captures on disk.
//
//   node scripts/sync-pr-gallery.mjs --repo eneskirca/nodeterm --pr 441
//   node scripts/sync-pr-gallery.mjs --pr 12                    (this repository)
//   node scripts/sync-pr-gallery.mjs --pr 441 --repo x/y --dry-run
//
// WHY THIS EXISTS. A gallery in a pull request body goes stale the moment the interface
// moves, exactly like the committed captures themselves do, and a stale screenshot is worse
// than none: it is confidently wrong and a reader cannot tell. `npm run shots` refreshes the
// files; this refreshes the pictures somebody is actually looking at.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE PART THAT IS NOT OBVIOUS, AND THE REASON THIS IS A SCRIPT RATHER THAN A BRANCH URL.
//
// The tempting fix is to point every image at a BRANCH instead of a commit:
//
//     .../material-nodeterm/main/docs/assets/shots/app-04-canvas.png
//
// so that pushing a new capture updates the picture for free. It does not work reliably.
// GitHub does not hot-link images in issue and pull request bodies; it rewrites them through
// its own image proxy, which caches by URL. A URL that never changes is a cache entry that
// never changes either, so the old picture can keep being served long after the file behind it
// was replaced. The raw CDN caches too.
//
// So the URL itself has to move. Every image here is pinned to an exact commit, and this script
// re-pins them, which changes every URL and sidesteps both caches by construction. That also
// buys the property the pinning was for in the first place: a reader opening this pull request
// in a year sees the app as it was at the commit under discussion, not as it is now.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// The gallery is written between two markers, so everything else in the body is left alone:
//
//     <!-- huishots:start -->   ... generated ...   <!-- huishots:end -->
//
// A body with no markers gets them appended once, at the end.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS_DIR = join(ROOT, 'docs', 'assets', 'shots')
const START = '<!-- huishots:start -->'
const END = '<!-- huishots:end -->'

/**
 * The gallery, as content rather than as markup. Captions live here so a re-run regenerates the
 * same prose against a new commit; only the URLs move.
 *
 * `featured` images render inline. The rest go in a collapsed block, because a pull request body
 * that is thirty images tall is not a gallery, it is an obstacle.
 */
const GALLERY = [
  { id: 'app-04-canvas', anchor: 'Exhibit A: the damage', featured: true, title: 'The canvas, which is the part you would recognise', alt: 'The canvas rendered in Material Design 3', caption: 'Same idea. Different wardrobe. Every button on that screen is a real Material Design 3 button with a state layer, which we mention because until recently they were not and nobody had noticed for months.' },
  { id: 'app-02-settings', anchor: 'The regex builder', featured: true, title: 'Settings, all thirty five sections of it', alt: 'The settings surface', caption: 'There is a search field at the top and a regex builder anchored to it. There is one anchored to every search field in the application, because the rule here is that every list gets a search and every search gets a builder.' },
  { id: 'app-settings-language', anchor: 'The two funny level sliders', featured: true, title: 'The one that should actually make you jealous', alt: 'Language modes and the two funny level sliders', caption: 'Two sliders, one per language, controlling how funny the software is permitted to be, from 1 to 5. They ship at 5. This pull request was written at 5.' },
  { id: 'app-settings-narrator', anchor: 'The narrator', featured: true, title: 'The narrator, which talks', alt: 'Narrator settings with language, voice, rate and pitch', caption: 'Out loud. In your room. A voice picker per language, with an honest line underneath when the voice you chose is not installed on this machine, rather than silently substituting one.' },
  { id: 'app-adhd-modes', anchor: 'The five ADHD modes', featured: true, title: 'Five ADHD modes that were previously five promises', alt: 'The five ADHD modes', caption: 'Focus, low stimulation, time awareness, one thing at a time, momentum. All off by default, all independent, none of them keeping score of you.' },
  { id: 'app-kids-home', anchor: 'Kids mode', featured: true, title: 'Kids mode, which is a second application wearing a hat', alt: 'Kids mode home screen', caption: 'The canvas stops rendering when this is on. Not hidden behind a class. Stops.' },
  { id: 'app-settings-appearance-editor', anchor: 'The appearance editor', featured: true, title: 'The appearance editor, for one element, forever', alt: 'The per element appearance editor', caption: 'Word processor depth typography, plus opacity, sixteen blend modes, an eight filter stack, backdrop blur and transforms. Every field unset by default, so an untouched element renders byte identical CSS to before this existed.' },
  { id: 'app-windows-terminal-profiles', anchor: 'The Windows session host', featured: true, title: 'Windows terminal profiles, from the part that took longest', alt: 'Windows terminal profile picker', caption: 'Behind this picker is a from scratch tmux equivalent with real PTYs and server side screen reconstruction, so a Windows user closing the app still has their terminals tomorrow. This one is not a joke.' },
  { id: 'app-03-palette', anchor: 'Exhibit C: why ours is better', featured: false, title: 'The command palette', alt: 'The command palette' },
  { id: 'app-05-kanban', anchor: 'The dinosaur', featured: false, title: 'The board', alt: 'The kanban board of sessions' },
  { id: 'app-status-surface', anchor: 'The documentation browser', featured: false, title: 'The status surface', alt: 'The status surface' },
  { id: 'app-settings-schedule', anchor: 'Scheduled settings', featured: false, title: 'Scheduled settings', alt: 'The scheduled settings editor' },
  { id: 'site-toy-locks', anchor: 'Toy locks, and the ladder out of them', featured: false, title: 'Toy locks, on the documentation site, which has all of this too', alt: 'Toy locks on the documentation site' },
  { id: 'site-search-regex-builder', anchor: 'The infinite colour picker', featured: false, title: 'The anchored regex builder', alt: 'The anchored regex builder' }
]

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

const dryRun = process.argv.includes('--dry-run')
const prNumber = arg('pr')
if (!prNumber) {
  console.error('usage: node scripts/sync-pr-gallery.mjs --pr <number> [--repo owner/name] [--dry-run]')
  process.exit(2)
}
const repo = arg('repo')

// ── The commit the pictures will point at ────────────────────────────────────────────────────
const sha = git('rev-parse', 'HEAD')

// A commit that is not on the remote yields 404 for every image, and a pull request full of
// broken images is a worse outcome than a stale one. Refuse rather than publish that.
let onRemote = false
try {
  onRemote = git('branch', '-r', '--contains', sha).trim().length > 0
} catch {
  onRemote = false
}
if (!onRemote) {
  console.error(`✗ ${sha.slice(0, 8)} is not on any remote branch yet.`)
  console.error('  Every image URL would 404. Push first, then re-run.')
  process.exit(1)
}

// The owner/name the RAW urls are served from is always this repository, even when the pull
// request lives upstream: the captures are ours, and a fork's commit is not fetchable from the
// upstream path.
const originUrl = git('remote', 'get-url', 'origin')
const slug = originUrl.replace(/\.git$/, '').replace(/^.*github\.com[/:]/, '')
if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) {
  console.error(`✗ could not read an owner/name out of origin: ${originUrl}`)
  process.exit(1)
}

// ── Build ────────────────────────────────────────────────────────────────────────────────────
const missing = GALLERY.filter((g) => !existsSync(join(SHOTS_DIR, `${g.id}.png`)))
if (missing.length) {
  // Same rule the capture harness uses: a named surface that is not there is a defect, not a gap.
  console.error('✗ these gallery entries have no capture on disk:')
  for (const m of missing) console.error(`    ${m.id}.png`)
  console.error('  Run `npm run shots` first, or remove the entry from GALLERY.')
  process.exit(1)
}

const url = (id) => `https://raw.githubusercontent.com/${slug}/${sha}/docs/assets/shots/${id}.png`

/** One image, fenced by its own markers so a re-run replaces exactly this block and nothing else. */
function block(g) {
  const width = g.featured ? 900 : 820
  const lines = [
    `<!-- huishot:${g.id}:start -->`,
    '',
    `<img src="${url(g.id)}" alt="${g.alt}" width="${width}">`
  ]
  if (g.caption) lines.push('', `<sub>${g.caption}</sub>`)
  lines.push('', `<!-- huishot:${g.id}:end -->`)
  return lines.join('\n')
}

// ── Splice, scattered ────────────────────────────────────────────────────────────────────────
// Images are placed under the section each one is ABOUT, rather than collected into one gallery
// at the end. A wall of screenshots is skipped as a unit; a picture that interrupts the paragraph
// describing it is the one a reader actually stops on.
const view = ['pr', 'view', prNumber, '--json', 'body', '-q', '.body']
if (repo) view.splice(3, 0, '--repo', repo)
let body = execFileSync('gh', view, { encoding: 'utf8' })

const placed = []
const orphaned = []

for (const g of GALLERY) {
  const start = `<!-- huishot:${g.id}:start -->`
  const end = `<!-- huishot:${g.id}:end -->`

  // Already placed once: re-pin in situ, wherever the author has since moved it to.
  if (body.includes(start) && body.includes(end)) {
    const a = body.indexOf(start)
    const b = body.indexOf(end) + end.length
    body = body.slice(0, a) + block(g) + body.slice(b)
    placed.push(g.id)
    continue
  }

  // First placement: find the heading this image belongs under and sit directly beneath it.
  const heading = body.split('\n').findIndex(
    (line) => line.startsWith('#') && line.toLowerCase().includes(g.anchor.toLowerCase())
  )
  if (heading === -1) {
    orphaned.push(g.id)
    continue
  }
  const lines = body.split('\n')
  lines.splice(heading + 1, 0, '', block(g))
  body = lines.join('\n')
  placed.push(g.id)
}

// Anything whose section does not exist goes in one collapsed block at the end rather than being
// dropped. A silently missing image is indistinguishable from one nobody wanted.
if (orphaned.length) {
  const start = '<!-- huishots:orphans:start -->'
  const end = '<!-- huishots:orphans:end -->'
  const chunk = [
    start,
    '',
    '<details>',
    '<summary><b>More, because we cannot stop, and neither could the agent</b></summary>',
    '',
    ...GALLERY.filter((g) => orphaned.includes(g.id)).flatMap((g) => [`**${g.title}**`, '', block(g), '']),
    '</details>',
    '',
    end
  ].join('\n')
  if (body.includes(start) && body.includes(end)) {
    body = body.slice(0, body.indexOf(start)) + chunk + body.slice(body.indexOf(end) + end.length)
  } else {
    body = `${body.trimEnd()}\n\n${chunk}\n`
  }
}

console.log(`${placed.length} placed under their own section, ${orphaned.length} collapsed at the end`)
console.log(`pinned to ${sha.slice(0, 8)}`)
if (orphaned.length) console.log(`  no section found for: ${orphaned.join(', ')}`)
if (dryRun) {
  console.log('--dry-run: not writing')
  process.exit(0)
}

const tmp = join(ROOT, `.pr-gallery-${process.pid}.md`)
writeFileSync(tmp, body, 'utf8')
try {
  const edit = ['pr', 'edit', prNumber, '--body-file', tmp]
  if (repo) edit.splice(3, 0, '--repo', repo)
  execFileSync('gh', edit, { stdio: 'inherit' })
  console.log(`✓ pull request #${prNumber}${repo ? ` on ${repo}` : ''} updated`)
} finally {
  rmSync(tmp, { force: true })
}
