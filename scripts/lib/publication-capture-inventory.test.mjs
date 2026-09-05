#!/usr/bin/env node

import assert from 'node:assert/strict'
import { README_CAPTURE_ROSTER, SITE_CAPTURE_ROSTER, markdownImageEmbeds, renderedImagePaths, validateCurrentCaptureLabels, validatePublicationCaptures } from './publication-capture-inventory.mjs'
import { screenshotsRoomHtml } from '../../site/app/features/screenshots.js'

const readme = README_CAPTURE_ROSTER.map((file) => `![Recorded ${file}](./docs/assets/shots/${file})`).join('\n')
const gallery = SITE_CAPTURE_ROSTER.map((file) => `<img class="shot-card__img" src="./assets/shots/${file}" alt="Recorded ${file}">`).join('\n')

assert.deepEqual(markdownImageEmbeds('Mention docs/assets/shots/app-01-launch.png only.\n![Launch](./docs/assets/shots/app-01-launch.png)'), [
  { alt: 'Launch', path: 'docs/assets/shots/app-01-launch.png' }
])
assert.deepEqual(markdownImageEmbeds('<!-- ![Comment](./docs/assets/shots/app-01-launch.png) -->\n```md\n![Fence](./docs/assets/shots/app-01-launch.png)\n```\n![Malformed](./docs/assets/shots/app-01-launch.png'), [])
assert.equal(validatePublicationCaptures({ readme, siteHtml: gallery }).length, 0)
assert.equal(renderedImagePaths(gallery).length, SITE_CAPTURE_ROSTER.length)

const missingEmbed = readme.replace('![Recorded app-01-launch.png](./docs/assets/shots/app-01-launch.png)', 'docs/assets/shots/app-01-launch.png')
assert.match(validatePublicationCaptures({ readme: missingEmbed, siteHtml: gallery }).join('\n'), /actual Markdown image embed/)

const currentCaption = readme.replace('Recorded app-01-launch.png', 'Current app-01-launch.png')
assert.match(validateCurrentCaptureLabels({ readme: currentCaption, manifest: { entries: [] }, sourceCommit: 'a'.repeat(40) }).join('\n'), /no semantic v2 capture record/)
const currentManifest = {
  entries: [{
    file: 'app-01-launch.png', sha256: 'a'.repeat(64), tuple: { width: 1600, height: 1000 },
    version: '1.0.0', provenance: { commit: 'a'.repeat(40), method: 'headless', receipt: 'b'.repeat(64) }
  }]
}
assert.equal(validateCurrentCaptureLabels({ readme: currentCaption, manifest: currentManifest, sourceCommit: 'a'.repeat(40) }).length, 0)
assert.equal(validatePublicationCaptures({ readme: currentCaption, siteHtml: gallery }).length, 0)

const omittedSiteFile = gallery.replace('<img class="shot-card__img" src="./assets/shots/app-01-launch.png" alt="Recorded app-01-launch.png">', '<span>app-01-launch.png</span>')
assert.match(validatePublicationCaptures({ readme, siteHtml: omittedSiteFile }).join('\n'), /rendered site gallery lacks required capture/)

const renderedGallery = screenshotsRoomHtml({ state: { qSec: '', rxOn: {}, rxFlags: {} } })
assert.equal(validatePublicationCaptures({ readme, siteHtml: renderedGallery }).length, 0)
const disabledRenderer = renderedGallery.replace(/<img\b[^>]*>/g, '<span>dead screenshot renderer</span>')
assert.match(validatePublicationCaptures({ readme, siteHtml: disabledRenderer }).join('\n'), /rendered site gallery lacks required capture/)

console.log('publication capture inventory: roster, actual embed, site renderer, and stale-current negative cases verified')
