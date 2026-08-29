#!/usr/bin/env node
/**
 * The public article is a hand-shaped HTML view of the authoritative Markdown article. Keep an
 * explicit digest in the HTML so a source edit cannot silently leave the published view stale.
 * This is a source guard only; it does not fetch or publish anything.
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const source = 'docs/features/agents/context-window-meter.md'
const page = 'site/docs/context-window-meter.html'
const markdown = readFileSync(source, 'utf8').replace(/\r\n/g, '\n')
const html = readFileSync(page, 'utf8')
const expected = createHash('sha256').update(markdown).digest('hex')
const actual = html.match(/source-article-sha256" content="([a-f0-9]{64})"/)?.[1]
if (!actual || actual !== expected) {
  console.error(`Context article parity failed: ${page} does not match ${source}`)
  process.exitCode = 1
} else {
  console.log(`Context article parity verified: ${source} -> ${page}`)
}
