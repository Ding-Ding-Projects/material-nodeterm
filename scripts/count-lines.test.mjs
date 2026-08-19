/**
 * count-lines.test.mjs — runs the REAL release line counter (`computeLineCounts`) over a small
 * fixture Git repository and asserts the contract the release notes depend on:
 *
 *   - source / tests / styles / docs are broken down separately, with total AND non-blank lines;
 *   - exclusions are STATED (path + reason), never applied silently, and generated files
 *     (the lockfile) are separated from hand-written ones;
 *   - a grand total is reported alongside the project total;
 *   - surviving-line attribution distinguishes agent, person, and placeholder-identity commits;
 *   - and — above all — the counter's own arithmetic AGREES WITH ITSELF: the blame attribution
 *     total equals the line-count total. The classic way to break that is counting a file's
 *     trailing newline as an extra line (git blame does not), so the fixture deliberately mixes
 *     files WITH and WITHOUT a trailing newline.
 *
 * The fixture is hermetic: its own temp directory, global/system git config pointed at
 * nonexistent files, and explicit author/committer identities per commit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { computeLineCounts } from './count-lines.mjs'

const execFileAsync = promisify(execFile)

// ---- fixture file contents (hand-countable on sight) --------------------------------------
// 5 lines total, 4 non-blank (line 4 is blank), WITH a trailing newline.
const APP_TS = "export function add(a, b) {\n  return a + b\n}\n\nexport const NAME = 'fixture'\n"
// 3 lines total, 3 non-blank, WITHOUT a trailing newline.
const STYLE_CSS = 'body {\n  color: red;\n}'
// 3 lines total, 2 non-blank (line 2 is blank), WITH a trailing newline.
const APP_TEST_TS = "import { add } from './app'\n\nif (add(1, 2) !== 3) throw new Error('nope')\n"
// 2 lines total, 2 non-blank.
const NOTES_MD = 'fixture notes\nsecond line\n'
// Excluded by the counter's own stated rule (npm-generated lockfile).
const LOCKFILE = '{\n  "name": "fixture"\n}\n'

const PERSON = { name: 'Alice Fixture', email: 'alice@fixture-person.dev' }
const AGENT = { name: 'Claude Fable 5', email: 'noreply@anthropic.com' }
// RFC 2606 reserved domain: attributable to nobody — must land in `unknown`, never `person`.
const PLACEHOLDER = { name: 'Smoke User', email: 'smoke@example.invalid' }

let dir // fixture repo root
let commit1 // sha of the first (person-authored) commit
const savedEnv = {}

async function run(cmd, args, cwd, extraEnv = {}) {
  await execFileAsync(cmd, args, { cwd, env: { ...process.env, ...extraEnv } })
}

async function commitAll(message, identity) {
  await run('git', ['add', '-A'], dir)
  await run('git', ['commit', '-q', '--no-verify', '-m', message], dir, {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
    GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
    GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z'
  })
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'count-lines-fixture-'))

  // Hermetic git: the counter's own git subprocesses inherit process.env, so pointing the
  // global/system config at files that do not exist keeps a developer's blame/hook/eol config
  // from changing what this test measures. Restored in afterAll.
  for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']) {
    savedEnv[key] = process.env[key]
    process.env[key] = path.join(dir, 'no-such-gitconfig')
  }

  await run('git', ['init', '-q'], dir)
  // The fixture writes LF bytes and must commit LF bytes, whatever this clone's autocrlf is.
  await run('git', ['config', 'core.autocrlf', 'false'], dir)

  await mkdir(path.join(dir, 'src'), { recursive: true })
  await writeFile(path.join(dir, 'src', 'app.ts'), APP_TS, 'utf8')
  await writeFile(path.join(dir, 'src', 'style.css'), STYLE_CSS, 'utf8')
  await writeFile(path.join(dir, 'package-lock.json'), LOCKFILE, 'utf8')
  // Unrecognized extension: must be listed as uncounted, never guessed at as text.
  await writeFile(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
  await commitAll('add fixture source, styles and lockfile', PERSON)
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: dir, env: process.env })
  commit1 = stdout.trim()

  await writeFile(path.join(dir, 'src', 'app.test.ts'), APP_TEST_TS, 'utf8')
  await commitAll('add fixture tests', AGENT)

  await writeFile(path.join(dir, 'notes.md'), NOTES_MD, 'utf8')
  await writeFile(path.join(dir, 'empty.md'), '', 'utf8')
  await commitAll('add fixture notes', PLACEHOLDER)
}, 120_000)

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('count-lines.mjs over a fixture repository', () => {
  it('breaks the project down by bucket, with total AND non-blank lines', async () => {
    const data = await computeLineCounts({ cwd: dir })
    expect(data.buckets.source).toEqual({ total: 5, nonBlank: 4, files: 1 })
    expect(data.buckets.tests).toEqual({ total: 3, nonBlank: 2, files: 1 })
    expect(data.buckets.styles).toEqual({ total: 3, nonBlank: 3, files: 1 })
    // notes.md (2 lines) + empty.md (0 lines — an empty file is 0, not 1).
    expect(data.buckets.docs).toEqual({ total: 2, nonBlank: 2, files: 2 })
    expect(data.buckets.config).toEqual({ total: 0, nonBlank: 0, files: 0 })
    expect(data.projectTotal).toEqual({ total: 13, nonBlank: 11, files: 5 })
  })

  it('splits per language too', async () => {
    const data = await computeLineCounts({ cwd: dir })
    const byLang = Object.fromEntries(data.byLanguage.map((l) => [l.language, l]))
    expect(byLang.TypeScript).toMatchObject({ total: 8, nonBlank: 6, files: 2 })
    expect(byLang.CSS).toMatchObject({ total: 3, nonBlank: 3, files: 1 })
    expect(byLang.Markdown).toMatchObject({ total: 2, nonBlank: 2, files: 2 })
  })

  it('states exclusions — generated files are named with a reason, never silently dropped', async () => {
    const data = await computeLineCounts({ cwd: dir })
    const lock = data.excluded.find((e) => e.path === 'package-lock.json')
    expect(lock).toBeDefined()
    expect(lock.reason).toMatch(/generated|lockfile/i)
    expect(lock.reason.length).toBeGreaterThan(0)
    // Binary/unrecognized files are listed as uncounted, not folded into a bucket.
    expect(data.uncounted).toContain('logo.png')
    // And the excluded file's lines appear in NO bucket: 13 counted lines already proved above.
  })

  it('reports a grand total alongside the project total', async () => {
    const data = await computeLineCounts({ cwd: dir })
    expect(data.grandTotal).toEqual(data.projectTotal)
  })

  it('attributes surviving lines: agent vs person, with a placeholder identity as unknown', async () => {
    const data = await computeLineCounts({ cwd: dir })
    // person: app.ts (5) + style.css (3); agent: app.test.ts (3); placeholder: notes.md (2).
    expect(data.attribution.personLines).toBe(8)
    expect(data.attribution.agentLines).toBe(3)
    expect(data.attribution.unknownLines).toBe(2)
    expect(data.attribution.agentPercent).toBeCloseTo((3 / 13) * 100, 5)
    // The rule is stated beside the number, so the figure can be checked.
    expect(data.attribution.rule).toMatch(/git blame/i)
    expect(data.attribution.rule).toMatch(/surviv/i)
  })

  it("ITS OWN ARITHMETIC AGREES WITH ITSELF: attribution total === line total (trailing newlines don't split them)", async () => {
    const data = await computeLineCounts({ cwd: dir })
    // git blame reports N lines for a file whose last line ends in a newline; a counter that
    // splits the same file into N+1 disagrees with its own attribution table. The fixture mixes
    // trailing-newline and no-trailing-newline files, so either off-by-one breaks this equality.
    expect(data.attribution.attributedLines).toBe(data.projectTotal.total)
    expect(data.attribution.attributedLines).toBe(13)
  })

  it('agrees with itself at an older ref too', async () => {
    const data = await computeLineCounts({ cwd: dir, ref: commit1 })
    // Only the first commit's files exist at that ref; later files fail `git show <ref>:<path>`
    // and are skipped from BOTH tables, so the equality must hold there as well.
    expect(data.buckets.source).toEqual({ total: 5, nonBlank: 4, files: 1 })
    expect(data.buckets.styles).toEqual({ total: 3, nonBlank: 3, files: 1 })
    expect(data.buckets.tests).toEqual({ total: 0, nonBlank: 0, files: 0 })
    expect(data.buckets.docs).toEqual({ total: 0, nonBlank: 0, files: 0 })
    expect(data.projectTotal).toEqual({ total: 8, nonBlank: 7, files: 2 })
    expect(data.attribution.personLines).toBe(8)
    expect(data.attribution.agentLines).toBe(0)
    expect(data.attribution.attributedLines).toBe(data.projectTotal.total)
  })

  it('fails loudly on a ref that does not resolve — an empty table and "nothing here" are different facts', async () => {
    await expect(computeLineCounts({ cwd: dir, ref: 'no-such-ref' })).rejects.toThrow(/does not resolve/)
  })
})
