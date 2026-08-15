#!/usr/bin/env node

/**
 * Semantic contract for the publishing workflow.
 *
 * This deliberately parses YAML and follows the npm scripts the job invokes. A text needle can
 * stay green when a safety command has moved after publication, lives only in a comment, or calls
 * a package script that quietly gained `vitest`; the normalized workflow below catches those
 * behavioural changes instead.
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import yaml from 'js-yaml'

function hasOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key)
}

function executableLines(run) {
  if (typeof run !== 'string') return []
  return run
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function logicalCommands(run) {
  const commands = []
  let continued = ''
  for (const line of executableLines(run)) {
    if (line.endsWith('\\')) {
      continued += `${line.slice(0, -1).trimEnd()} `
      continue
    }
    commands.push((continued + line).trim())
    continued = ''
  }
  if (continued) commands.push(continued.trim())
  return commands
}

function stepIndex(steps, id) {
  return steps.findIndex((step) => step?.id === id)
}

function conditionUsesDraftResult(step) {
  return typeof step?.if === 'string' && step.if.trim() === "steps.draft.outputs.already_published != 'true'"
}

const FORBIDDEN_RUNNER_COMMANDS = [
  [
    'tests',
    /(?:^|[;&|]\s*|\s)(?:npm\s+(?:run\s+)?test(?::[\w-]+)?(?:\s|$)|(?:npx|npm\s+exec)\s+(?:--\s+)?vitest\b|vitest\s+run\b)/i
  ],
  [
    'type-check',
    /(?:^|[;&|]\s*|\s)(?:npm\s+run\s+typecheck(?::[\w-]+)?(?:\s|$)|(?:npx|npm\s+exec)\s+(?:--\s+)?tsc\b|tsc\s+--noEmit\b)/i
  ],
  [
    'lint',
    /(?:^|[;&|]\s*|\s)(?:npm\s+run\s+lint(?::[\w-]+)?(?:\s|$)|(?:npx|npm\s+exec)\s+(?:--\s+)?eslint\b|eslint\s+)/i
  ]
]

function forbiddenCommands(commands) {
  const found = []
  for (const command of commands) {
    for (const [kind, pattern] of FORBIDDEN_RUNNER_COMMANDS) {
      if (pattern.test(command)) found.push(`${kind}: ${command}`)
    }
  }
  return found
}

function invokedNpmScripts(commands) {
  const names = new Set()
  const addWithLifecycle = (name) => {
    names.add(`pre${name}`)
    names.add(name)
    names.add(`post${name}`)
  }
  let installsDependencies = false
  for (const command of commands) {
    if (/\bnpm\s+(?:ci|install)(?:\s|$)/.test(command)) installsDependencies = true
    for (const match of command.matchAll(/\bnpm\s+run(?:-script)?\s+([\w:-]+)/g)) {
      addWithLifecycle(match[1])
    }
    if (/\bnpm\s+test(?:\s|$)/.test(command)) addWithLifecycle('test')
  }
  if (installsDependencies) {
    for (const lifecycle of [
      'preinstall',
      'install',
      'postinstall',
      'prepublish',
      'preprepare',
      'prepare',
      'postprepare'
    ]) {
      names.add(lifecycle)
    }
  }
  return names
}

function transitivePackageCommands(initial, scripts) {
  const commands = []
  const pending = [...invokedNpmScripts(initial)]
  const seen = new Set()
  while (pending.length) {
    const name = pending.pop()
    if (!name || seen.has(name)) continue
    seen.add(name)
    const body = scripts?.[name]
    if (typeof body !== 'string') continue
    commands.push(body)
    for (const child of invokedNpmScripts([body])) pending.push(child)
  }
  return commands
}

/** Return every contract violation. An empty array is a publishable workflow. */
export function validateReleaseWorkflow(workflow, packageJson) {
  const issues = []
  const trigger = workflow?.on
  const push = trigger?.push
  if (!push || !Array.isArray(push.branches) || push.branches.length !== 1 || push.branches[0] !== '**') {
    issues.push('trigger must cover branch pushes explicitly')
  }
  if (hasOwn(push, 'tags') || hasOwn(push, 'tags-ignore')) {
    issues.push('tag pushes must never trigger publication')
  }
  if (hasOwn(push, 'paths') || hasOwn(push, 'paths-ignore') || hasOwn(push, 'branches-ignore')) {
    issues.push('path filters must not skip branch update pushes')
  }
  if (!hasOwn(trigger, 'workflow_dispatch')) issues.push('manual dispatch trigger is missing')

  const concurrency = workflow?.concurrency
  const concurrencyGroup = concurrency?.group
  if (
    typeof concurrencyGroup !== 'string' ||
    !concurrencyGroup.includes('${{ github.workflow }}') ||
    !concurrencyGroup.includes('${{ github.run_number }}') ||
    concurrencyGroup.includes('${{ github.run_attempt }}')
  ) {
    issues.push('concurrency must isolate attempts by workflow and run number')
  }
  if (concurrency?.['cancel-in-progress'] !== false) {
    issues.push('publishing attempts must never cancel in progress')
  }
  if (workflow?.permissions?.contents !== 'write') {
    issues.push('contents: write is required to stage and publish a release')
  }

  const jobs = workflow?.jobs ?? {}
  if (Object.keys(jobs).length !== 1 || !jobs.release) {
    issues.push('release workflow must have exactly one release job')
  }
  const job = jobs.release ?? {}
  if (job['runs-on'] !== 'windows-latest') issues.push('release job must run on windows-latest')
  if (hasOwn(job, 'needs')) issues.push('release publication must not depend on a validation job')
  if (typeof job.if !== 'string' || job.if.trim() !== "github.event_name != 'push' || github.event.deleted != true") {
    issues.push('branch-deletion pushes must be skipped before the release job starts')
  }
  if (job?.env?.GH_TOKEN != null || job?.env?.GITHUB_TOKEN != null) {
    issues.push('write-capable GitHub tokens must never be job-wide')
  }

  const steps = Array.isArray(job.steps) ? job.steps : []
  const stepById = (id) => steps.find((step) => step?.id === id)
  const criticalShells = new Map([
    ['assets', 'bash'],
    ['unsigned', 'pwsh'],
    ['draft', 'bash'],
    ['upload', 'bash'],
    ['notes', 'bash'],
    ['publish', 'bash']
  ])
  for (const id of ['package', ...criticalShells.keys()]) {
    const step = stepById(id)
    if (step?.['continue-on-error'] != null && step['continue-on-error'] !== false) {
      issues.push(`safety step ${id} must fail the job on error`)
    }
    const expectedShell = criticalShells.get(id)
    if (expectedShell && step?.shell !== expectedShell) {
      issues.push(`safety step ${id} must use GitHub's fail-fast ${expectedShell} shell`)
    }
    if (
      expectedShell === 'bash' &&
      logicalCommands(step?.run).some((command) => /(?:^|[;&|]\s*)set\s+\+(?:e\b|o\s+errexit\b)/.test(command))
    ) {
      issues.push(`safety step ${id} must not disable shell fail-fast behavior`)
    }
  }
  const tokenSteps = new Map([
    ['timing', '${{ github.token }}'],
    ['draft', '${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}'],
    ['upload', '${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}'],
    ['publish', '${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}']
  ])
  for (const step of steps) {
    const token = step?.env?.GH_TOKEN ?? step?.env?.GITHUB_TOKEN
    if (token == null) continue
    if (!tokenSteps.has(step?.id) || token !== tokenSteps.get(step.id)) {
      issues.push(`GitHub token has unsafe scope or source on step ${step?.id ?? step?.name ?? '<unknown>'}`)
    }
  }
  for (const [id, token] of tokenSteps) {
    if (stepById(id)?.env?.GH_TOKEN !== token) issues.push(`step ${id} must receive only its approved GitHub token`)
  }
  const releaseDataflow = new Map([
    ['draft', {
      RELEASE_TAG: '${{ steps.tag.outputs.tag }}',
      RELEASE_ASSET_MANIFEST: '${{ steps.assets.outputs.manifest }}'
    }],
    ['upload', {
      RELEASE_TAG: '${{ steps.tag.outputs.tag }}',
      ASSET_PATHS: '${{ steps.assets.outputs.paths }}',
      RELEASE_ASSET_MANIFEST: '${{ steps.assets.outputs.manifest }}'
    }],
    ['notes', {
      RELEASE_TAG: '${{ steps.tag.outputs.tag }}',
      WORKFLOW_STARTED_AT: '${{ steps.timing.outputs.started_at }}',
      RELEASE_ASSET_PATHS: '${{ steps.assets.outputs.paths }}'
    }],
    ['publish', {
      RELEASE_TAG: '${{ steps.tag.outputs.tag }}',
      RELEASE_ASSET_MANIFEST: '${{ steps.assets.outputs.manifest }}'
    }]
  ])
  for (const [id, expected] of releaseDataflow) {
    const env = stepById(id)?.env ?? {}
    for (const [name, value] of Object.entries(expected)) {
      if (env[name] !== value) issues.push(`step ${id} must bind ${name} to the validated release dataflow`)
    }
  }
  const allCommands = steps.flatMap((step) => logicalCommands(step?.run))
  const forbidden = [
    ...forbiddenCommands(allCommands),
    ...forbiddenCommands(transitivePackageCommands(allCommands, packageJson?.scripts))
  ]
  if (forbidden.length) {
    issues.push(`runner executes forbidden validation commands: ${forbidden.join(' | ')}`)
  }

  const checkoutAt = steps.findIndex((step) => String(step?.uses ?? '').startsWith('actions/checkout@'))
  if (steps[checkoutAt]?.with?.['persist-credentials'] !== false) {
    issues.push('checkout must not persist the write token for build subprocesses')
  }
  const tagGuardAt = steps.findIndex(
    (step) =>
      typeof step?.if === 'string' &&
      /github\.ref_type\s*==\s*'tag'/.test(step.if) &&
      logicalCommands(step.run).some((command) => /^exit\s+1$/.test(command))
  )
  if (tagGuardAt < 0 || checkoutAt < 0 || tagGuardAt >= checkoutAt) {
    issues.push('a failing tag-ref guard must run before checkout')
  }

  const tagAt = stepIndex(steps, 'tag')
  const tagCommands = logicalCommands(steps[tagAt]?.run).join('\n')
  if (!tagCommands.includes('GITHUB_RUN_NUMBER') || tagCommands.includes('GITHUB_RUN_ATTEMPT')) {
    issues.push('tag must be unique per run and stable across retry attempts')
  }
  if (!/>>\s*"?\$GITHUB_OUTPUT"?/.test(tagCommands)) {
    issues.push('computed release tag must be exported as a step output')
  }

  const packageAt = stepIndex(steps, 'package')
  const packageStep = steps[packageAt]
  const packageCommands = logicalCommands(packageStep?.run)
  const packageCommand = packageCommands.find((command) => /\bnpx\s+electron-builder\b/.test(command))
  if (
    !packageCommand ||
    !/--win\s+squirrel(?:\s|$)/.test(packageCommand) ||
    !/(?:^|\s)--x64(?:\s|$)/.test(packageCommand) ||
    !/--publish\s+never(?:\s|$)/.test(packageCommand)
  ) {
    issues.push('package step must explicitly build Squirrel x64 with publishing disabled')
  }
  if (packageStep?.env?.CSC_IDENTITY_AUTO_DISCOVERY !== 'false') {
    issues.push('package step must disable signing identity auto-discovery')
  }
  if (
    packageJson?.build?.win?.signExecutable !== false ||
    packageJson?.build?.win?.signAndEditExecutable === false ||
    packageJson?.build?.forceCodeSigning !== false
  ) {
    issues.push('electron-builder must disable signing while preserving Windows resource editing')
  }

  const assetsAt = stepIndex(steps, 'assets')
  const assetsCommands = logicalCommands(steps[assetsAt]?.run)
  if (
    !assetsCommands.some((command) =>
      /^node\s+scripts\/release-assets\.mjs\s+collect\s+dist\/squirrel-windows$/.test(command)
    )
  ) {
    issues.push('asset step must run the executable Squirrel inventory contract')
  }

  const unsignedAt = stepIndex(steps, 'unsigned')
  const unsignedCommands = logicalCommands(steps[unsignedAt]?.run)
  if (
    steps[unsignedAt]?.env?.SETUP_PATH !== '${{ steps.assets.outputs.setup }}' ||
    !unsignedCommands.some((command) => /^\$sig\s*=\s*Get-AuthenticodeSignature\s+-FilePath\s+\$env:SETUP_PATH$/.test(command)) ||
    !unsignedCommands.includes('node scripts/release-assets.mjs assert-unsigned "$($sig.Status)"') ||
    !unsignedCommands.includes('if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }')
  ) {
    issues.push('signature step must behavior-check Authenticode status for the collected Setup')
  }

  const draftAt = stepIndex(steps, 'draft')
  const uploadAt = stepIndex(steps, 'upload')
  const notesAt = stepIndex(steps, 'notes')
  const publishAt = stepIndex(steps, 'publish')
  const ordered = [packageAt, assetsAt, unsignedAt, draftAt, uploadAt, notesAt, publishAt]
  if (ordered.some((index) => index < 0) || ordered.some((index, i) => i > 0 && index <= ordered[i - 1])) {
    issues.push('package, local verification, draft, upload, notes and publication must stay ordered')
  }

  const draftCommands = logicalCommands(steps[draftAt]?.run)
  const createCommands = allCommands.filter((command) => /\bgh\s+release\s+create\b/.test(command))
  const createCommand = createCommands[0] ?? ''
  if (
    createCommands.length !== 1 ||
    !/\bgh\s+release\s+create\s+"\$RELEASE_TAG"(?:\s|$)/.test(createCommand) ||
    !/(?:^|\s)--draft(?:\s|$)/.test(createCommand) ||
    createCommand.includes('--draft=false') ||
    !/--target\s+"\$GITHUB_SHA"/.test(createCommand)
  ) {
    issues.push('exactly one release creation must target GITHUB_SHA as a private draft')
  }
  const draftEdits = draftCommands.filter((command) => /\bgh\s+release\s+edit\b/.test(command))
  if (
    !draftEdits.length ||
    draftEdits.some(
      (command) =>
        !/(?:^|\s)--draft(?:\s|$)/.test(command) || command.includes('--draft=false')
    )
  ) {
    issues.push('retry preparation may edit only a draft release')
  }
  const viewExistingAt = draftCommands.findIndex((command) =>
    /^gh release view "\$RELEASE_TAG" .*--json isDraft,assets,tagName,targetCommitish > "\$RUNNER_TEMP\/existing-release\.json"$/.test(command)
  )
  const readExistingTagAt = draftCommands.findIndex((command) =>
    /^tag_sha=\$\(gh api "repos\/\$\{GITHUB_REPOSITORY\}\/git\/ref\/tags\/\$\{RELEASE_TAG\}" --jq \.object\.sha\)$/.test(command)
  )
  const assertExistingTagAt = draftCommands.findIndex((command) =>
    /^node scripts\/release-assets\.mjs assert-target "\$tag_sha" "\$GITHUB_SHA"$/.test(command)
  )
  const verifyExistingAt = draftCommands.findIndex((command) =>
    /^node scripts\/release-assets\.mjs verify "\$RUNNER_TEMP\/existing-release\.json" published exact$/.test(command)
  )
  const reuseExistingAt = draftCommands.findIndex((command) =>
    /already_published=true.*GITHUB_OUTPUT/.test(command)
  )
  const reuseExitAt = draftCommands.findIndex((command, index) => index > reuseExistingAt && command === 'exit 0')
  if (
    !(
      viewExistingAt >= 0 &&
      readExistingTagAt > viewExistingAt &&
      assertExistingTagAt > readExistingTagAt &&
      verifyExistingAt > assertExistingTagAt &&
      reuseExistingAt > verifyExistingAt &&
      reuseExitAt > reuseExistingAt
    )
  ) {
    issues.push('an already-published retry must validate and reuse the complete release')
  }

  const releaseCommands = allCommands.filter((command) => /\bgh\s+release\s+(?:view|create|edit|upload|delete-asset)\b/.test(command))
  if (releaseCommands.some((command) => !command.includes('"$RELEASE_TAG"'))) {
    issues.push('every release API command must operate on this run\'s RELEASE_TAG')
  }

  const uploadStep = steps[uploadAt]
  const uploadCommands = logicalCommands(uploadStep?.run)
  const uploadCommand = uploadCommands.find((command) => /\bgh\s+release\s+upload\b/.test(command))
  if (!conditionUsesDraftResult(uploadStep)) issues.push('asset upload must skip an already-published retry')
  if (!uploadCommands.some((command) => /\bgh\s+release\s+delete-asset\b/.test(command))) {
    issues.push('draft retry must prune stale assets before exact inventory verification')
  }
  if (
    !uploadCommand ||
    !/^gh release upload "\$RELEASE_TAG" "\$\{assets\[@\]\}" --clobber --repo "\$GITHUB_REPOSITORY"$/.test(uploadCommand)
  ) {
    issues.push('draft upload must fail loudly and be retry-safe with --clobber')
  }

  if (!conditionUsesDraftResult(steps[notesAt]) || !conditionUsesDraftResult(steps[publishAt])) {
    issues.push('notes and publish steps must skip an already-published retry')
  }
  const publishCommands = logicalCommands(steps[publishAt]?.run)
  const viewDraftAt = publishCommands.findIndex((command) =>
    /^gh release view "\$RELEASE_TAG" .*--json isDraft,assets,tagName,targetCommitish > "\$RUNNER_TEMP\/draft-release\.json"$/.test(command)
  )
  const verifyDraftAt = publishCommands.findIndex((command) =>
    /^node scripts\/release-assets\.mjs verify "\$RUNNER_TEMP\/draft-release\.json" draft exact$/.test(command)
  )
  const prepublishTagProbeAt = publishCommands.findIndex((command) =>
    /^if tag_sha=\$\(gh api "repos\/\$\{GITHUB_REPOSITORY\}\/git\/ref\/tags\/\$\{RELEASE_TAG\}" --jq \.object\.sha 2>"\$RUNNER_TEMP\/tag-ref-error\.txt"\); then$/.test(command)
  )
  const prepublishTagAssertAt = publishCommands.findIndex(
    (command, index) =>
      index > prepublishTagProbeAt &&
      command === 'node scripts/release-assets.mjs assert-target "$tag_sha" "$GITHUB_SHA"'
  )
  const confirmedMissingTagAt = publishCommands.findIndex(
    (command, index) =>
      index > prepublishTagAssertAt &&
      /^elif grep -Eq .*HTTP 404.*tag-ref-error\.txt"; then$/.test(command)
  )
  const failedTagReadExitAt = publishCommands.findIndex(
    (command, index) => index > confirmedMissingTagAt && command === 'exit 1'
  )
  const transitionAt = publishCommands.findIndex(
    (command) => command === 'gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false'
  )
  const viewPublishedAt = publishCommands.findIndex((command) =>
    /^gh release view "\$RELEASE_TAG" .*--json isDraft,assets,tagName,targetCommitish > "\$RUNNER_TEMP\/published-release\.json"$/.test(command)
  )
  const readPublishedTagAt = publishCommands.findIndex((command) =>
    /^tag_sha=\$\(gh api "repos\/\$\{GITHUB_REPOSITORY\}\/git\/ref\/tags\/\$\{RELEASE_TAG\}" --jq \.object\.sha\)$/.test(command)
  )
  const assertPublishedTagAt = publishCommands.findIndex(
    (command, index) =>
      index > readPublishedTagAt &&
      /^node scripts\/release-assets\.mjs assert-target "\$tag_sha" "\$GITHUB_SHA"$/.test(command)
  )
  const verifyPublishedAt = publishCommands.findIndex((command) =>
    /^node scripts\/release-assets\.mjs verify "\$RUNNER_TEMP\/published-release\.json" published exact$/.test(command)
  )
  if (
    !(
      viewDraftAt >= 0 &&
      verifyDraftAt > viewDraftAt &&
      prepublishTagProbeAt > verifyDraftAt &&
      prepublishTagAssertAt > prepublishTagProbeAt &&
      confirmedMissingTagAt > prepublishTagAssertAt &&
      failedTagReadExitAt > confirmedMissingTagAt &&
      transitionAt > failedTagReadExitAt &&
      readPublishedTagAt > transitionAt &&
      assertPublishedTagAt > readPublishedTagAt &&
      viewPublishedAt > assertPublishedTagAt &&
      verifyPublishedAt > viewPublishedAt
    )
  ) {
    issues.push('exact remote draft verification must precede the sole publish transition and post-check')
  }
  const allTransitions = allCommands.filter(
    (command) => /\bgh\s+release\s+edit\b/.test(command) && command.includes('--draft=false')
  )
  if (allTransitions.length !== 1) issues.push('workflow must contain exactly one public transition')

  return issues
}

export function checkReleaseWorkflowFile(workflowPath, packagePath) {
  const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8'))
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  return validateReleaseWorkflow(workflow, packageJson)
}

function runCli() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const workflowPath = path.resolve(process.argv[2] ?? path.join(repoRoot, '.github/workflows/release.yml'))
  const packagePath = path.resolve(process.argv[3] ?? path.join(repoRoot, 'package.json'))
  const issues = checkReleaseWorkflowFile(workflowPath, packagePath)
  if (issues.length) {
    console.error(`Release workflow contract failed (${issues.length}):`)
    for (const issue of issues) console.error(`- ${issue}`)
    process.exitCode = 1
    return
  }
  console.log('Release workflow contract passed.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli()
