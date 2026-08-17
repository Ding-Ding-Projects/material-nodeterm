import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '../..')
const CHECKER = path.join(ROOT, 'scripts', 'check-release-workflow.mjs')
const WORKFLOW = readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n')
const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  version: string
  scripts: Record<string, string>
  build: {
    forceCodeSigning: boolean
    win: { forceCodeSigning: boolean; signExecutable: boolean; signAndEditExecutable?: boolean }
  }
}
const tempDirs: string[] = []

function replaceOnce(source: string, before: string, after: string): string {
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`mutation target not found: ${before}`)
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`mutation target was not unique: ${before}`)
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

function check(workflow = WORKFLOW, packageJson: unknown = PACKAGE) {
  const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-release-contract-'))
  tempDirs.push(dir)
  const workflowPath = path.join(dir, 'release.yml')
  const packagePath = path.join(dir, 'package.json')
  writeFileSync(workflowPath, workflow)
  writeFileSync(packagePath, JSON.stringify(packageJson))
  const result = spawnSync(process.execPath, [CHECKER, workflowPath, packagePath], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('release workflow semantic contract', () => {
  it('accepts the real workflow as one draft-staged complete Squirrel publication', () => {
    expect(check()).toMatchObject({ status: 0 })
  })

  it('rejects every automatic or additional publication trigger', () => {
    const branchPush = check(
      replaceOnce(WORKFLOW, 'on:\n  workflow_dispatch:', "on:\n  push:\n    branches: ['main']\n  workflow_dispatch:"),
    )
    expect(branchPush.status).toBe(1)
    expect(branchPush.output).toMatch(/workflow_dispatch-only/i)

    const tagPush = check(
      replaceOnce(WORKFLOW, 'on:\n  workflow_dispatch:', "on:\n  push:\n    tags: ['v*']\n  workflow_dispatch:"),
    )
    expect(tagPush.status).toBe(1)
    expect(tagPush.output).toMatch(/workflow_dispatch-only/i)

    const scheduled = check(
      replaceOnce(
        WORKFLOW,
        '  workflow_dispatch:\n\nconcurrency:',
        "  workflow_dispatch:\n  schedule:\n    - cron: '0 0 * * *'\n\nconcurrency:",
      ),
    )
    expect(scheduled.status).toBe(1)
    expect(scheduled.output).toMatch(/workflow_dispatch-only/i)

    const missingManual = check(replaceOnce(WORKFLOW, 'on:\n  workflow_dispatch:', 'on: {}'))
    expect(missingManual.status).toBe(1)
    expect(missingManual.output).toMatch(/workflow_dispatch-only/i)
  })

  it('rejects a non-main guard that is weakened, non-failing, or moved after checkout', () => {
    const wrongBranch = check(
      replaceOnce(
        WORKFLOW,
        "if: github.ref != 'refs/heads/main' || github.ref_type != 'branch'",
        "if: github.ref != 'refs/heads/release' || github.ref_type != 'branch'",
      ),
    )
    expect(wrongBranch.status).toBe(1)
    expect(wrongBranch.output).toMatch(/non-main ref guard/i)

    const conjunction = check(
      replaceOnce(
        WORKFLOW,
        "if: github.ref != 'refs/heads/main' || github.ref_type != 'branch'",
        "if: github.ref != 'refs/heads/main' && github.ref_type != 'branch'",
      ),
    )
    expect(conjunction.status).toBe(1)
    expect(conjunction.output).toMatch(/non-main ref guard/i)

    const noFailure = check(
      replaceOnce(WORKFLOW, '          exit 1\n\n      - name: Checkout', '          exit 0\n\n      - name: Checkout'),
    )
    expect(noFailure.status).toBe(1)
    expect(noFailure.output).toMatch(/non-main ref guard/i)

    const guardStep = [
      '      - name: Refuse non-main release ref',
      '        id: guard',
      "        if: github.ref != 'refs/heads/main' || github.ref_type != 'branch'",
      '        shell: bash',
      '        run: |',
      '          echo "::error::Stable releases must be dispatched from the main branch (got ref_type=${GITHUB_REF_TYPE}, ref=${GITHUB_REF})."',
      '          exit 1',
      '',
    ].join('\n')
    const withoutGuard = replaceOnce(WORKFLOW, guardStep, '')
    const movedAfterCheckout = check(
      replaceOnce(
        withoutGuard,
        '      - name: Record workflow start time',
        `${guardStep}      - name: Record workflow start time`,
      ),
    )
    expect(movedAfterCheckout.status).toBe(1)
    expect(movedAfterCheckout.output).toMatch(/before checkout/i)
  })

  it('serializes releases per workflow and ref without cancelling a transaction', () => {
    const cancelling = check(replaceOnce(WORKFLOW, 'cancel-in-progress: false', 'cancel-in-progress: true'))
    expect(cancelling.status).toBe(1)
    expect(cancelling.output).toMatch(/never cancel/i)

    const isolatedRun = check(
      replaceOnce(
        WORKFLOW,
        'group: release-${{ github.workflow }}-${{ github.ref }}',
        'group: release-${{ github.workflow }}-${{ github.run_number }}',
      ),
    )
    expect(isolatedRun.status).toBe(1)
    expect(isolatedRun.output).toMatch(/serialize.*workflow and ref/i)

    const attemptGroup = check(
      replaceOnce(
        WORKFLOW,
        'group: release-${{ github.workflow }}-${{ github.ref }}',
        'group: release-${{ github.workflow }}-${{ github.ref }}-${{ github.run_attempt }}',
      ),
    )
    expect(attemptGroup.status).toBe(1)
    expect(attemptGroup.output).toMatch(/serialize.*workflow and ref/i)
  })

  it('derives one exact stable tag from package.version and rejects synthetic channels', () => {
    const runSuffix = check(
      replaceOnce(WORKFLOW, '          tag="v${version}"', '          tag="v${version}-ci.${GITHUB_RUN_NUMBER}"'),
    )
    expect(runSuffix.status).toBe(1)
    expect(runSuffix.output).toMatch(/exact stable.*package\.version/i)

    const hardCoded = check(replaceOnce(WORKFLOW, '          tag="v${version}"', '          tag="v9.9.9"'))
    expect(hardCoded.status).toBe(1)
    expect(hardCoded.output).toMatch(/exact stable.*package\.version/i)

    const noStableGuard = check(
      replaceOnce(
        WORKFLOW,
        '          if [[ ! "$version" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]]; then',
        '          if [[ -z "$version" ]]; then',
      ),
    )
    expect(noStableGuard.status).toBe(1)
    expect(noStableGuard.output).toMatch(/fail-closed SemVer guard/i)

    const prereleasePackage = check(WORKFLOW, {
      ...PACKAGE,
      version: `${PACKAGE.version}-beta.1`,
    })
    expect(prereleasePackage.status).toBe(1)
    expect(prereleasePackage.output).toMatch(/package\.version must be a stable/i)
  })

  it('proves the checked-out commit and stable version advancement before building', () => {
    const uncheckedHead = check(
      replaceOnce(
        WORKFLOW,
        '          node scripts/release-assets.mjs assert-target "$checked_out" "$GITHUB_SHA"',
        '          echo "unchecked checkout: $checked_out"',
      ),
    )
    expect(uncheckedHead.status).toBe(1)
    expect(uncheckedHead.output).toMatch(/HEAD.*GITHUB_SHA/i)

    const noInventory = check(
      replaceOnce(
        WORKFLOW,
        '          node scripts/release-assets.mjs assert-version "$RELEASE_VERSION" "$RUNNER_TEMP/tags-before-build.json" "$RUNNER_TEMP/releases-before-build.json" "$GITHUB_SHA"',
        '          echo "stable version inventory ignored"',
      ),
    )
    expect(noInventory.status).toBe(1)
    expect(noInventory.output).toMatch(/version advancement.*before build/i)

    const missingVersionOutput = check(
      replaceOnce(
        WORKFLOW,
        '          echo "version=$version" >> "$GITHUB_OUTPUT"',
        '          echo "version output omitted"',
      ),
    )
    expect(missingVersionOutput.status).toBe(1)
    expect(missingVersionOutput.output).toMatch(/stable version.*step outputs/i)
  })

  it('rejects a package that bypasses the guarded unsigned Squirrel wrapper', () => {
    const wrongTarget = check(
      replaceOnce(
        WORKFLOW,
        'run: npm run dist:win',
        'run: npm run dist:linux',
      ),
    )
    expect(wrongTarget.status).toBe(1)
    expect(wrongTarget.output).toMatch(/guarded Windows installer wrapper/i)

    const bypassedWrapper = check(WORKFLOW, {
      ...PACKAGE,
      scripts: { ...PACKAGE.scripts, 'dist:win': 'electron-builder --win squirrel --x64 --publish never' },
    })
    expect(bypassedWrapper.status).toBe(1)
    expect(bypassedWrapper.output).toMatch(/guarded Windows installer wrapper/i)

    const missingIconProof = check(
      replaceOnce(
        WORKFLOW,
        'node scripts/windows-installer.mjs assert-package dist/squirrel-windows dist/windows-icon-contract.json',
        'echo "packaged icon proof removed"',
      ),
    )
    expect(missingIconProof.status).toBe(1)
    expect(missingIconProof.output).toMatch(/Setup, app, stub, nuspec, and immutable icon metadata/i)

    const weakSignature = check(
      replaceOnce(
        WORKFLOW,
        'node scripts/release-assets.mjs assert-unsigned "$($sig.Status)"',
        'Write-Host "signature decision removed"',
      ),
    )
    expect(weakSignature.status).toBe(1)
    expect(weakSignature.output).toMatch(/behavior-check Authenticode/i)

    const wrongSignatureTarget = check(
      replaceOnce(WORKFLOW, 'SETUP_PATH: ${{ steps.assets.outputs.setup }}', 'SETUP_PATH: package.json'),
    )
    expect(wrongSignatureTarget.status).toBe(1)
    expect(wrongSignatureTarget.output).toMatch(/behavior-check Authenticode/i)

    const signingEnabled = check(WORKFLOW, {
      ...PACKAGE,
      build: {
        ...PACKAGE.build,
        win: { ...PACKAGE.build.win, signExecutable: true },
      },
    })
    expect(signingEnabled.status).toBe(1)
    expect(signingEnabled.output).toMatch(/disable signing.*preserving/i)

    const windowsForceSigningEnabled = check(WORKFLOW, {
      ...PACKAGE,
      build: {
        ...PACKAGE.build,
        win: { ...PACKAGE.build.win, forceCodeSigning: true },
      },
    })
    expect(windowsForceSigningEnabled.status).toBe(1)
    expect(windowsForceSigningEnabled.output).toMatch(/disable signing.*preserving/i)

    const resourceEditingDisabled = check(WORKFLOW, {
      ...PACKAGE,
      build: {
        ...PACKAGE.build,
        win: { ...PACKAGE.build.win, signAndEditExecutable: false },
      },
    })
    expect(resourceEditingDisabled.status).toBe(1)
    expect(resourceEditingDisabled.output).toMatch(/preserving Windows resource editing/i)
  })

  it('keeps write credentials out of checkout and build subprocesses', () => {
    const persisted = check(replaceOnce(WORKFLOW, 'persist-credentials: false', 'persist-credentials: true'))
    expect(persisted.status).toBe(1)
    expect(persisted.output).toMatch(/must not persist/i)

    const jobWide = check(
      replaceOnce(
        WORKFLOW,
        '    runs-on: windows-latest',
        '    runs-on: windows-latest\n    env:\n      GH_TOKEN: ${{ github.token }}',
      ),
    )
    expect(jobWide.status).toBe(1)
    expect(jobWide.output).toMatch(/never be job-wide/i)
  })

  it('keeps every publication safety step fail-fast', () => {
    for (const id of ['guard', 'source', 'tag', 'version']) {
      const shellBoundary =
        id === 'guard'
          ? `        id: ${id}\n        if: github.ref != 'refs/heads/main' || github.ref_type != 'branch'\n        shell: bash`
          : `        id: ${id}\n        shell: bash`
      const ignoredCriticalFailure = check(
        replaceOnce(
          WORKFLOW,
          shellBoundary,
          shellBoundary.replace('        shell: bash', '        continue-on-error: true\n        shell: bash'),
        ),
      )
      expect(ignoredCriticalFailure.status, id).toBe(1)
      expect(ignoredCriticalFailure.output).toMatch(new RegExp(`safety step ${id}.*fail the job`, 'i'))
    }

    const ignoredFailure = check(
      replaceOnce(
        WORKFLOW,
        '        id: unsigned\n        shell: pwsh',
        '        id: unsigned\n        continue-on-error: true\n        shell: pwsh',
      ),
    )
    expect(ignoredFailure.status).toBe(1)
    expect(ignoredFailure.output).toMatch(/must fail the job/i)

    const noErrexit = check(
      replaceOnce(
        WORKFLOW,
        "        id: publish\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash",
        "        id: publish\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash {0}",
      ),
    )
    expect(noErrexit.status).toBe(1)
    expect(noErrexit.output).toMatch(/fail-fast bash/i)

    const disabledErrexit = check(
      replaceOnce(
        WORKFLOW,
        '        run: |\n          # Keep the notes edit explicitly draft.',
        '        run: |\n          set +e\n          # Keep the notes edit explicitly draft.',
      ),
    )
    expect(disabledErrexit.status).toBe(1)
    expect(disabledErrexit.output).toMatch(/must not disable.*fail-fast/i)
  })

  it('rejects a public release creation before assets exist', () => {
    const failedReadAsAbsence = check(
      replaceOnce(
        WORKFLOW,
        '          elif grep -Eq \'\\(HTTP 404\\)$\' "$RUNNER_TEMP/release-probe-error.txt"; then',
        '          else',
      ),
    )
    expect(failedReadAsAbsence.status).toBe(1)
    expect(failedReadAsAbsence.output).toMatch(/confirmed 404.*failed reads/i)

    const mutated = replaceOnce(
      WORKFLOW,
      '            gh release create "$RELEASE_TAG" \\\n              --repo "$GITHUB_REPOSITORY" \\\n              --draft \\\n',
      '            gh release create "$RELEASE_TAG" \\\n              --repo "$GITHUB_REPOSITORY" \\\n',
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/creation.*private draft/i)

    const duplicate = check(
      replaceOnce(
        WORKFLOW,
        '          echo "already_published=false" >> "$GITHUB_OUTPUT"',
        '          gh release create "$RELEASE_TAG-copy" --repo "$GITHUB_REPOSITORY" --draft --notes copy\n          echo "already_published=false" >> "$GITHUB_OUTPUT"',
      ),
    )
    expect(duplicate.status).toBe(1)
    expect(duplicate.output).toMatch(/exactly one release creation/i)

    const publicDespiteDraftFlag = check(
      replaceOnce(
        WORKFLOW,
        '            gh release create "$RELEASE_TAG" \\\n              --repo "$GITHUB_REPOSITORY" \\\n              --draft \\\n',
        '            gh release create "$RELEASE_TAG" \\\n              --repo "$GITHUB_REPOSITORY" \\\n              --draft=false \\\n',
      ),
    )
    expect(publicDespiteDraftFlag.status).toBe(1)
    expect(publicDespiteDraftFlag.output).toMatch(/private draft/i)
  })

  it('rejects reusing a published release before its complete inventory is validated', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      '              node scripts/release-assets.mjs verify "$RUNNER_TEMP/existing-latest-release.json" published exact\n              echo "already_published=true" >> "$GITHUB_OUTPUT"',
      '              echo "already_published=true" >> "$GITHUB_OUTPUT"\n              node scripts/release-assets.mjs verify "$RUNNER_TEMP/existing-latest-release.json" published exact',
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/published retry.*prove/i)

    const noExit = check(
      replaceOnce(
        WORKFLOW,
        '              echo "already_published=true" >> "$GITHUB_OUTPUT"\n              exit 0',
        '              echo "already_published=true" >> "$GITHUB_OUTPUT"',
      ),
    )
    expect(noExit.status).toBe(1)
    expect(noExit.output).toMatch(/published retry.*reuse/i)
  })

  it('rejects publication before exact remote draft verification', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      '          node scripts/release-assets.mjs verify "$RUNNER_TEMP/draft-release.json" draft exact',
      '          echo "verification accidentally removed"',
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/exact draft.*publish transition/i)

    const suppressed = check(
      replaceOnce(
        WORKFLOW,
        'node scripts/release-assets.mjs verify "$RUNNER_TEMP/draft-release.json" draft exact',
        'node scripts/release-assets.mjs verify "$RUNNER_TEMP/draft-release.json" draft exact || true',
      ),
    )
    expect(suppressed.status).toBe(1)
    expect(suppressed.output).toMatch(/exact draft.*publish transition/i)

    const uncheckedExistingTag = check(
      replaceOnce(
        WORKFLOW,
        '          if tag_sha=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${RELEASE_TAG}" --jq .object.sha 2>"$RUNNER_TEMP/tag-ref-error.txt"); then\n            node scripts/release-assets.mjs assert-target "$tag_sha" "$GITHUB_SHA"',
        '          if tag_sha=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${RELEASE_TAG}" --jq .object.sha 2>"$RUNNER_TEMP/tag-ref-error.txt"); then\n            echo "existing tag target ignored: $tag_sha"',
      ),
    )
    expect(uncheckedExistingTag.status).toBe(1)
    expect(uncheckedExistingTag.output).toMatch(/exact draft.*publish transition/i)

    const forgedManifest = check(
      replaceOnce(
        WORKFLOW,
        "      - name: Verify draft and publish once\n        id: publish\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash\n        env:\n          GH_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}\n          RELEASE_TAG: ${{ steps.tag.outputs.tag }}\n          RELEASE_VERSION: ${{ steps.tag.outputs.version }}\n          RELEASE_ASSET_MANIFEST: ${{ steps.assets.outputs.manifest }}",
        "      - name: Verify draft and publish once\n        id: publish\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash\n        env:\n          GH_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}\n          RELEASE_TAG: ${{ steps.tag.outputs.tag }}\n          RELEASE_VERSION: ${{ steps.tag.outputs.version }}\n          RELEASE_ASSET_MANIFEST: '{\"assets\":[]}'",
      ),
    )
    expect(forgedManifest.status).toBe(1)
    expect(forgedManifest.output).toMatch(/validated release dataflow/i)
  })

  it('rechecks version monotonicity and publishes only an explicit latest stable release', () => {
    const noPrepublishVersion = check(
      replaceOnce(
        WORKFLOW,
        '          node scripts/release-assets.mjs assert-version "$RELEASE_VERSION" "$RUNNER_TEMP/tags-before-publish.json" "$RUNNER_TEMP/releases-before-publish.json" "$GITHUB_SHA"',
        '          echo "pre-publication version inventory ignored"',
      ),
    )
    expect(noPrepublishVersion.status).toBe(1)
    expect(noPrepublishVersion.output).toMatch(/version.*publish transition/i)

    const notLatest = check(
      replaceOnce(
        WORKFLOW,
        'gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false --prerelease=false --latest',
        'gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false --prerelease=false',
      ),
    )
    expect(notLatest.status).toBe(1)
    expect(notLatest.output).toMatch(/sole publish transition/i)

    const prerelease = check(
      replaceOnce(
        WORKFLOW,
        'gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false --prerelease=false --latest',
        'gh release edit "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --draft=false --prerelease --latest',
      ),
    )
    expect(prerelease.status).toBe(1)
    expect(prerelease.output).toMatch(/sole publish transition/i)
  })

  it('requires isPrerelease and repository-latest identity in retry and post-publication proofs', () => {
    const noPrereleaseField = check(
      replaceOnce(WORKFLOW, '--json isDraft,isPrerelease --jq .isDraft', '--json isDraft --jq .isDraft'),
    )
    expect(noPrereleaseField.status).toBe(1)
    expect(noPrereleaseField.output).toMatch(/every release JSON query.*isPrerelease/i)

    const taggedRetryLatest = check(
      replaceOnce(
        WORKFLOW,
        'gh release view --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease,assets,tagName,targetCommitish > "$RUNNER_TEMP/existing-latest-release.json"',
        'gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease,assets,tagName,targetCommitish > "$RUNNER_TEMP/existing-latest-release.json"',
      ),
    )
    expect(taggedRetryLatest.status).toBe(1)
    expect(taggedRetryLatest.output).toMatch(/published retry.*latest/i)

    const noLatestProof = check(
      replaceOnce(
        WORKFLOW,
        '          node scripts/release-assets.mjs verify "$RUNNER_TEMP/latest-release.json" published exact',
        '          echo "repository latest release not verified"',
      ),
    )
    expect(noLatestProof.status).toBe(1)
    expect(noLatestProof.output).toMatch(/repository-latest proofs/i)
  })

  it('rejects a retry that can never remove stale draft assets', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      '              gh release delete-asset "$RELEASE_TAG" "$name" --yes --repo "$GITHUB_REPOSITORY"',
      '              echo "stale asset left behind: $name"',
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/prune stale assets/i)

    const wrongTag = check(
      replaceOnce(
        WORKFLOW,
        'gh release upload "$RELEASE_TAG" "${assets[@]}" --clobber',
        'gh release upload "v-public" "${assets[@]}" --clobber',
      ),
    )
    expect(wrongTag.status).toBe(1)
    expect(wrongTag.output).toMatch(/RELEASE_TAG|draft upload/i)

    const reboundTag = check(
      replaceOnce(
        WORKFLOW,
        "      - name: Upload assets to draft\n        id: upload\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash\n        env:\n          GH_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}\n          RELEASE_TAG: ${{ steps.tag.outputs.tag }}",
        "      - name: Upload assets to draft\n        id: upload\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash\n        env:\n          GH_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}\n          RELEASE_TAG: v-public",
      ),
    )
    expect(reboundTag.status).toBe(1)
    expect(reboundTag.output).toMatch(/validated release dataflow/i)

    const always = check(
      replaceOnce(
        WORKFLOW,
        "      - name: Upload assets to draft\n        id: upload\n        if: steps.draft.outputs.already_published != 'true'",
        "      - name: Upload assets to draft\n        id: upload\n        if: steps.draft.outputs.already_published != 'true' || always()",
      ),
    )
    expect(always.status).toBe(1)
    expect(always.output).toMatch(/skip an already-published retry/i)
  })

  it('rejects direct and package-script-hidden validation on the runner', () => {
    const direct = check(replaceOnce(WORKFLOW, '        run: npm run dist:win', '        run: npm test'))
    expect(direct.status).toBe(1)
    expect(direct.output).toMatch(/forbidden validation.*tests/i)

    const packageMutant = {
      ...PACKAGE,
      scripts: {
        ...PACKAGE.scripts,
        build: `npm run typecheck && ${PACKAGE.scripts.build}`,
      },
    }
    const indirect = check(WORKFLOW, packageMutant)
    expect(indirect.status).toBe(1)
    expect(indirect.output).toMatch(/forbidden validation.*type-check/i)

    const npmExec = check(replaceOnce(WORKFLOW, '        run: npm run dist:win', '        run: npm exec -- vitest run'))
    expect(npmExec.status).toBe(1)
    expect(npmExec.output).toMatch(/forbidden validation.*tests/i)

    const lifecycle = check(WORKFLOW, {
      ...PACKAGE,
      scripts: { ...PACKAGE.scripts, prebuild: 'npm test' },
    })
    expect(lifecycle.status).toBe(1)
    expect(lifecycle.output).toMatch(/forbidden validation.*tests/i)
  })
})
