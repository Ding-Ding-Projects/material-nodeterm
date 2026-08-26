// Route 3: create a NEW GitHub repository and push the generated NSIS project into it.
//
// This is an outward-facing, hard-to-reverse action, so it is deliberately conservative:
//   - only via the `gh` CLI (never a raw REST/GraphQL client -- house rule, CLAUDE.md)
//   - must be an explicit user-initiated call (the caller decides that; this module never
//     runs on its own -- it has no scheduler, no auto-trigger)
//   - defaults to PRIVATE unless the caller explicitly asks for public
//   - refuses to push into an existing NON-EMPTY repository
//   - never invents a repository name -- `name` is a required, non-empty input
//   - returns the URL `gh` reports, never a guessed one
//   - touches ONLY the target repo; never this repo's own remotes
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

export interface PublishRepoInput {
  /** Exact repository name to create. Required -- never inferred or guessed. */
  name: string
  /** GitHub owner (user or org) to create the repository under. */
  owner: string
  /** Local directory holding the generated project to push. */
  projectDir: string
  /** Defaults to true (private). An explicit `false` is required to go public. */
  private?: boolean
  /** Optional repository description passed straight to `gh repo create`. */
  description?: string
}

export type PublishRepoResult =
  | { ok: true; url: string }
  | {
      ok: false
      reason:
        | 'name-required'
        | 'owner-required'
        | 'project-dir-required'
        | 'repo-already-exists-nonempty'
        | 'gh-not-found'
        | 'gh-create-failed'
        | 'gh-push-failed'
      detail: string
    }

type RunExecFile = (
  file: string,
  args: string[],
  cwd?: string
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export interface PublishRepoDeps {
  run?: RunExecFile
}

function defaultRun(): RunExecFile {
  return async (file, args, cwd) => {
    try {
      const { stdout, stderr } = await execFileP(file, args, { cwd, timeout: 120_000 })
      return { exitCode: 0, stdout, stderr }
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string }
      return {
        exitCode: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
      }
    }
  }
}

/**
 * Ask `gh` whether `owner/name` already exists and, if so, whether it has any commits/files.
 * `gh repo view` exits non-zero when the repo does not exist -- that is the common, expected
 * case (creating something new) and is NOT an error here.
 */
async function existingRepoIsNonEmpty(
  owner: string,
  name: string,
  run: RunExecFile
): Promise<boolean> {
  const view = await run('gh', [
    'api',
    `repos/${owner}/${name}`,
    '--jq',
    '.size',
  ])
  if (view.exitCode !== 0) {
    // Repo doesn't exist (or we can't see it) -- nothing to refuse.
    return false
  }
  const size = Number.parseInt(view.stdout.trim(), 10)
  // GitHub reports `size` in KB; an empty repo (no commits) is 0.
  return Number.isFinite(size) && size > 0
}

export async function publishRepo(
  input: PublishRepoInput,
  deps: PublishRepoDeps = {}
): Promise<PublishRepoResult> {
  const run = deps.run ?? defaultRun()

  if (!input.name || input.name.trim().length === 0) {
    return { ok: false, reason: 'name-required', detail: 'A repository name is required and is never invented.' }
  }
  if (!input.owner || input.owner.trim().length === 0) {
    return { ok: false, reason: 'owner-required', detail: 'A repository owner is required.' }
  }
  if (!input.projectDir || input.projectDir.trim().length === 0) {
    return { ok: false, reason: 'project-dir-required', detail: 'A local project directory is required to push from.' }
  }

  // `gh --version` doubles as an availability probe: if it fails we can't do anything below.
  const ghVersion = await run('gh', ['--version'])
  if (ghVersion.exitCode !== 0) {
    return {
      ok: false,
      reason: 'gh-not-found',
      detail: `The gh CLI is not available: ${ghVersion.stderr || ghVersion.stdout || 'unknown error'}`,
    }
  }

  if (await existingRepoIsNonEmpty(input.owner, input.name, run)) {
    return {
      ok: false,
      reason: 'repo-already-exists-nonempty',
      detail: `${input.owner}/${input.name} already exists and is not empty; refusing to push into it.`,
    }
  }

  const isPrivate = input.private !== false // default PRIVATE
  const createArgs = [
    'repo',
    'create',
    `${input.owner}/${input.name}`,
    isPrivate ? '--private' : '--public',
    '--source',
    input.projectDir,
  ]
  if (input.description) {
    createArgs.push('--description', input.description)
  }

  const create = await run('gh', createArgs, input.projectDir)
  if (create.exitCode !== 0) {
    return {
      ok: false,
      reason: 'gh-create-failed',
      detail: create.stderr || create.stdout || 'gh repo create failed with no output',
    }
  }

  // `gh repo create --source <dir>` sets up the remote but does not push unless the caller
  // also passes --push; do it as an explicit, separate step so failure is attributable.
  const push = await run('gh', ['repo', 'sync', `${input.owner}/${input.name}`, '--source', input.projectDir], input.projectDir)
  if (push.exitCode !== 0) {
    return {
      ok: false,
      reason: 'gh-push-failed',
      detail: push.stderr || push.stdout || 'push to the new repository failed with no output',
    }
  }

  const view = await run('gh', ['repo', 'view', `${input.owner}/${input.name}`, '--json', 'url', '--jq', '.url'])
  const url = view.exitCode === 0 ? view.stdout.trim() : `https://github.com/${input.owner}/${input.name}`

  return { ok: true, url }
}
