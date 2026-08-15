import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(__dirname, '../..')
const CHECKER = path.join(ROOT, 'scripts', 'check-release-workflow.mjs')
const WORKFLOW = readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').replace(
  /\r\n/g,
  '\n'
)
const PACKAGE = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  build: {
    forceCodeSigning: boolean
    win: { signExecutable: boolean; signAndEditExecutable?: boolean }
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
    encoding: 'utf8'
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

  it('rejects a tag-trigger mutant even if the in-job guard still exists', () => {
    const mutated = replaceOnce(WORKFLOW, "branches: ['**']", "tags: ['**']")
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/branch pushes|tag pushes/i)

    const tagsIgnore = check(
      replaceOnce(WORKFLOW, "    branches: ['**']", "    branches: ['**']\n    tags-ignore: ['never']")
    )
    expect(tagsIgnore.status).toBe(1)
    expect(tagsIgnore.output).toMatch(/tag pushes/i)

    const pathsIgnore = check(
      replaceOnce(WORKFLOW, "    branches: ['**']", "    branches: ['**']\n    paths-ignore: ['**/*.md']")
    )
    expect(pathsIgnore.status).toBe(1)
    expect(pathsIgnore.output).toMatch(/path filters/i)

    const excludedMain = check(replaceOnce(WORKFLOW, "branches: ['**']", "branches: ['**', '!main']"))
    expect(excludedMain.status).toBe(1)
    expect(excludedMain.output).toMatch(/branch pushes/i)
  })

  it('skips branch-deletion events before checkout or publication', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      "if: github.event_name != 'push' || github.event.deleted != true",
      "if: github.event_name != 'push' || github.event.deleted == true"
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/branch-deletion/i)
  })

  it('rejects a tag guard that no longer fails', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      '          exit 1\n\n      - name: Checkout',
      '          exit 0\n\n      - name: Checkout'
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/tag-ref guard/i)
  })

  it('rejects cancellation and retry-unstable tag mutants', () => {
    const cancelling = check(replaceOnce(WORKFLOW, 'cancel-in-progress: false', 'cancel-in-progress: true'))
    expect(cancelling.status).toBe(1)
    expect(cancelling.output).toMatch(/never cancel/i)

    const attemptGroup = check(
      replaceOnce(
        WORKFLOW,
        'group: release-${{ github.workflow }}-${{ github.run_number }}',
        'group: release-${{ github.workflow }}-${{ github.run_number }}-${{ github.run_attempt }}'
      )
    )
    expect(attemptGroup.status).toBe(1)
    expect(attemptGroup.output).toMatch(/isolate attempts/i)

    const attemptTag = check(
      replaceOnce(
        WORKFLOW,
        '          tag="${base}-ci.${GITHUB_RUN_NUMBER}"',
        '          tag="${base}-ci.${GITHUB_RUN_ATTEMPT}"'
      )
    )
    expect(attemptTag.status).toBe(1)
    expect(attemptTag.output).toMatch(/stable across retry/i)
  })

  it('rejects a package that is not the explicit unsigned Squirrel target', () => {
    const wrongTarget = check(
      replaceOnce(
        WORKFLOW,
        'npx electron-builder --win squirrel --x64 --publish never',
        'npx electron-builder --win nsis --x64 --publish never'
      )
    )
    expect(wrongTarget.status).toBe(1)
    expect(wrongTarget.output).toMatch(/Squirrel x64/i)

    const weakSignature = check(
      replaceOnce(
        WORKFLOW,
        'node scripts/release-assets.mjs assert-unsigned "$($sig.Status)"',
        'Write-Host "signature decision removed"'
      )
    )
    expect(weakSignature.status).toBe(1)
    expect(weakSignature.output).toMatch(/behavior-check Authenticode/i)

    const wrongSignatureTarget = check(
      replaceOnce(WORKFLOW, 'SETUP_PATH: ${{ steps.assets.outputs.setup }}', 'SETUP_PATH: package.json')
    )
    expect(wrongSignatureTarget.status).toBe(1)
    expect(wrongSignatureTarget.output).toMatch(/behavior-check Authenticode/i)

    const signingEnabled = check(WORKFLOW, {
      ...PACKAGE,
      build: { ...PACKAGE.build, win: { ...PACKAGE.build.win, signExecutable: true } }
    })
    expect(signingEnabled.status).toBe(1)
    expect(signingEnabled.output).toMatch(/disable signing.*preserving/i)

    const resourceEditingDisabled = check(WORKFLOW, {
      ...PACKAGE,
      build: { ...PACKAGE.build, win: { ...PACKAGE.build.win, signAndEditExecutable: false } }
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
        '    runs-on: windows-latest\n    env:\n      GH_TOKEN: ${{ github.token }}'
      )
    )
    expect(jobWide.status).toBe(1)
    expect(jobWide.output).toMatch(/never be job-wide/i)
  })

  it('keeps every publication safety step fail-fast', () => {
    const ignoredFailure = check(
      replaceOnce(
        WORKFLOW,
        '        id: unsigned\n        shell: pwsh',
        '        id: unsigned\n        continue-on-error: true\n        shell: pwsh'
      )
    )
    expect(ignoredFailure.status).toBe(1)
    expect(ignoredFailure.output).toMatch(/must fail the job/i)

    const noErrexit = check(
      replaceOnce(
        WORKFLOW,
        "        id: publish\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash",
        "        id: publish\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash {0}"
      )
    )
    expect(noErrexit.status).toBe(1)
    expect(noErrexit.output).toMatch(/fail-fast bash/i)

    const disabledErrexit = check(
      replaceOnce(
        WORKFLOW,
        '        run: |\n          # Keep the notes edit explicitly draft.',
        '        run: |\n          set +e\n          # Keep the notes edit explicitly draft.'
      )
    )
    expect(disabledErrexit.status).toBe(1)
    expect(disabledErrexit.output).toMatch(/must not disable.*fail-fast/i)
  })

  it('rejects a public release creation before assets exist', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      '            gh release create "$RELEASE_TAG" \\\n              --repo "$GITHUB_REPOSITORY" \\\n              --draft \\\n',
      '            gh release create "$RELEASE_TAG" \\\n              --repo "$GITHUB_REPOSITORY" \\\n'
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/creation.*private draft/i)

    const duplicate = check(
      replaceOnce(
        WORKFLOW,
        '          echo "already_published=false" >> "$GITHUB_OUTPUT"',
        '          gh release create "$RELEASE_TAG-copy" --repo "$GITHUB_REPOSITORY" --draft --notes copy\n          echo "already_published=false" >> "$GITHUB_OUTPUT"'
      )
    )
    expect(duplicate.status).toBe(1)
    expect(duplicate.output).toMatch(/exactly one release creation/i)

    const publicDespiteDraftFlag = check(
      replaceOnce(
        WORKFLOW,
        '              --draft \\\n              --title "$RELEASE_TAG" \\\n              --target "$GITHUB_SHA" \\\n              --notes "Assets are being staged by GitHub Actions. This draft is not a published release."\n          fi',
        '              --draft --draft=false \\\n              --title "$RELEASE_TAG" \\\n              --target "$GITHUB_SHA" \\\n              --notes "Assets are being staged by GitHub Actions. This draft is not a published release."\n          fi'
      )
    )
    expect(publicDespiteDraftFlag.status).toBe(1)
    expect(publicDespiteDraftFlag.output).toMatch(/private draft/i)
  })

  it('rejects reusing a published release before its complete inventory is validated', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      '              node scripts/release-assets.mjs verify "$RUNNER_TEMP/existing-release.json" published exact\n              echo "already_published=true" >> "$GITHUB_OUTPUT"',
      '              echo "already_published=true" >> "$GITHUB_OUTPUT"\n              node scripts/release-assets.mjs verify "$RUNNER_TEMP/existing-release.json" published exact'
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/published retry.*validate/i)

    const noExit = check(
      replaceOnce(
        WORKFLOW,
        '              echo "already_published=true" >> "$GITHUB_OUTPUT"\n              exit 0',
        '              echo "already_published=true" >> "$GITHUB_OUTPUT"'
      )
    )
    expect(noExit.status).toBe(1)
    expect(noExit.output).toMatch(/published retry.*reuse/i)
  })

  it('rejects publication before exact remote draft verification', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      '          node scripts/release-assets.mjs verify "$RUNNER_TEMP/draft-release.json" draft exact',
      '          echo "verification accidentally removed"'
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/draft verification.*publish transition/i)

    const suppressed = check(
      replaceOnce(
        WORKFLOW,
        'node scripts/release-assets.mjs verify "$RUNNER_TEMP/draft-release.json" draft exact',
        'node scripts/release-assets.mjs verify "$RUNNER_TEMP/draft-release.json" draft exact || true'
      )
    )
    expect(suppressed.status).toBe(1)
    expect(suppressed.output).toMatch(/draft verification.*publish transition/i)

    const uncheckedExistingTag = check(
      replaceOnce(
        WORKFLOW,
        '          if tag_sha=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${RELEASE_TAG}" --jq .object.sha 2>"$RUNNER_TEMP/tag-ref-error.txt"); then\n            node scripts/release-assets.mjs assert-target "$tag_sha" "$GITHUB_SHA"',
        '          if tag_sha=$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${RELEASE_TAG}" --jq .object.sha 2>"$RUNNER_TEMP/tag-ref-error.txt"); then\n            echo "existing tag target ignored: $tag_sha"'
      )
    )
    expect(uncheckedExistingTag.status).toBe(1)
    expect(uncheckedExistingTag.output).toMatch(/draft verification.*publish transition/i)

    const forgedManifest = check(
      replaceOnce(
        WORKFLOW,
        "      - name: Verify draft and publish once\n        id: publish\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash\n        env:\n          GH_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}\n          RELEASE_TAG: ${{ steps.tag.outputs.tag }}\n          RELEASE_ASSET_MANIFEST: ${{ steps.assets.outputs.manifest }}",
        "      - name: Verify draft and publish once\n        id: publish\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash\n        env:\n          GH_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}\n          RELEASE_TAG: ${{ steps.tag.outputs.tag }}\n          RELEASE_ASSET_MANIFEST: '{\"assets\":[]}'"
      )
    )
    expect(forgedManifest.status).toBe(1)
    expect(forgedManifest.output).toMatch(/validated release dataflow/i)
  })

  it('rejects a retry that can never remove stale draft assets', () => {
    const mutated = replaceOnce(
      WORKFLOW,
      '              gh release delete-asset "$RELEASE_TAG" "$name" --yes --repo "$GITHUB_REPOSITORY"',
      '              echo "stale asset left behind: $name"'
    )
    const result = check(mutated)
    expect(result.status).toBe(1)
    expect(result.output).toMatch(/prune stale assets/i)

    const wrongTag = check(
      replaceOnce(
        WORKFLOW,
        'gh release upload "$RELEASE_TAG" "${assets[@]}" --clobber',
        'gh release upload "v-public" "${assets[@]}" --clobber'
      )
    )
    expect(wrongTag.status).toBe(1)
    expect(wrongTag.output).toMatch(/RELEASE_TAG|draft upload/i)

    const reboundTag = check(
      replaceOnce(
        WORKFLOW,
        "      - name: Upload assets to draft\n        id: upload\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash\n        env:\n          GH_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}\n          RELEASE_TAG: ${{ steps.tag.outputs.tag }}",
        "      - name: Upload assets to draft\n        id: upload\n        if: steps.draft.outputs.already_published != 'true'\n        shell: bash\n        env:\n          GH_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}\n          RELEASE_TAG: v-public"
      )
    )
    expect(reboundTag.status).toBe(1)
    expect(reboundTag.output).toMatch(/validated release dataflow/i)

    const always = check(
      replaceOnce(
        WORKFLOW,
        "      - name: Upload assets to draft\n        id: upload\n        if: steps.draft.outputs.already_published != 'true'",
        "      - name: Upload assets to draft\n        id: upload\n        if: steps.draft.outputs.already_published != 'true' || always()"
      )
    )
    expect(always.status).toBe(1)
    expect(always.output).toMatch(/skip an already-published retry/i)
  })

  it('rejects direct and package-script-hidden validation on the runner', () => {
    const direct = check(
      replaceOnce(WORKFLOW, '        run: npm run build', '        run: npm test')
    )
    expect(direct.status).toBe(1)
    expect(direct.output).toMatch(/forbidden validation.*tests/i)

    const packageMutant = {
      ...PACKAGE,
      scripts: { ...PACKAGE.scripts, build: `npm run typecheck && ${PACKAGE.scripts.build}` }
    }
    const indirect = check(WORKFLOW, packageMutant)
    expect(indirect.status).toBe(1)
    expect(indirect.output).toMatch(/forbidden validation.*type-check/i)

    const npmExec = check(
      replaceOnce(WORKFLOW, '        run: npm run build', '        run: npm exec -- vitest run')
    )
    expect(npmExec.status).toBe(1)
    expect(npmExec.output).toMatch(/forbidden validation.*tests/i)

    const lifecycle = check(WORKFLOW, {
      ...PACKAGE,
      scripts: { ...PACKAGE.scripts, prebuild: 'npm test' }
    })
    expect(lifecycle.status).toBe(1)
    expect(lifecycle.output).toMatch(/forbidden validation.*tests/i)
  })
})
