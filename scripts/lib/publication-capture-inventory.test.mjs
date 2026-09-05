#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { README_CAPTURE_ROSTER, SITE_CAPTURE_ROSTER, markdownImageEmbeds, renderedImagePaths, validateCurrentCaptureLabels, validatePublicationCaptures } from './publication-capture-inventory.mjs'
import { screenshotsRoomHtml } from '../../site/app/features/screenshots.js'

const readme = README_CAPTURE_ROSTER.map((file) => `![Recorded ${file}](./docs/assets/shots/${file})`).join('\n')
const gallery = SITE_CAPTURE_ROSTER.map((file) => `<img class="shot-card__img" src="./assets/shots/${file}" alt="Recorded ${file}">`).join('\n')

assert.deepEqual(markdownImageEmbeds('Mention docs/assets/shots/app-01-launch.png only.\n![Launch](./docs/assets/shots/app-01-launch.png)'), [
  { alt: 'Launch', path: 'docs/assets/shots/app-01-launch.png' }
])
assert.deepEqual(markdownImageEmbeds('<!-- ![Comment](./docs/assets/shots/app-01-launch.png) --> <!-- ![Second](./docs/assets/shots/app-01-launch.png) -->\n`![Inline](./docs/assets/shots/app-01-launch.png)`\n```md\n![Fence](./docs/assets/shots/app-01-launch.png)\n```\n![Malformed](./docs/assets/shots/app-01-launch.png'), [])
assert.equal(validatePublicationCaptures({ readme, siteHtml: gallery }).length, 0)
assert.equal(renderedImagePaths(gallery).length, SITE_CAPTURE_ROSTER.length)

const missingEmbed = readme.replace('![Recorded app-01-launch.png](./docs/assets/shots/app-01-launch.png)', 'docs/assets/shots/app-01-launch.png')
assert.match(validatePublicationCaptures({ readme: missingEmbed, siteHtml: gallery }).join('\n'), /actual Markdown image embed/)

const currentCaption = readme.replace('Recorded app-01-launch.png', 'Current app-01-launch.png')
assert.match(validateCurrentCaptureLabels({ readme: currentCaption, manifest: { entries: [] }, sourceCommit: 'a'.repeat(40) }).join('\n'), /no semantic v2 capture record/)
const fixtureRoot = mkdtempSync(join(tmpdir(), 'publication-capture-'))
const receiptRoot = mkdtempSync(join(tmpdir(), 'publication-receipt-'))
try {
  const fixturePath = join(fixtureRoot, 'docs', 'assets', 'shots', 'app-01-launch.png')
  mkdirSync(join(fixtureRoot, 'docs', 'assets', 'shots'), { recursive: true })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9fQAAAABJRU5ErkJggg==', 'base64')
  writeFileSync(fixturePath, png)
  const digest = createHash('sha256').update(png).digest('hex')
  const sourceCommit = 'a'.repeat(40)
  const receipt = {
    schemaVersion: 1, route: 'cheap-lowlevel-headless', method: 'cheap Lowlevel MCP headless desktop receipt',
    source: { gitHead: sourceCommit, workingTreeDigest: 'b'.repeat(64), provenanceSha256: 'c'.repeat(64) },
    candidate: { sha256: 'd'.repeat(64), appAsarSha256: 'e'.repeat(64) },
    launch: { ok: true, desktop: 'capture-test', pid: 100, hwnd: 200, focusStealing: false, terminalWindow: false },
    cdp: { count: 1, id: 'page', url: 'file:///capture', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page' },
    capture: { version: '1.0.0', buildKind: 'built-renderer', tuple: { label: 'normal', viewport: { width: 1, height: 1 }, deviceScaleFactor: 1, theme: 'dark', languageMode: 'en' } },
    evidence: [{ file: 'app-01-launch.png', sha256: digest, width: 1, height: 1 }]
  }
  const receiptPath = join(receiptRoot, 'capture-receipt.json')
  const receiptBytes = Buffer.from(JSON.stringify(receipt))
  writeFileSync(receiptPath, receiptBytes)
  const currentManifest = {
    entries: [{
      file: 'app-01-launch.png', sha256: digest, width: 1, height: 1,
      tuple: { label: 'normal', viewport: { width: 1, height: 1 }, deviceScaleFactor: 1, theme: 'dark', languageMode: 'en' },
      provenance: { commit: sourceCommit, version: '1.0.0', buildKind: 'built-renderer', receiptId: 'capture-receipt.json', receiptSha256: createHash('sha256').update(receiptBytes).digest('hex') }
    }]
  }
  assert.equal(validateCurrentCaptureLabels({ readme: currentCaption, manifest: currentManifest, sourceCommit, root: fixtureRoot, receiptRoot }).length, 0)
  assert.match(validateCurrentCaptureLabels({ readme: currentCaption, manifest: { entries: [{ ...currentManifest.entries[0], sha256: 'f'.repeat(64) }] }, sourceCommit, root: fixtureRoot, receiptRoot }).join('\n'), /hash does not match/)
  for (const remove of [
    ['tuple', 'label'], ['tuple', 'viewport.width'], ['tuple', 'viewport.height'], ['tuple', 'deviceScaleFactor'], ['tuple', 'theme'], ['tuple', 'languageMode'],
    ['provenance', 'version'], ['provenance', 'buildKind'], ['provenance', 'commit']
  ]) {
    const missingField = structuredClone(currentManifest)
    const [scope, key] = remove
    const [parent, child] = key.split('.')
    if (child) delete missingField.entries[0][scope][parent][child]
    else delete missingField.entries[0][scope][parent]
    assert.match(validateCurrentCaptureLabels({ readme: currentCaption, manifest: missingField, sourceCommit, root: fixtureRoot, receiptRoot }).join('\n'), /(complete semantic provenance|not bound to source commit)/)
  }
  const invalidReceipt = structuredClone(currentManifest)
  const invalidReceiptBody = { ...receipt, cdp: { ...receipt.cdp, count: 2 } }
  const invalidReceiptPath = join(receiptRoot, 'invalid-receipt.json')
  const invalidReceiptBytes = Buffer.from(JSON.stringify(invalidReceiptBody))
  writeFileSync(invalidReceiptPath, invalidReceiptBytes)
  invalidReceipt.entries[0].provenance.receiptId = 'invalid-receipt.json'
  invalidReceipt.entries[0].provenance.receiptSha256 = createHash('sha256').update(invalidReceiptBytes).digest('hex')
  assert.match(validateCurrentCaptureLabels({ readme: currentCaption, manifest: invalidReceipt, sourceCommit, root: fixtureRoot, receiptRoot }).join('\n'), /external receipt is invalid/)
  const forgedReceipt = structuredClone(currentManifest)
  forgedReceipt.entries[0].provenance.receiptSha256 = 'f'.repeat(64)
  assert.match(validateCurrentCaptureLabels({ readme: currentCaption, manifest: forgedReceipt, sourceCommit, root: fixtureRoot, receiptRoot }).join('\n'), /receipt digest does not match/)
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
  rmSync(receiptRoot, { recursive: true, force: true })
}
assert.equal(validatePublicationCaptures({ readme: currentCaption, siteHtml: gallery }).length, 0)

const omittedSiteFile = gallery.replace('<img class="shot-card__img" src="./assets/shots/app-01-launch.png" alt="Recorded app-01-launch.png">', '<span>app-01-launch.png</span>')
assert.match(validatePublicationCaptures({ readme, siteHtml: omittedSiteFile }).join('\n'), /rendered site gallery lacks required capture/)

const renderedGallery = screenshotsRoomHtml({ state: { qSec: '', rxOn: {}, rxFlags: {} } })
assert.equal(validatePublicationCaptures({ readme, siteHtml: renderedGallery }).length, 0)
const disabledRenderer = renderedGallery.replace(/<img\b[^>]*>/g, '<span>dead screenshot renderer</span>')
assert.match(validatePublicationCaptures({ readme, siteHtml: disabledRenderer }).join('\n'), /rendered site gallery lacks required capture/)

console.log('publication capture inventory: roster, actual embed, site renderer, and stale-current negative cases verified')
