// Renders the shared-link embed graphic — the picture Discord (and Slack, and every other
// unfurler) shows when somebody pastes a link to this project.
//
//   npm run make-social-card
//
// Two sizes, because the two consumers want different aspect ratios:
//
//   ./social-preview.png            1280x640  — GitHub's repository Social preview upload
//   ./social-card.png               1200x630  — the master og:image, the widely-safe OG size
//   site/assets/social-card.png     1200x630  — a byte-identical copy, because Pages serves site/
//
// BOTH MASTERS SIT IN THE REPOSITORY ROOT, beside the README. The GitHub upload cannot be
// scripted (see the note at the bottom), so the last step is always a person opening a folder
// and dragging an image in — and a path four directories deep turns that into a hunt, which is a
// step that quietly does not happen.
//
// The third file exists only because the Pages workflow publishes `site/` alone, so a meta tag
// pointing at a root file would 404. It is written from the SAME buffer in the same run, and the
// site contract guard asserts the two are byte-identical — two copies of a picture are two
// pictures that will disagree eventually unless something checks.
//
// WHY THIS IS GENERATED FROM A REAL CAPTURE. The rule is that the graphic must show the actual
// product, and the failure it exists to prevent is a card that could belong to any project: a
// gradient, a wordmark, a star count. So the dominant element here is `app-04-canvas.png`, a
// genuine screenshot of the built Electron app (see docs/assets/shots/README.md for the commit
// and the capture method). Never substitute a mockup, a stock photo, or a hand-drawn impression
// of the interface — if it shows the app, it is the app.
//
// Regenerate whenever the interface changes enough that the shot is no longer honest. And when
// you do, remember the crawler-cache rule: unfurlers hold an image URL for a long time, so a
// MEANINGFUL change wants a new filename, not an overwrite nobody downstream will notice.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOT = join(ROOT, 'docs/assets/shots/app-04-canvas.png')
const SITE_ASSETS = join(ROOT, 'site/assets')

/** The app's own dark chrome, so the card reads as the product rather than as marketing. */
const BG_TOP = '#17171c'
const BG_BOTTOM = '#0b0b0e'
const MARK_A = '#a38dff'
const MARK_B = '#7a4bd0'

/**
 * One card at a given size.
 *
 * Layout is deliberately simple and holds at both aspect ratios: a full-bleed, dimmed screenshot
 * of the real canvas, then a solid band along the bottom carrying the mark, the name and one
 * line about what it is. The band is opaque rather than a gradient scrim, because an unfurler
 * renders the card small and text over a busy screenshot stops being readable at thumbnail size.
 */
async function card(width, height) {
  const band = Math.round(height * 0.26)
  const shotH = height - band
  const pad = Math.round(width * 0.045)
  const markSize = Math.round(band * 0.46)
  const nameSize = Math.round(band * 0.40)
  const subSize = Math.round(band * 0.20)

  // The screenshot, cropped to the area above the band. `cover` keeps its aspect ratio and
  // crops rather than squashing — a stretched interface looks like a broken interface.
  //
  // CROP FIRST, to the region where the interface actually is. The source is a capture of a
  // freshly-installed app, so most of its 1600x1000 is empty canvas; letting the full frame fill
  // the card produced a picture that was mostly black with some small furniture in the corner —
  // honest, and a terrible advertisement for a product about having many things on screen at
  // once. This window keeps the tab bar, the sessions sidebar and the whole terminal node, and
  // drops the vacant lower-right. Revisit these numbers whenever the source capture is retaken.
  const CROP = { left: 0, top: 0, width: 1180, height: 560 }
  const shot = await sharp(SHOT)
    .extract(CROP)
    .resize(width, shotH, { fit: 'cover', position: 'top' })
    .modulate({ brightness: 0.86 })
    .toBuffer()

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${BG_TOP}"/>
        <stop offset="1" stop-color="${BG_BOTTOM}"/>
      </linearGradient>
      <linearGradient id="mk" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${MARK_A}"/>
        <stop offset="1" stop-color="${MARK_B}"/>
      </linearGradient>
    </defs>

    <!-- Bottom band -->
    <rect x="0" y="${shotH}" width="${width}" height="${band}" fill="url(#bg)"/>
    <rect x="0" y="${shotH}" width="${width}" height="2" fill="#ffffff" fill-opacity="0.10"/>

    <!-- The node-graph mark: three nodes and the edges between them, which is the product in
         one glyph — terminals as connected nodes rather than stacked tabs. -->
    <g transform="translate(${pad}, ${shotH + (band - markSize) / 2})">
      <g stroke="url(#mk)" stroke-width="${Math.max(2, markSize * 0.07)}" stroke-linecap="round" fill="none">
        <line x1="${markSize * 0.22}" y1="${markSize * 0.28}" x2="${markSize * 0.78}" y2="${markSize * 0.28}"/>
        <line x1="${markSize * 0.22}" y1="${markSize * 0.28}" x2="${markSize * 0.5}" y2="${markSize * 0.78}"/>
        <line x1="${markSize * 0.78}" y1="${markSize * 0.28}" x2="${markSize * 0.5}" y2="${markSize * 0.78}"/>
      </g>
      <g fill="url(#mk)">
        <circle cx="${markSize * 0.22}" cy="${markSize * 0.28}" r="${markSize * 0.13}"/>
        <circle cx="${markSize * 0.78}" cy="${markSize * 0.28}" r="${markSize * 0.13}"/>
        <circle cx="${markSize * 0.5}" cy="${markSize * 0.78}" r="${markSize * 0.13}"/>
      </g>
    </g>

    <!-- Name + one honest line. No slogan, no star count: what it is, in words. -->
    <text x="${pad + markSize + Math.round(pad * 0.6)}"
          y="${shotH + band * 0.47}"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif"
          font-size="${nameSize}" font-weight="700" fill="#ffffff">nodeterm</text>
    <text x="${pad + markSize + Math.round(pad * 0.6)}"
          y="${shotH + band * 0.75}"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif"
          font-size="${subSize}" font-weight="500" fill="#b9b4c6">Real terminals and coding agents as live nodes on one canvas</text>
  </svg>`

  return sharp({
    create: { width, height, channels: 4, background: { r: 11, g: 11, b: 14, alpha: 1 } }
  })
    .composite([
      { input: shot, top: 0, left: 0 },
      { input: Buffer.from(overlay), top: 0, left: 0 }
    ])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

if (!existsSync(SHOT)) {
  // Fail loudly rather than emitting a card with a hole in it: a generic graphic is exactly the
  // outcome this whole script exists to avoid, so a missing capture is a stop, not a fallback.
  console.error(`Missing the source capture: ${SHOT}`)
  console.error('Re-run the capture harness — the card must show the real app, never a placeholder.')
  process.exit(1)
}

mkdirSync(SITE_ASSETS, { recursive: true })

// The GitHub preview: root only, never served.
const preview = await card(1280, 640)
await sharp(preview).toFile(join(ROOT, 'social-preview.png'))
console.log(`✓ ./social-preview.png       1280x640  ${(preview.length / 1024).toFixed(0)} KB  — GitHub Social preview (upload by hand)`)

// The OG card: written once, then placed twice from the SAME buffer — root master and served
// copy. Writing the identical bytes rather than re-rendering is what makes "byte-identical" a
// fact instead of a hope; two renders of the same SVG are not guaranteed to match byte for byte.
const cardBuf = await card(1200, 630)
await sharp(cardBuf).toFile(join(ROOT, 'social-card.png'))
console.log(`✓ ./social-card.png          1200x630  ${(cardBuf.length / 1024).toFixed(0)} KB  — og:image master`)
writeFileSync(join(SITE_ASSETS, 'social-card.png'), readFileSync(join(ROOT, 'social-card.png')))
console.log('✓ site/assets/social-card.png          byte-identical copy — Pages publishes site/ only')

console.log('\nOne step left, and it is the one that cannot be scripted:')
console.log('  GitHub -> Settings -> General -> Social preview -> upload ./social-preview.png')
console.log('  (that upload is not in the public REST API, so gh cannot do it)')
