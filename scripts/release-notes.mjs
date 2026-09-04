#!/usr/bin/env node
/**
 * release-notes.mjs — builds the body of the GitHub Release a maintainer dispatches from main.
 * Prints markdown to stdout; the workflow redirects it to a file, attaches it to the verified
 * draft, then makes that draft public.
 *
 * This script never claims a check ran that did not, and it never estimates a missing
 * timestamp — see docs/ci-and-releases.md for the governing policy: this workflow runs
 * no tests, type-check or lint, and nothing here gates the release.
 *
 * Environment (all read at run time; release timing fails closed when required evidence is
 * missing, while optional asset/repository context may be omitted for a dry-run preview):
 *   RELEASE_TAG              the tag this release publishes under
 *   WORKFLOW_STARTED_AT      ISO-8601 UTC — the workflow run's first-job startedAt
 *                             (GitHub's own `run_started_at`). Required.
 *   WORKFLOW_COMPLETED_AT    ISO-8601 UTC — post-publication completion boundary. When supplied,
 *                             the notes emit the final started/completed/duration triplet.
 *   RELEASE_NOTES_GENERATED_AT
 *                            ISO-8601 UTC — when note generation begins. Defaults to "now";
 *                             verification and publication happen afterward.
 *   GITHUB_REPOSITORY        "owner/repo", for the commit link. Optional.
 *   GITHUB_SHA               the built commit. Optional.
 *   RELEASE_ASSET_PATHS      newline-separated list of installer file paths to list with
 *                             their size. Optional — omitted assets are simply not listed.
 *   RELEASE_ASSET_MANIFEST   validated JSON manifest containing each asset's SHA-256.
 *                             The release workflow always supplies it.
 *   RELEASE_PRIOR_BODIES_FILE
 *                            JSON emitted by `gh api --paginate --slurp` for the complete
 *                             prior-release inventory. Required for code-name selection.
 *   RELEASE_IS_FIRST_RELEASE Exact string `true` only when a successful empty inventory proves
 *                             this project has no prior release. Missing/false means history is
 *                             required, so an absent or empty snapshot omits the optional name.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeLineCounts } from './count-lines.mjs'
import { renderCodeNameSection, resolveCodeName } from './dim-sum-code-name.mjs'

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(1)} ${units[u]}`
}

function fmtDurationMs(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function fmtInt(n) {
  return n.toLocaleString('en-US')
}

async function listAssets() {
  const raw = process.env.RELEASE_ASSET_PATHS
  if (!raw) return []
  const paths = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  const rows = []
  let hashes = new Map()
  if (process.env.RELEASE_ASSET_MANIFEST) {
    let manifest
    try {
      manifest = JSON.parse(process.env.RELEASE_ASSET_MANIFEST)
    } catch (error) {
      throw new Error(`RELEASE_ASSET_MANIFEST is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!Array.isArray(manifest?.assets)) throw new Error('RELEASE_ASSET_MANIFEST must contain an assets array')
    hashes = new Map(
      manifest.assets.map((asset) => {
        if (typeof asset?.name !== 'string' || typeof asset?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
          throw new Error('RELEASE_ASSET_MANIFEST contains an invalid asset SHA-256')
        }
        return [asset.name, asset.sha256]
      }),
    )
  }
  for (const p of paths) {
    try {
      const s = await stat(p)
      rows.push({ path: p, name: basename(p), size: s.size, sha256: hashes.get(basename(p)) ?? null })
    } catch {
      rows.push({ path: p, name: basename(p), size: null, sha256: hashes.get(basename(p)) ?? null })
    }
  }
  return rows
}

function renderTimingSection() {
  const startedRaw = process.env.WORKFLOW_STARTED_AT
  const completedRaw = process.env.WORKFLOW_COMPLETED_AT
  const generatedRaw = process.env.RELEASE_NOTES_GENERATED_AT ?? new Date().toISOString()
  if (!startedRaw) throw new Error('WORKFLOW_STARTED_AT is required for release timing')
  const started = new Date(startedRaw)
  if (Number.isNaN(started.getTime())) throw new Error('WORKFLOW_STARTED_AT must be a valid ISO-8601 timestamp')
  const boundaryRaw = completedRaw ?? generatedRaw
  const boundary = new Date(boundaryRaw)
  if (Number.isNaN(boundary.getTime())) throw new Error(`${completedRaw ? 'WORKFLOW_COMPLETED_AT' : 'RELEASE_NOTES_GENERATED_AT'} must be a valid ISO-8601 timestamp`)
  const durationMs = boundary.getTime() - started.getTime()
  if (durationMs < 0) throw new Error('release timing completion boundary precedes workflow start')
  const lines = [completedRaw ? '## Workflow timing' : '## Release preparation timing', '']
  lines.push(`- **Workflow started:** ${started.toISOString()}`)
  if (completedRaw) {
    lines.push(`- **Workflow completed:** ${boundary.toISOString()}`)
    lines.push(`- **Workflow duration:** ${fmtDurationMs(durationMs)} (HH:mm:ss)`)
  } else {
    lines.push(`- **Release notes generated:** ${boundary.toISOString()}`)
    lines.push(`- **Elapsed to release notes:** ${fmtDurationMs(durationMs)} (HH:mm:ss)`)
  }
  return lines.join('\n')
}

export async function renderLineCountSection(compute = computeLineCounts) {
  let data
  try {
    data = await compute({ ref: process.env.GITHUB_SHA ?? 'HEAD' })
  } catch (err) {
    return [
      '## Line count',
      '',
      `Could not compute the line count for this release: ${err instanceof Error ? err.message : String(err)}`,
    ].join('\n')
  }

  const lines = ['## Line count', '', `Measured with \`node scripts/count-lines.mjs\` at \`${data.ref}\`.`, '']
  lines.push('| Category | Total | Non-blank | Files |')
  lines.push('|---|---:|---:|---:|')
  for (const [name, b] of Object.entries(data.buckets)) {
    lines.push(`| ${name} | ${fmtInt(b.total)} | ${fmtInt(b.nonBlank)} | ${b.files} |`)
  }
  lines.push('')
  lines.push('| Language | Total | Non-blank | Files |')
  lines.push('|---|---:|---:|---:|')
  for (const l of data.byLanguage) {
    lines.push(`| ${l.language} | ${fmtInt(l.total)} | ${fmtInt(l.nonBlank)} | ${l.files} |`)
  }
  lines.push('')
  lines.push(
    `**Project total:** ${fmtInt(data.projectTotal.total)} lines (${fmtInt(data.projectTotal.nonBlank)} non-blank), ${data.projectTotal.files} files.`,
  )
  lines.push(
    `**Grand total (everything counted):** ${fmtInt(data.grandTotal.total)} lines (${fmtInt(data.grandTotal.nonBlank)} non-blank), ${data.grandTotal.files} files.`,
  )
  lines.push('')
  lines.push('Excluded from these counts (tracked but not the project\'s own source):')
  if (data.excluded.length === 0) {
    lines.push('- (none)')
  } else {
    for (const e of data.excluded) lines.push(`- \`${e.path}\` — ${e.reason}`)
  }
  lines.push('')
  const a = data.attribution
  lines.push('**Attribution (agent-written vs person-written, surviving lines):**')
  lines.push(`- agent: ${fmtInt(a.agentLines)} (${a.agentPercent.toFixed(1)}%)`)
  lines.push(`- person: ${fmtInt(a.personLines)}`)
  if (a.unknownLines > 0) lines.push(`- unknown: ${fmtInt(a.unknownLines)} (uncommitted, unresolvable, or a placeholder identity)`)
  lines.push('')
  lines.push(`<details><summary>Attribution rule</summary>\n\n${a.rule}\n\n</details>`)
  return lines.join('\n')
}

/** Read release bodies from the workflow's already-fetched `gh api --paginate --slurp` inventory. */
export async function readPriorReleaseBodies(file, read = readFile, { allowEmpty = false } = {}) {
  // Fail closed. An absent snapshot path is not an empty release history: returning [] would
  // reset code-name selection to the first catalog record and republish a used dish. The
  // environment reader below guards with `if (file)` and reports its own missing-inventory
  // error, so this refusal only reaches a direct caller that supplied nothing.
  if (!file) throw new Error('RELEASE_PRIOR_BODIES_FILE is required; a missing snapshot is not an empty release history')
  const parsed = JSON.parse(await read(file, 'utf8'))
  if (!Array.isArray(parsed) || !parsed.every((page) => Array.isArray(page))) {
    throw new Error('prior release inventory must use the nested page array emitted by gh api --paginate --slurp')
  }
  const entries = parsed.flat()
  if (entries.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
    throw new Error('prior release inventory contains a malformed release entry')
  }
  if (!allowEmpty && entries.length === 0) {
    throw new Error('prior release inventory is empty for a non-first release')
  }
  return entries
    .map((entry) => {
      if (!Object.hasOwn(entry, 'body') || (entry.body !== null && typeof entry.body !== 'string')) {
        throw new Error('prior release inventory contains an invalid release body')
      }
      return typeof entry.body === 'string' ? entry.body : ''
    })
    .filter(Boolean)
}

export async function priorReleaseBodiesFromEnvironment({
  environment = process.env,
  read = readFile,
  warn = (message) => console.error(message),
} = {}) {
  try {
    const firstReleaseRaw = environment.RELEASE_IS_FIRST_RELEASE
    if (firstReleaseRaw != null && firstReleaseRaw !== 'true' && firstReleaseRaw !== 'false') {
      throw new Error('RELEASE_IS_FIRST_RELEASE must be exactly true or false')
    }
    const allowEmpty = firstReleaseRaw === 'true'
    const file = environment.RELEASE_PRIOR_BODIES_FILE
    if (file) return await readPriorReleaseBodies(file, read, { allowEmpty })

    if (environment.RELEASE_PRIOR_BODIES != null) {
      const bodies = environment.RELEASE_PRIOR_BODIES.split('\u0000').filter(Boolean)
      if (!allowEmpty && bodies.length === 0) {
        throw new Error('prior release bodies are empty for a non-first release')
      }
      return bodies
    }
    throw new Error('prior release inventory was not supplied')
  } catch (error) {
    // A broken history read is not a first release. Keep the optional name out rather than
    // publishing a duplicate, while allowing the build and release to continue.
    warn(`::warning::Prior release inventory was unavailable; omitting the optional release code name (${error instanceof Error ? error.message : String(error)}).`)
    return null
  }
}

function renderChecksSection() {
  return [
    '## What actually ran',
    '',
    '> [!IMPORTANT]',
    '> This workflow runs **no tests, type-check or lint**. Nothing in it gates this release —',
    '> a run only fails when the build, packaging, or publication itself fails. See',
    '> [`docs/ci-and-releases.md`](https://github.com/' +
      (process.env.GITHUB_REPOSITORY ?? 'Ding-Ding-Projects/material-nodeterm') +
      '/blob/main/docs/ci-and-releases.md) for the full policy.',
    '',
    'Executed by this run, with their real result (a failed step would have failed the run,',
    'so every item below genuinely completed):',
    '',
    '- `npm ci` — installed dependencies exactly as locked, including the postinstall',
    '  patch + native rebuild of `node-pty` for this runner\'s Electron ABI.',
    '- `npm run dist:win` — ran the Windows preflight, regenerated and verified the committed',
    '  source-SHA icon, compiled the app/session-host bundles, packaged the unsigned x64',
    '  Squirrel set, and checked RELEASES/nupkg identity plus Setup/app/stub icon metadata.',
    '',
    '**Not run here:** unit/integration tests (`npm test`), type-check (`npm run typecheck`),',
    'lint. Those are run locally by whoever changes the code, and their real results are',
    'never implied by this release existing — an ungated release is never described as',
    '"passing" a check it never ran.',
  ].join('\n')
}

function renderSigningSection() {
  return [
    '## Signing',
    '',
    '> [!WARNING]',
    '> **This installer is unsigned.** Code signing is permanently out of scope for this',
    '> project. Windows SmartScreen and the unknown-publisher warning will appear when you',
    '> run it — that is expected, not a sign of tampering. Verify the download instead by',
    '> checking the release commit and asset list below against what you expect.',
  ].join('\n')
}

export async function renderAssetsSection() {
  const assets = await listAssets()
  if (assets.length === 0) return null
  const lines = ['## Assets', '']
  for (const a of assets) {
    lines.push(
      `- \`${a.name}\`${a.size != null ? ` — ${fmtBytes(a.size)}` : ' — (size unavailable)'}` +
        `${a.sha256 ? ` — SHA-256 \`${a.sha256}\`` : ' — SHA-256 unavailable'}`,
    )
  }
  return lines.join('\n')
}

async function main() {
  const tag = process.env.RELEASE_TAG ?? '(unset)'
  const repo = process.env.GITHUB_REPOSITORY
  const sha = process.env.GITHUB_SHA

  const parts = []
  parts.push(`# ${tag}`)
  parts.push('')
  if (repo && sha) {
    parts.push(`Built from commit [\`${sha.slice(0, 12)}\`](https://github.com/${repo}/commit/${sha}).`)
    parts.push('')
  }
  parts.push(renderTimingSection())
  parts.push('')
  // Resolved before the rest so a slow catalog cannot land halfway down a finished document, and
  // AWAITED rather than raced: renderCodeNameSection('') simply omits the section, so an
  // unreachable catalog costs a heading, never a release. The prior-release snapshot is read once
  // and matched by both catalog id and bilingual name, so a dish is used once per project. An unset
  // snapshot means "nothing used yet", which is the correct answer for a project publishing its
  // first code name; a broken snapshot is different and omits the optional name safely.
  const codeNameSection = renderCodeNameSection(
    await resolveCodeName({
      releaseBodies: await priorReleaseBodiesFromEnvironment(),
      onPoolExhausted: ({ unusedCount, probes, maxProbes }) => {
        console.error(`::warning::Release code-name pool exhausted; continuing without a code name (unused candidates: ${unusedCount}, photo probes: ${probes}/${maxProbes}).`)
      }
    }).catch(() => null)
  )
  if (codeNameSection) {
    parts.push(codeNameSection)
    parts.push('')
  }
  parts.push(renderChecksSection())
  parts.push('')
  parts.push(renderSigningSection())
  parts.push('')
  const assetsSection = await renderAssetsSection()
  if (assetsSection) {
    parts.push(assetsSection)
    parts.push('')
  }
  parts.push(await renderLineCountSection())
  parts.push('')

  console.log(parts.join('\n'))
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((err) => {
    console.error('release-notes.mjs failed:', err)
    process.exitCode = 1
  })
}
