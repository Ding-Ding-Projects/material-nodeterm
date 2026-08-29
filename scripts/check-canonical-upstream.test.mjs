import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  CANONICAL_BRANCH,
  CANONICAL_COMMIT,
  CANONICAL_PATH,
  CANONICAL_URL,
  inspectCanonicalUpstream,
} from './check-canonical-upstream.mjs'

const roots = []

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'canonical-upstream-'))
  roots.push(root)
  await writeFile(
    path.join(root, '.gitmodules'),
    `[submodule "upstream/nodeterm"]\n\tpath = ${CANONICAL_PATH}\n\turl = ${CANONICAL_URL}\n\tbranch = ${CANONICAL_BRANCH}\n`,
    'utf8',
  )
  await mkdir(path.join(root, CANONICAL_PATH), { recursive: true })
  return root
}

function fakeGit({ gitlink = CANONICAL_COMMIT, head = CANONICAL_COMMIT, url = CANONICAL_URL, remote = CANONICAL_COMMIT, reachabilityError = false } = {}) {
  return (args) => {
    const key = args.join(' ')
    if (key === `ls-files -s -- ${CANONICAL_PATH}`) return `160000 ${gitlink} 0\t${CANONICAL_PATH}`
    if (key === `-C ${CANONICAL_PATH} remote get-url origin`) return url
    if (key === `-C ${CANONICAL_PATH} rev-parse HEAD`) return head
    if (key === `-C ${CANONICAL_PATH} ls-remote origin refs/heads/${CANONICAL_BRANCH}`) {
      if (reachabilityError) throw new Error('network unavailable')
      return `${remote} refs/heads/${CANONICAL_BRANCH}`
    }
    throw new Error(`unexpected git call: ${key}`)
  }
}

afterEach(async () => {
  while (roots.length > 0) await rm(roots.pop(), { recursive: true, force: true })
})

describe('canonical upstream lineage', () => {
  it('is verified only when metadata, gitlink, nested checkout, and origin agree', async () => {
    const root = await fixture()
    const report = inspectCanonicalUpstream({ root, runGit: fakeGit() })
    expect({ ok: report.ok, state: report.state, reachability: report.reachability, remoteCommit: report.remoteCommit })
      .toEqual({ ok: true, state: 'verified', reachability: 'verified', remoteCommit: CANONICAL_COMMIT })
    expect(report.problems).toEqual([])
  })

  it('turns red when the canonical URL changes', async () => {
    const root = await fixture()
    const metadata = `[submodule "upstream/nodeterm"]\n\tpath = ${CANONICAL_PATH}\n\turl = https://example.invalid/not-canonical.git\n\tbranch = ${CANONICAL_BRANCH}\n`
    await writeFile(path.join(root, '.gitmodules'), metadata, 'utf8')
    const report = inspectCanonicalUpstream({ root, runGit: fakeGit({ url: 'https://example.invalid/not-canonical.git' }) })
    expect(report.ok).toBe(false)
    expect(report.problems.some((entry) => entry.includes('URL'))).toBe(true)
  })

  it('turns red when the declared default branch changes', async () => {
    const root = await fixture()
    await writeFile(
      path.join(root, '.gitmodules'),
      `[submodule "upstream/nodeterm"]\n\tpath = ${CANONICAL_PATH}\n\turl = ${CANONICAL_URL}\n\tbranch = release\n`,
      'utf8',
    )
    const report = inspectCanonicalUpstream({ root, runGit: fakeGit() })
    expect(report.ok).toBe(false)
    expect(report.problems.some((entry) => entry.includes('branch'))).toBe(true)
  })

  it('turns red when the reviewed gitlink is not the requested commit', async () => {
    const root = await fixture()
    const wrong = '1111111111111111111111111111111111111111'
    const report = inspectCanonicalUpstream({ root, runGit: fakeGit({ gitlink: wrong }) })
    expect(report.ok).toBe(false)
    expect(report.problems.some((entry) => entry.includes('top-level gitlink points'))).toBe(true)
  })

  it('turns red when the nested checkout HEAD is not the requested commit', async () => {
    const root = await fixture()
    const wrong = '1111111111111111111111111111111111111111'
    const report = inspectCanonicalUpstream({ root, runGit: fakeGit({ head: wrong }) })
    expect(report.ok).toBe(false)
    expect(report.problems.some((entry) => entry.includes('nested HEAD is'))).toBe(true)
  })

  it('turns red when the reachable default branch points at another commit', async () => {
    const root = await fixture()
    const wrong = '2222222222222222222222222222222222222222'
    const report = inspectCanonicalUpstream({ root, runGit: fakeGit({ remote: wrong }) })
    expect(report.ok).toBe(false)
    expect(report.reachability).toBe('mismatch')
  })

  it('reports offline-unverified instead of claiming a verified lineage', async () => {
    const root = await fixture()
    const report = inspectCanonicalUpstream({ root, runGit: fakeGit({ reachabilityError: true }) })
    expect(report.ok).toBe(false)
    expect(report.state).toBe('offline-unverified')
    expect(report.reachability).toBe('offline-unverified')
    expect(report.problems.some((entry) => entry.includes('offline-unverified'))).toBe(true)
  })

  it('keeps explicitly offline inspection honest', async () => {
    const root = await fixture()
    const report = inspectCanonicalUpstream({ root, runGit: fakeGit(), probeReachability: false })
    expect(report.ok).toBe(false)
    expect(report.state).toBe('offline-unverified')
    expect(report.reachability).toBe('offline-unverified')
  })
})
