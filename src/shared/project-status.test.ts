// Tests for the pure project-status derivation.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ChangelogRelease } from '@shared/changelog'
import {
  GATE_STATE_META,
  GATE_STATE_ORDER,
  UNRECORDED_GATES,
  buildProjectStatus,
  captureGate,
  changelogItemLabel,
  describeRecordedAt,
  parseCaptureManifest,
  releaseGate,
  stateCounts,
  unrecordedGate,
  type GateState
} from './project-status'

const VALID_MANIFEST = {
  commit: 'f16535e9bd9117c8f82ff6c6e3d53843eee7c42d',
  capturedAt: '2026-08-19T07:14:20.773Z',
  method: 'Electron + CDP against out/, 1600x1000',
  captured: [
    { id: 'app-01-launch', title: 'App at launch', bytes: 49409 },
    { id: 'app-02-settings', title: 'Settings', bytes: 112656 }
  ],
  skipped: [{ id: 'app-agent-running', why: 'needs a real agent CLI session' }],
  failures: [] as { id: string; why: string }[]
}

function release(over: Partial<ChangelogRelease>): ChangelogRelease {
  return {
    version: '0.3.0',
    date: '2026-08-01',
    dateMs: Date.parse('2026-08-01T00:00:00.000Z'),
    commits: [
      {
        sha: 'a'.repeat(40),
        label: 'a'.repeat(40),
        url: `https://github.com/eneskirca/nodeterm/commit/${'a'.repeat(40)}`
      }
    ],
    items: [{ category: 'Added', text: '**Something** shipped.' }],
    ...over
  }
}

describe('parseCaptureManifest', () => {
  it('parses the well-formed shape', () => {
    const m = parseCaptureManifest(JSON.stringify(VALID_MANIFEST))
    expect(m).not.toBeNull()
    expect(m?.commit).toBe(VALID_MANIFEST.commit)
    expect(m?.captured).toHaveLength(2)
    expect(m?.skipped).toEqual(VALID_MANIFEST.skipped)
  })

  it('parses the REAL committed manifest — schema drift between the file and this parser is red', () => {
    const raw = readFileSync(
      fileURLToPath(new URL('../../docs/assets/shots/capture-manifest.json', import.meta.url)),
      'utf8'
    )
    expect(parseCaptureManifest(raw)).not.toBeNull()
  })

  it.each([
    ['null input', null],
    ['empty string', ''],
    ['not JSON', '{nope'],
    ['not an object', '"hi"'],
    ['missing commit', JSON.stringify({ ...VALID_MANIFEST, commit: undefined })],
    ['captured not an array', JSON.stringify({ ...VALID_MANIFEST, captured: 'x' })],
    ['malformed captured entry', JSON.stringify({ ...VALID_MANIFEST, captured: [{ id: 1 }] })],
    ['malformed skipped entry', JSON.stringify({ ...VALID_MANIFEST, skipped: [{ id: 'x' }] })],
    ['malformed failure entry', JSON.stringify({ ...VALID_MANIFEST, failures: [{}] })]
  ])('fails closed to null (unknown, never green) on %s', (_name, raw) => {
    expect(parseCaptureManifest(raw as string | null)).toBeNull()
  })

  it('treats absent skipped/failures as empty lists (older manifests)', () => {
    const m = parseCaptureManifest(
      JSON.stringify({ ...VALID_MANIFEST, skipped: undefined, failures: undefined })
    )
    expect(m).not.toBeNull()
    expect(m?.skipped).toEqual([])
    expect(m?.failures).toEqual([])
  })
})

describe('captureGate', () => {
  it('null manifest is UNRUN — unknown is not passed', () => {
    const card = captureGate(null)
    expect(card.state).toBe('unrun')
    expect(card.recordedAt).toBeNull()
  })

  it('a healthy run is verified, and every skipped surface stays an unrun row', () => {
    const card = captureGate(parseCaptureManifest(JSON.stringify(VALID_MANIFEST)))
    expect(card.state).toBe('verified')
    expect(card.recordedAt).toBe(VALID_MANIFEST.capturedAt)
    const skippedRows = card.rows.filter((r) => r.id.startsWith('skipped-'))
    expect(skippedRows).toHaveLength(1)
    expect(skippedRows[0].state).toBe('unrun')
    expect(card.rows.filter((r) => r.state === 'verified')).toHaveLength(2)
  })

  it('any recorded failure makes the whole gate FAILED even beside successful captures', () => {
    const withFailure = {
      ...VALID_MANIFEST,
      failures: [{ id: 'app-03-palette', why: 'opener step was not found' }]
    }
    const card = captureGate(parseCaptureManifest(JSON.stringify(withFailure)))
    expect(card.state).toBe('failed')
    expect(card.rows.some((r) => r.id === 'failed-app-03-palette' && r.state === 'failed')).toBe(true)
  })

  it('a manifest that photographed nothing is UNRUN, not verified-vacuously', () => {
    const card = captureGate(parseCaptureManifest(JSON.stringify({ ...VALID_MANIFEST, captured: [] })))
    expect(card.state).toBe('unrun')
  })
})

describe('releaseGate', () => {
  it('no dated release means UNRUN — no published release is claimed', () => {
    const card = releaseGate([release({ version: 'Unreleased', date: null, dateMs: null })], '0.1.0')
    expect(card.state).toBe('unrun')
  })

  it('pending unreleased work is WAITING, never verified', () => {
    const card = releaseGate(
      [release({ version: 'Unreleased', date: null, dateMs: null }), release({})],
      '0.3.0'
    )
    expect(card.state).toBe('waiting')
    expect(card.rows).toHaveLength(1)
    expect(card.rows[0].state).toBe('waiting')
  })

  it('a version bump alone (tree ahead of the newest recorded release) is WAITING', () => {
    const card = releaseGate([release({})], '0.4.3')
    expect(card.state).toBe('waiting')
    expect(card.summary).toContain('0.4.3')
  })

  it('everything shipped and version equal is verified — but never claims release verification', () => {
    const card = releaseGate([release({})], '0.3.0')
    expect(card.state).toBe('verified')
    const verification = card.evidence.find((e) => e.label === 'Release verification')
    expect(verification?.value).toContain('not recorded')
  })

  it('the newest release is picked by DATE, not array position', () => {
    const older = release({ version: '0.2.0', date: '2026-01-01', dateMs: Date.parse('2026-01-01T00:00:00.000Z') })
    const card = releaseGate([older, release({})], '0.3.0')
    expect(card.evidence[0].value).toContain('0.3.0')
  })

  it('reproduces recorded commit URLs verbatim', () => {
    const card = releaseGate([release({})], '0.3.0')
    const link = card.evidence.find((e) => e.href)
    expect(link?.href).toBe(`https://github.com/eneskirca/nodeterm/commit/${'a'.repeat(40)}`)
  })
})

describe('unrecorded gates', () => {
  it('the hand-written list is non-empty (a derived-empty list would pass vacuously)', () => {
    expect(UNRECORDED_GATES.length).toBeGreaterThanOrEqual(5)
  })

  it('every unrecorded gate is UNRUN with no recorded timestamp — never verified', () => {
    for (const spec of UNRECORDED_GATES) {
      const card = unrecordedGate(spec)
      expect(card.state).toBe('unrun')
      expect(card.recordedAt).toBeNull()
      expect(card.evidence.some((e) => e.value === spec.command)).toBe(true)
    }
  })
})

describe('buildProjectStatus', () => {
  it('composes capture + release + every unrecorded gate, with the capture commit as baseline', () => {
    const model = buildProjectStatus({
      manifestRaw: JSON.stringify(VALID_MANIFEST),
      releases: [release({})],
      currentVersion: '0.3.0'
    })
    expect(model.cards).toHaveLength(2 + UNRECORDED_GATES.length)
    expect(model.baselineCommit).toBe(VALID_MANIFEST.commit)
    // Freshest evidence: the capture (2026-08-19) beats the release date (2026-08-01).
    expect(model.newestRecordedAt).toBe(VALID_MANIFEST.capturedAt)
  })

  it('an unreadable manifest yields a null baseline, not an invented one', () => {
    const model = buildProjectStatus({ manifestRaw: '{broken', releases: [], currentVersion: null })
    expect(model.baselineCommit).toBeNull()
    expect(model.cards[0].state).toBe('unrun')
  })
})

describe('presentation helpers', () => {
  it('stateCounts reports every state, zeros included, so filter chips cannot lie by absence', () => {
    const counts = stateCounts([captureGate(null)])
    expect(Object.keys(counts).sort()).toEqual(
      ['blocked', 'failed', 'running', 'unrun', 'verified', 'waiting'].sort()
    )
    expect(counts.unrun).toBe(1)
    expect(counts.verified).toBe(0)
  })

  it('GATE_STATE_META and GATE_STATE_ORDER cover exactly the same states, failed first', () => {
    const metaKeys = Object.keys(GATE_STATE_META).sort()
    expect([...GATE_STATE_ORDER].sort()).toEqual(metaKeys)
    expect(GATE_STATE_ORDER[0]).toBe('failed')
    const states: GateState[] = ['running', 'waiting', 'blocked', 'failed', 'verified', 'unrun']
    for (const s of states) expect(GATE_STATE_META[s].emoji.length).toBeGreaterThan(0)
  })

  it('describeRecordedAt is honest at every edge', () => {
    const now = Date.parse('2026-08-19T12:00:00.000Z')
    expect(describeRecordedAt(null, now)).toBe('not recorded')
    expect(describeRecordedAt('garbage', now)).toBe('unreadable timestamp')
    expect(describeRecordedAt('2026-08-19T13:00:00.000Z', now)).toBe(
      'timestamped in the future (clock skew?)'
    )
    expect(describeRecordedAt('2026-08-19T11:59:50.000Z', now)).toBe('just now')
    expect(describeRecordedAt('2026-08-19T11:30:00.000Z', now)).toBe('30 min ago')
    expect(describeRecordedAt('2026-08-19T04:00:00.000Z', now)).toBe('8 h ago')
    expect(describeRecordedAt('2026-08-12T12:00:00.000Z', now)).toBe('7 days ago')
  })

  it('changelogItemLabel strips markdown markers and truncates with an ellipsis', () => {
    expect(changelogItemLabel('**Bold** and `code`.')).toBe('Bold and code.')
    const long = 'x'.repeat(200)
    const label = changelogItemLabel(long)
    expect(label.length).toBe(160)
    expect(label.endsWith('…')).toBe(true)
  })
})
