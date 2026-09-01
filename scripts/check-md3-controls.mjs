#!/usr/bin/env node
// Raw form controls outside the MD3 primitive layer are the way a panel drifts back to the
// browser's defaults. Every `<button>`, `<input>`, `<select>` and `<textarea>` in the renderer
// must come from `src/renderer/ui/md3/` (or the thin `ui/*` wrappers that delegate there) unless
// the file is on the allowlist — and the allowlist can only SHRINK: a file that is clean today
// may never regress, and a new file starts clean. Run: `node scripts/check-md3-controls.mjs`.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '..')
export const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts', 'md3-raw-controls-allowlist.json')
const RENDERER = path.join(REPO_ROOT, 'src', 'renderer')
/** Files that DEFINE the primitives or the delegating wrappers; raw controls are their job. */
const OWNERS = [/^src\/renderer\/ui\/md3\//, /^src\/renderer\/ui\/(Button|Input|Select|Switch|NumberField|SegmentedPill|CopyButton|AnchoredPopover)\.tsx$/]
const RAW = /<(button|input|select|textarea)(?=[\s/>])/g

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (full.endsWith('.tsx') && !/\.test\.tsx$/.test(full)) yield full
  }
}

/** Every renderer .tsx (repo-relative, posix separators) that renders a raw control. */
export function scanRawControls(root = RENDERER) {
  const offenders = []
  for (const file of walk(root)) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/')
    if (OWNERS.some((owner) => owner.test(rel))) continue
    const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (RAW.test(stripped)) offenders.push(rel)
    RAW.lastIndex = 0
  }
  return offenders.sort()
}

export function readAllowlist(file = ALLOWLIST_PATH) {
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${file} must be a JSON array of repo-relative file paths`)
  }
  return parsed
}

/** New offenders not on the allowlist, and allowlist entries that are now clean (must be removed). */
export function evaluate(offenders, allowlist) {
  const allowed = new Set(allowlist)
  const present = new Set(offenders)
  return {
    newOffenders: offenders.filter((file) => !allowed.has(file)),
    stale: allowlist.filter((file) => !present.has(file))
  }
}

function main() {
  const args = process.argv.slice(2)
  const offenders = scanRawControls()
  if (args.includes('--write-allowlist')) {
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(offenders, null, 2) + '\n')
    console.log(`wrote ${offenders.length} entries to ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`)
    return
  }
  const allowlist = readAllowlist()
  const { newOffenders, stale } = evaluate(offenders, allowlist)
  for (const file of newOffenders) console.log(`✗ raw form control outside ui/md3: ${file}`)
  for (const file of stale) console.log(`✗ allowlist entry is clean now — remove it so it cannot regress: ${file}`)
  console.log(`check-md3-controls.mjs: ${offenders.length} files still render raw controls (${allowlist.length} allowed).`)
  if (newOffenders.length || stale.length) {
    console.log(`${newOffenders.length + stale.length} FAILURE(S).`)
    process.exit(1)
  }
  console.log('No new raw controls. ✓')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
