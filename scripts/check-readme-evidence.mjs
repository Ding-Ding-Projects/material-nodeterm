#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { markdownImageEmbeds, validateCurrentCaptureLabels, validatePublicationCaptures } from './lib/publication-capture-inventory.mjs'
import { screenshotsRoomHtml } from '../site/app/features/screenshots.js'

const ROOT = resolve(import.meta.dirname, '..')
const MANIFEST_PATH = resolve(ROOT, 'docs/assets/recordings/site/capture-manifest.json')
const INVENTORY_PATH = resolve(ROOT, 'docs/assets/recordings/site/evidence-inventory.json')
const README_PATH = resolve(ROOT, 'README.md')

const REQUIRED_KEY_IDS = 'site-hall-current site-home-current site-docs-current site-changelog-current site-settings-current site-screenshots-current site-search-regex-current site-appearance-current site-mobile-home-current'.split(' ')
const REQUIRED_RECORDING_IDS = 'room-home room-docs room-changelog room-notes room-history room-auth room-shop room-convert room-export room-dish room-coverage room-shots room-pair room-play room-settings setting-you setting-look setting-words setting-narrator setting-school setting-vocab setting-safety setting-timers setting-demo setting-adhd'.split(' ')
const REQUIRED_VISIBLE_IMAGES = [
  'docs/assets/shots/app-04-canvas.png',
  'docs/assets/shots/app-05-kanban.png',
  'docs/assets/shots/app-06-history.png',
  'docs/assets/shots/app-02-settings.png',
  'docs/assets/shots/app-status-surface.png',
  'docs/assets/shots/app-settings-language.png',
  'docs/assets/shots/app-settings-narrator.png',
  'docs/assets/shots/app-settings-appearance-editor.png',
  'docs/assets/shots/app-adhd-modes.png',
  'docs/assets/shots/app-settings-app-identity.png',
  'docs/assets/shots/app-kids-home.png',
  'docs/assets/shots/app-kids-gate.png',
  'docs/assets/shots/app-kids-parent.png',
  ...REQUIRED_KEY_IDS.map((id) => 'docs/assets/shots/site-current/' + id + '.png')
]
const REJECTED_PUBLIC_REFERENCES = [
  'windows-terminal-profile-restart-warning.png',
  'windows-terminal-profile-reattached.png',
  'site-home-light.png',
  'site-home-dark.png',
  'site-narrow-390.png',
]

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function exactIds(actual, required, label, errors) {
  const values = actual.map((entry) => entry.id)
  if (new Set(values).size !== values.length) errors.push(label + ' contains duplicate IDs')
  if (values.length !== required.length) errors.push(label + ' count is ' + values.length + ', expected ' + required.length)
  for (const id of required) {
    if (values.filter((value) => value === id).length !== 1) errors.push(label + ' must contain ' + id + ' exactly once')
  }
  for (const id of values) {
    if (!required.includes(id)) errors.push(label + ' contains unexpected ID ' + id)
  }
}

function insideDetails(readme, path) {
  const position = readme.indexOf(path)
  if (position < 0) return null
  const before = readme.slice(0, position)
  const opens = (before.match(/<details(?:\s[^>]*)?>/g) || []).length
  const closes = (before.match(/<\/details>/g) || []).length
  return opens > closes
}

function validate(manifest, inventory, readme, checkFiles = true) {
  const errors = []
  if (manifest.version !== 1) errors.push('capture manifest version must be 1')
  if (!/^[0-9a-f]{40}$/.test(manifest.sourceCommit || '')) errors.push('source commit is invalid')
  if (manifest.route !== 'cheap-lowlevel-headless') errors.push('capture route is invalid')
  if (!Array.isArray(manifest.keyCaptures)) errors.push('keyCaptures must be an array')
  if (!Array.isArray(manifest.recordings)) errors.push('recordings must be an array')
  if (errors.length) return errors

  exactIds(manifest.keyCaptures, REQUIRED_KEY_IDS, 'key captures', errors)
  exactIds(manifest.recordings, REQUIRED_RECORDING_IDS, 'recordings', errors)

  if (inventory.version !== 1 || inventory.sourceCommit !== manifest.sourceCommit || !Array.isArray(inventory.records)) {
    errors.push('evidence inventory does not bind the manifest source')
  } else {
    exactIds(inventory.records, REQUIRED_KEY_IDS, 'evidence inventory', errors)
  }

  const readmeEmbeds = markdownImageEmbeds(readme)
  for (const entry of manifest.keyCaptures) {
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 || '')) errors.push(entry.id + ' has an invalid SHA-256')
    if (!Number.isSafeInteger(entry.width) || !Number.isSafeInteger(entry.height) || entry.width < 1 || entry.height < 1) errors.push(entry.id + ' has invalid dimensions')
    if (!entry.path || !entry.alt) errors.push(entry.id + ' lacks a path or alt text')
    if (!readmeEmbeds.some((embed) => embed.path === entry.path)) errors.push('README lacks an actual visible image embed for ' + entry.id)
    if (insideDetails(readme, entry.path) !== false) errors.push(entry.id + ' must remain outside collapsible sections')
    if (checkFiles) {
      const path = resolve(ROOT, entry.path)
      const bytes = readFileSync(path)
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) errors.push(entry.id + ' is not a PNG')
      if (hash(path) !== entry.sha256) errors.push(entry.id + ' hash does not match')
    }
  }

  for (const entry of manifest.recordings) {
    if (!/^[0-9a-f]{64}$/.test(entry.sha256 || '')) errors.push(entry.id + ' has an invalid SHA-256')
    if (!Number.isSafeInteger(entry.frames) || entry.frames < 2) errors.push(entry.id + ' is not multi-frame')
    if (!Number.isSafeInteger(entry.width) || !Number.isSafeInteger(entry.height) || entry.width < 1 || entry.height < 1) errors.push(entry.id + ' has invalid dimensions')
    if (!entry.path || !readme.includes('](' + entry.path + ')')) errors.push('README lacks ' + entry.id)
    if (checkFiles) {
      const path = resolve(ROOT, entry.path)
      const bytes = readFileSync(path)
      const signature = bytes.subarray(0, 6).toString('ascii')
      if (!['GIF87a', 'GIF89a'].includes(signature) || bytes.at(-1) !== 0x3b) errors.push(entry.id + ' is not a complete GIF')
      if (hash(path) !== entry.sha256) errors.push(entry.id + ' hash does not match')
    }
  }

  for (const path of REQUIRED_VISIBLE_IMAGES) {
    const state = insideDetails(readme, path)
    if (state === null) errors.push('README lacks key visible image ' + path)
    else if (state) errors.push('key visible image is collapsed: ' + path)
  }
  for (const value of REJECTED_PUBLIC_REFERENCES) {
    if (readme.includes(value)) errors.push('README retains rejected capture ' + value)
  }
  const siteHtml = screenshotsRoomHtml({ state: { qSec: '', rxOn: {}, rxFlags: {} } })
  errors.push(...validatePublicationCaptures({ readme, siteHtml }))
  errors.push(...validateCurrentCaptureLabels({ readme, manifest, sourceCommit: manifest.commit ?? manifest.sourceCommit }))
  return errors
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
const readme = readFileSync(README_PATH, 'utf8')
const errors = validate(manifest, inventory, readme)
if (errors.length) {
  for (const error of errors) console.error('ERROR: ' + error)
  process.exit(1)
}

const mutants = [structuredClone(manifest), structuredClone(manifest), structuredClone(manifest)]
mutants[0].keyCaptures.shift()
mutants[1].recordings.shift()
mutants[2].keyCaptures[0].sha256 = '0'.repeat(63)
for (const [index, mutant] of mutants.entries()) {
  if (validate(mutant, inventory, readme, false).length === 0) {
    console.error('ERROR: negative regression ' + (index + 1) + ' did not turn red')
    process.exit(1)
  }
}

console.log('README evidence: ' + manifest.keyCaptures.length + ' visible still captures, ' + manifest.recordings.length + ' feature GIFs, exact hashes, publication roster coverage, and three red-then-green negative regressions verified.')
