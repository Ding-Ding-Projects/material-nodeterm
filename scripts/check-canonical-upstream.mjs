#!/usr/bin/env node

/**
 * Verify the repository's canonical upstream lineage without editing the nested checkout.
 *
 * The local checks prove that .gitmodules, the top-level gitlink, and the nested checkout all
 * identify the same reviewed snapshot. The optional network probe asks the nested checkout's
 * origin for its declared default branch. A failed probe is reported as offline-unverified, never
 * as a verified result.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CANONICAL_PATH = 'upstream/nodeterm'
export const CANONICAL_URL = 'https://github.com/eneskirca/nodeterm.git'
export const CANONICAL_BRANCH = 'main'
export const CANONICAL_COMMIT = 'abb351bfd98a2ced036cb8768c67cf832a7611f6'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function git(args, root) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function parseGitmodules(text) {
  const sections = []
  let current
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    const section = /^\[submodule "([^"]+)"\]$/.exec(line)
    if (section) {
      current = { name: section[1] }
      sections.push(current)
      continue
    }
    if (!current || line.startsWith('#') || line.length === 0) continue
    const assignment = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/.exec(line)
    if (assignment) current[assignment[1]] = assignment[2].trim()
  }
  return sections
}

function problem(problems, message) {
  problems.push(message)
}

function parseGitlink(output) {
  const matches = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => /^([0-9]+) ([0-9a-f]{40}) ([0-3])\s+(.+)$/.exec(line))
    .filter(Boolean)
  return matches.find((match) => match[4] === CANONICAL_PATH)
}

function runSafely(runGit, args, root, label, problems) {
  try {
    return { value: runGit(args, root), error: undefined }
  } catch (error) {
    problem(problems, `${label}: ${error instanceof Error ? error.message : String(error)}`)
    return { value: undefined, error }
  }
}

/**
 * Inspect canonical lineage.
 *
 * `probeReachability` defaults to true. Set it to false only for an explicitly offline local
 * inspection; the returned state remains `offline-unverified` and `ok` remains false.
 */
export function inspectCanonicalUpstream({
  root = ROOT,
  runGit = git,
  probeReachability = true,
} = {}) {
  const problems = []
  const metadataPath = join(root, '.gitmodules')
  const nestedPath = join(root, CANONICAL_PATH)
  let metadata
  if (!existsSync(metadataPath)) {
    problem(problems, '.gitmodules is missing')
  } else {
    try {
      metadata = readFileSync(metadataPath, 'utf8')
    } catch (error) {
      problem(problems, `.gitmodules cannot be read: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const sections = metadata === undefined ? [] : parseGitmodules(metadata)
  const canonicalSections = sections.filter((section) => section.name === 'upstream/nodeterm')
  if (canonicalSections.length !== 1) {
    problem(problems, `.gitmodules must contain exactly one submodule "upstream/nodeterm" section; found ${canonicalSections.length}`)
  }
  const section = canonicalSections[0]
  if (section?.path !== CANONICAL_PATH) problem(problems, `.gitmodules path must be ${CANONICAL_PATH}`)
  if (section?.url !== CANONICAL_URL) problem(problems, `.gitmodules URL must be ${CANONICAL_URL}`)
  if (section?.branch !== CANONICAL_BRANCH) problem(problems, `.gitmodules branch must be ${CANONICAL_BRANCH}`)

  const gitlinkResult = runSafely(
    runGit,
    ['ls-files', '-s', '--', CANONICAL_PATH],
    root,
    'top-level gitlink could not be read',
    problems,
  )
  const gitlink = gitlinkResult.value === undefined ? undefined : parseGitlink(gitlinkResult.value)
  if (!gitlink) {
    problem(problems, `top-level index has no stage-0 gitlink for ${CANONICAL_PATH}`)
  } else {
    if (gitlink[2] !== CANONICAL_COMMIT) problem(problems, `top-level gitlink points to ${gitlink[2]}, expected ${CANONICAL_COMMIT}`)
    if (gitlink[4] !== CANONICAL_PATH) problem(problems, `top-level gitlink path is ${gitlink[4]}, expected ${CANONICAL_PATH}`)
    if (gitlink[4] === CANONICAL_PATH && gitlink[3] !== '0') problem(problems, `top-level gitlink is at index stage ${gitlink[3]}, expected stage 0`)
    if (gitlink[1] !== '160000') problem(problems, `top-level entry has mode ${gitlink[1]}, expected gitlink mode 160000`)
  }

  if (!existsSync(nestedPath)) {
    problem(problems, `nested checkout is missing at ${CANONICAL_PATH}`)
  } else {
    const url = runSafely(
      runGit,
      ['-C', CANONICAL_PATH, 'remote', 'get-url', 'origin'],
      root,
      'nested origin URL could not be read',
      problems,
    ).value
    if (url !== CANONICAL_URL) problem(problems, `nested origin URL is ${url ?? '(unavailable)'}, expected ${CANONICAL_URL}`)

    const head = runSafely(
      runGit,
      ['-C', CANONICAL_PATH, 'rev-parse', 'HEAD'],
      root,
      'nested HEAD could not be read',
      problems,
    ).value
    if (head !== CANONICAL_COMMIT) problem(problems, `nested HEAD is ${head ?? '(unavailable)'}, expected ${CANONICAL_COMMIT}`)
  }

  let reachability = 'offline-unverified'
  let remoteCommit
  if (probeReachability && existsSync(nestedPath)) {
    try {
      const output = runGit(
        ['-C', CANONICAL_PATH, 'ls-remote', 'origin', `refs/heads/${CANONICAL_BRANCH}`],
        root,
      )
      const match = /^([0-9a-f]{40})\s+refs\/heads\/main$/m.exec(output)
      if (!match) {
        reachability = 'unverified'
        problem(problems, `canonical origin did not return refs/heads/${CANONICAL_BRANCH}`)
      } else {
        remoteCommit = match[1]
        if (remoteCommit !== CANONICAL_COMMIT) {
          reachability = 'mismatch'
          problem(problems, `canonical origin refs/heads/${CANONICAL_BRANCH} is ${remoteCommit}, expected ${CANONICAL_COMMIT}`)
        } else {
          reachability = 'verified'
        }
      }
    } catch (error) {
      reachability = 'offline-unverified'
      problem(problems, `canonical origin reachability is offline-unverified: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const offlineOnly = problems.every((entry) => entry.includes('offline-unverified'))
  const state = problems.length === 0 && reachability === 'verified'
    ? 'verified'
    : reachability === 'offline-unverified' && offlineOnly
      ? 'offline-unverified'
      : 'invalid'

  return {
    ok: state === 'verified',
    state,
    reachability,
    expected: {
      path: CANONICAL_PATH,
      url: CANONICAL_URL,
      branch: CANONICAL_BRANCH,
      commit: CANONICAL_COMMIT,
    },
    remoteCommit,
    problems,
  }
}

function printReport(report) {
  console.log(`canonical upstream: ${report.state}`)
  console.log(`  path: ${report.expected.path}`)
  console.log(`  URL: ${report.expected.url}`)
  console.log(`  default branch: ${report.expected.branch}`)
  console.log(`  reviewed commit: ${report.expected.commit}`)
  console.log(`  reachability: ${report.reachability}${report.remoteCommit ? ` (${report.remoteCommit})` : ''}`)
  for (const entry of report.problems) console.error(`  ! ${entry}`)
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const offline = process.argv.includes('--offline')
  const report = inspectCanonicalUpstream({ probeReachability: !offline })
  printReport(report)
  process.exitCode = report.ok ? 0 : 1
}
