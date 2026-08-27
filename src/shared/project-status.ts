// Pure derivation of the app's own gate states — what THIS build can prove about its own
// project, from evidence the repository actually records, and nothing else.
//
// The whole module is governed by one rule: A CHECK THAT HAS NOT RUN IS UNRUN, NOT PASSED.
// The repository records exactly two kinds of gate evidence today — the capture manifest
// (docs/assets/shots/capture-manifest.json, written by scripts/capture-shots.mjs with the
// commit/time/method it photographed) and the generated changelog (src/shared/changelog-data.ts,
// which records every released version with its date and commits). Typecheck, the test suite,
// the production build, and the contract scans record NO verdict anywhere in the tree, so their
// cards are permanently 'unrun' here — they name the command that runs them instead of inventing
// a green tick. If one of those ever starts writing a committed verdict, teach this module to
// read it; never compute a state the repo cannot evidence.
//
// It lives in src/shared, which is the ONE include tsconfig.node.json and tsconfig.web.json both
// carry. That matters: a renderer import of src/core fails `tsc -p tsconfig.web.json` with
// TS6307 and the reverse fails the node project the same way, so a first pass at this module put
// it at two paths byte-for-byte with a parity test holding them together. Two copies of one file
// are two files that disagree eventually, and the shared include removes the need entirely —
// both projects import this one.
//
// Keep this module dependency-free apart from the @shared type import below (the @shared alias
// resolves identically in tsconfig.node.json, tsconfig.web.json and vitest.config.ts — a relative
// import would resolve differently from the two homes and break byte parity).

import type { ChangelogRelease } from '@shared/changelog'

/** The shared 4-plus-2 state model every gate card reports in. */
export type GateState = 'running' | 'waiting' | 'blocked' | 'failed' | 'verified' | 'unrun'

/**
 * The STABLE emoji mapping — one meaningful emoji per state, the same everywhere this surface
 * (or any sibling status surface) renders one. The emoji is scanability, never authority: it
 * must not upgrade an unverified state, which is why 'unrun' gets its own honest ❔ instead of
 * borrowing a friendlier glyph.
 */
export const GATE_STATE_META: Record<GateState, { emoji: string; label: string }> = {
  running: { emoji: '🏃', label: 'Running' },
  waiting: { emoji: '⏳', label: 'Waiting' },
  blocked: { emoji: '🧱', label: 'Blocked' },
  failed: { emoji: '❌', label: 'Failed' },
  verified: { emoji: '✅', label: 'Verified' },
  unrun: { emoji: '❔', label: 'Unrun' }
}

/** Worst-first display order: a failure must never sort below a pile of green. */
export const GATE_STATE_ORDER: readonly GateState[] = [
  'failed',
  'blocked',
  'running',
  'waiting',
  'unrun',
  'verified'
]

/** One fact backing a card's claim. `href` only when the repo itself recorded a URL. */
export interface StatusEvidence {
  label: string
  value: string
  href?: string
}

/** One per-item lane inside a card's expandable detail (a captured surface, a pending change). */
export interface StatusGateRow {
  id: string
  label: string
  /** Capture labels are authored UI copy; changelog and release-note labels are external data. */
  labelOwnership: 'authored' | 'factual'
  state: GateState
  note: string
}

/** A status sentence carries authored copy separately from evidence values. This prevents a
 * vocabulary replacement from changing a version, count, timestamp, or commit identifier. */
export type StatusSummaryPart =
  | { kind: 'authored'; text: string }
  | { kind: 'factual'; text: string }

export interface StatusGateCard {
  id: string
  title: string
  state: GateState
  /** One honest sentence. States what is known, and equally what is NOT recorded. */
  summary: string
  /** Optional typed rendering parts for the summary. Legacy callers can keep using `summary`. */
  summaryParts?: readonly StatusSummaryPart[]
  /** ISO timestamp of the recorded evidence behind this card, or null = the repo records none. */
  recordedAt: string | null
  evidence: StatusEvidence[]
  rows: StatusGateRow[]
}

// ---------------------------------------------------------------------------
// Capture manifest (docs/assets/shots/capture-manifest.json)
// ---------------------------------------------------------------------------

export interface CaptureManifestEntry {
  id: string
  title: string
  bytes: number
}

export interface CaptureManifestSkip {
  id: string
  why: string
}

export interface CaptureManifestFailure {
  id: string
  why: string
}

export interface CaptureManifest {
  commit: string
  capturedAt: string
  method: string
  captured: CaptureManifestEntry[]
  skipped: CaptureManifestSkip[]
  failures: CaptureManifestFailure[]
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isString = (v: unknown): v is string => typeof v === 'string'

/**
 * Tolerant-at-the-edges, strict-at-the-core parse of the capture manifest. Anything malformed —
 * bad JSON, a missing field, a mistyped entry — returns null, and null renders as UNRUN/unknown.
 * The failure direction is deliberate: a broken manifest must degrade to "we cannot claim a
 * capture state", never to a green card built from half-read evidence.
 */
export function parseCaptureManifest(raw: string | null | undefined): CaptureManifest | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const { commit, capturedAt, method } = parsed
  if (!isString(commit) || !isString(capturedAt) || !isString(method)) return null
  if (!Array.isArray(parsed.captured)) return null
  const captured: CaptureManifestEntry[] = []
  for (const e of parsed.captured) {
    if (!isRecord(e) || !isString(e.id) || !isString(e.title) || typeof e.bytes !== 'number') return null
    captured.push({ id: e.id, title: e.title, bytes: e.bytes })
  }
  const skippedRaw = parsed.skipped ?? []
  if (!Array.isArray(skippedRaw)) return null
  const skipped: CaptureManifestSkip[] = []
  for (const e of skippedRaw) {
    if (!isRecord(e) || !isString(e.id) || !isString(e.why)) return null
    skipped.push({ id: e.id, why: e.why })
  }
  const failuresRaw = parsed.failures ?? []
  if (!Array.isArray(failuresRaw)) return null
  const failures: CaptureManifestFailure[] = []
  for (const e of failuresRaw) {
    if (!isRecord(e) || !isString(e.id) || !isString(e.why)) return null
    failures.push({ id: e.id, why: e.why })
  }
  return { commit, capturedAt, method, captured, skipped, failures }
}

export function shortCommit(sha: string): string {
  return sha.slice(0, 8)
}

/** The capture gate: the one gate with real committed run evidence (provenance included). */
export function captureGate(manifest: CaptureManifest | null): StatusGateCard {
  if (manifest === null) {
    const summary =
      'No capture manifest is readable in this build, so the capture state is unknown — and unknown is not passed.'
    return {
      id: 'captures',
      title: 'Built-app captures',
      state: 'unrun',
      summary,
      summaryParts: [{ kind: 'authored', text: summary }],
      recordedAt: null,
      evidence: [{ label: 'Runs with', value: 'npm run shots -- --launch' }],
      rows: []
    }
  }
  const rows: StatusGateRow[] = [
    ...manifest.captured.map((c) => ({
      id: `captured-${c.id}`,
      label: c.title,
      labelOwnership: 'authored' as const,
      state: 'verified' as GateState,
      note: `${c.id} · ${c.bytes} bytes`
    })),
    ...manifest.skipped.map((s) => ({
      id: `skipped-${s.id}`,
      label: s.id,
      labelOwnership: 'factual' as const,
      state: 'unrun' as GateState,
      note: `skipped — ${s.why}`
    })),
    ...manifest.failures.map((f) => ({
      id: `failed-${f.id}`,
      label: f.id,
      labelOwnership: 'factual' as const,
      state: 'failed' as GateState,
      note: f.why
    }))
  ]
  const evidence: StatusEvidence[] = [
    // Full SHA on purpose — exactness beats prettiness, and the repo records no URL for its own
    // commits, so this is text, never a fabricated link.
    { label: 'Capture commit', value: manifest.commit },
    { label: 'Captured at', value: manifest.capturedAt },
    { label: 'Method', value: manifest.method },
    { label: 'Surfaces photographed', value: String(manifest.captured.length) }
  ]
  if (manifest.skipped.length > 0) {
    evidence.push({
      label: 'Skipped surfaces',
      value: `${manifest.skipped.length} — each stays unrun, listed below with its reason`
    })
  }
  if (manifest.failures.length > 0) {
    const summary = `The last recorded capture run failed on ${manifest.failures.length} surface${
      manifest.failures.length === 1 ? '' : 's'
    }.`
    return {
      id: 'captures',
      title: 'Built-app captures',
      state: 'failed',
      summary,
      summaryParts: [
        { kind: 'authored', text: 'The last recorded capture run failed on ' },
        { kind: 'factual', text: String(manifest.failures.length) },
        { kind: 'authored', text: manifest.failures.length === 1 ? ' surface.' : ' surfaces.' }
      ],
      recordedAt: manifest.capturedAt,
      evidence,
      rows
    }
  }
  if (manifest.captured.length === 0) {
    const summary =
      'A capture manifest exists but records no photographed surface, so the capture state is unrun.'
    return {
      id: 'captures',
      title: 'Built-app captures',
      state: 'unrun',
      summary,
      summaryParts: [{ kind: 'authored', text: summary }],
      recordedAt: manifest.capturedAt,
      evidence,
      rows
    }
  }
  const summary = `The last recorded capture run photographed ${manifest.captured.length} surfaces of the real built app from commit ${shortCommit(
    manifest.commit
  )}${manifest.skipped.length > 0 ? `; ${manifest.skipped.length} surfaces were skipped and stay unrun` : ''}.`
  return {
    id: 'captures',
    title: 'Built-app captures',
    state: 'verified',
    summary,
    summaryParts: [
      { kind: 'authored', text: 'The last recorded capture run photographed ' },
      { kind: 'factual', text: String(manifest.captured.length) },
      { kind: 'authored', text: ' surfaces of the real built app from commit ' },
      { kind: 'factual', text: shortCommit(manifest.commit) },
      ...(manifest.skipped.length > 0
        ? [
            { kind: 'authored' as const, text: '; ' },
            { kind: 'factual' as const, text: String(manifest.skipped.length) },
            { kind: 'authored' as const, text: ' surfaces were skipped and stay unrun' }
          ]
        : []),
      { kind: 'authored', text: '.' }
    ],
    recordedAt: manifest.capturedAt,
    evidence,
    rows
  }
}

// ---------------------------------------------------------------------------
// Release gate (src/shared/changelog-data.ts — the generated changelog)
// ---------------------------------------------------------------------------

/** Strip markdown emphasis/backticks and truncate — a lane LABEL, not the rendered changelog
 *  (that lives one rail click away in History, through the real markdown pipeline). */
export function changelogItemLabel(text: string, max = 160): string {
  const plain = text.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

/**
 * The release gate answers "what is the newest release this tree RECORDS, and is anything
 * waiting on the next one". It deliberately does NOT claim release verification: the changelog
 * records that a version shipped on a date with these commits, and nothing in the tree records
 * a packaged install/update verification — so the card says exactly that.
 */
export function releaseGate(
  releases: readonly ChangelogRelease[],
  currentVersion: string | null
): StatusGateCard {
  // Newest by recorded date, never by array position — defensive against a re-ordered generator.
  let newest: ChangelogRelease | null = null
  for (const r of releases) {
    if (r.dateMs === null) continue
    if (newest === null || r.dateMs > (newest.dateMs as number)) newest = r
  }
  const unreleased = releases.find((r) => r.date === null) ?? null
  const pendingItems = unreleased?.items.length ?? 0
  const pendingCommits = unreleased?.commits.length ?? 0

  if (newest === null) {
    const summary = 'The changelog records no dated release, so no published release can be claimed.'
    return {
      id: 'release',
      title: 'Release',
      state: 'unrun',
      summary,
      summaryParts: [{ kind: 'authored', text: summary }],
      recordedAt: null,
      evidence: [
        { label: 'Version in this tree', value: currentVersion ?? 'unreadable' },
        { label: 'Changes awaiting a first release', value: String(pendingItems) }
      ],
      rows: []
    }
  }

  const versionAhead = currentVersion !== null && currentVersion !== newest.version
  const waiting = pendingItems > 0 || pendingCommits > 0 || versionAhead
  const evidence: StatusEvidence[] = [
    { label: 'Newest recorded release', value: `${newest.version} — ${newest.date}` },
    { label: 'Version in this tree', value: currentVersion ?? 'unreadable' },
    { label: 'Changes awaiting the next release', value: String(pendingItems) },
    {
      label: 'Release verification',
      value: 'not recorded in this tree — not claimed'
    },
    // The commit links are DATA recorded by the changelog generator, reproduced verbatim.
    ...newest.commits.slice(0, 3).map((c) => ({
      label: 'Release commit',
      value: c.label,
      href: c.url
    }))
  ]
  const rows: StatusGateRow[] = (unreleased?.items ?? []).map((item, i) => ({
    id: `unreleased-${i}`,
    label: changelogItemLabel(item.text),
    labelOwnership: 'factual',
    state: 'waiting' as GateState,
    note: item.category
  }))
  const summary = waiting
    ? `The newest release this tree records is ${newest.version} (${newest.date}). ${pendingItems} recorded change${
        pendingItems === 1 ? '' : 's'
      }${versionAhead ? ` and the version bump to ${currentVersion}` : ''} are waiting for the next release.`
    : `Everything the changelog records has shipped in ${newest.version} (${newest.date}). No packaged-install verification is recorded in this tree, so none is claimed.`
  const summaryParts = waiting
    ? [
        { kind: 'authored' as const, text: 'The newest release this tree records is ' },
        { kind: 'factual' as const, text: newest.version },
        { kind: 'authored' as const, text: ' (' },
        { kind: 'factual' as const, text: newest.date },
        { kind: 'authored' as const, text: '). ' },
        { kind: 'factual' as const, text: String(pendingItems) },
        { kind: 'authored' as const, text: pendingItems === 1 ? ' recorded change' : ' recorded changes' },
        ...(versionAhead
          ? [
              { kind: 'authored' as const, text: ' and the version bump to ' },
              { kind: 'factual' as const, text: currentVersion as string }
            ]
          : []),
        { kind: 'authored' as const, text: ' are waiting for the next release.' }
      ]
    : [
        { kind: 'authored' as const, text: 'Everything the changelog records has shipped in ' },
        { kind: 'factual' as const, text: newest.version },
        { kind: 'authored' as const, text: ' (' },
        { kind: 'factual' as const, text: newest.date },
        { kind: 'authored' as const, text: '). No packaged-install verification is recorded in this tree, so none is claimed.' }
      ]
  return {
    id: 'release',
    title: 'Release',
    state: waiting ? 'waiting' : 'verified',
    summary,
    summaryParts,
    recordedAt: newest.date ? `${newest.date}T00:00:00.000Z` : null,
    evidence,
    rows
  }
}

// ---------------------------------------------------------------------------
// Gates the repository records NO verdict for
// ---------------------------------------------------------------------------

export interface UnrecordedGateSpec {
  id: string
  title: string
  command: string
  what: string
}

/**
 * Hand-written, like every completeness list in this repo: these are the gates a person asks
 * about first, and none of them writes a committed verdict. Their cards are therefore UNRUN by
 * construction — they can only name the command that would produce a verdict.
 */
export const UNRECORDED_GATES: readonly UnrecordedGateSpec[] = [
  {
    id: 'typecheck',
    title: 'Typecheck',
    command: 'npm run typecheck',
    what: 'tsc across the node (main/core/server) and web (renderer) projects.'
  },
  {
    id: 'tests',
    title: 'Test suite',
    command: 'npm test',
    what: 'The vitest unit + integration suite.'
  },
  {
    id: 'build-wired',
    title: 'Build + wired check',
    command: 'npm run build && npm run check:wired',
    what: 'Builds out/ and drives real controls in the built artifact over CDP.'
  },
  {
    id: 'app-contract',
    title: 'App contract scan',
    command: 'node scripts/check-app-contract.mjs',
    what: 'Source-level completeness guards (bundled fonts, unlock ladder, and siblings).'
  },
  {
    id: 'site-shot-mirror',
    title: 'Site capture mirror',
    command: 'node scripts/check-site-shots.mjs',
    what: 'docs/ and site/ captures must be byte-identical.'
  }
]

export function unrecordedGate(spec: UnrecordedGateSpec): StatusGateCard {
  const summary = `${spec.what} No verdict is recorded in the repository, so this build cannot claim one — a check that has not run is unrun, not passed.`
  return {
    id: spec.id,
    title: spec.title,
    state: 'unrun',
    summary,
    summaryParts: [{ kind: 'authored', text: summary }],
    recordedAt: null,
    evidence: [{ label: 'Runs with', value: spec.command }],
    rows: []
  }
}

// ---------------------------------------------------------------------------
// The assembled model
// ---------------------------------------------------------------------------

export interface ProjectStatusInput {
  /** Raw bytes of docs/assets/shots/capture-manifest.json as bundled at build time, or null. */
  manifestRaw: string | null
  /** The generated changelog (src/shared/changelog-data.ts). */
  releases: readonly ChangelogRelease[]
  /** package.json version as bundled at build time, or null when unreadable. */
  currentVersion: string | null
}

export interface ProjectStatusModel {
  cards: StatusGateCard[]
  /** The capture manifest's commit — the freshest commit-pinned evidence the repo records. */
  baselineCommit: string | null
  /** ISO timestamp of the freshest recorded evidence across every card, or null. */
  newestRecordedAt: string | null
}

export function buildProjectStatus(input: ProjectStatusInput): ProjectStatusModel {
  const manifest = parseCaptureManifest(input.manifestRaw)
  const cards: StatusGateCard[] = [
    captureGate(manifest),
    releaseGate(input.releases, input.currentVersion),
    ...UNRECORDED_GATES.map(unrecordedGate)
  ]
  let newestMs: number | null = null
  let newestIso: string | null = null
  for (const c of cards) {
    if (c.recordedAt === null) continue
    const ms = Date.parse(c.recordedAt)
    if (Number.isNaN(ms)) continue
    if (newestMs === null || ms > newestMs) {
      newestMs = ms
      newestIso = c.recordedAt
    }
  }
  return {
    cards,
    baselineCommit: manifest?.commit ?? null,
    newestRecordedAt: newestIso
  }
}

/** Counts per state, every state present (zero included) so filter chips cannot lie by absence. */
export function stateCounts(cards: readonly StatusGateCard[]): Record<GateState, number> {
  const counts: Record<GateState, number> = {
    running: 0,
    waiting: 0,
    blocked: 0,
    failed: 0,
    verified: 0,
    unrun: 0
  }
  for (const c of cards) counts[c.state] += 1
  return counts
}

/**
 * Human age of a recorded timestamp against a caller-supplied "now" (injected for determinism).
 * Honest at the edges: null is "not recorded", an unparseable stamp says so, and a stamp ahead
 * of the clock is reported as skew rather than rounded to a friendly zero.
 */
export function describeRecordedAt(iso: string | null, nowMs: number): string {
  if (iso === null) return 'not recorded'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unreadable timestamp'
  const delta = nowMs - t
  if (delta < -60_000) return 'timestamped in the future (clock skew?)'
  if (delta < 45_000) return 'just now'
  if (delta < 90 * 60_000) return `${Math.max(1, Math.round(delta / 60_000))} min ago`
  if (delta < 36 * 3_600_000) return `${Math.round(delta / 3_600_000)} h ago`
  return `${Math.round(delta / 86_400_000)} days ago`
}
