// Route 2: generate a GitHub Actions workflow that builds an NSIS installer on a Windows
// runner and uploads it as an artifact. Pure string generation -- no network, no `gh`.
//
// House style borrowed from this repo's own .github/workflows/ci.yml: pinned action major
// versions, a cancel-in-progress concurrency group (this is a disposable build check, exactly
// the case that rule calls out), full checkout history is NOT needed here (no changelog
// cross-check), and -- the one deliberate omission -- no release/publish step. Building and
// shipping are different authorities; this workflow only ever produces an artifact.
export interface CiWorkflowInput {
  /** Relative path (from the repo root) to the .nsi script this workflow should compile. */
  scriptPath: string
  /** Display name for the produced artifact. */
  artifactName: string
  /** Relative glob/path to the compiled installer, for actions/upload-artifact. */
  outputPath: string
  /** Workflow file name shown in the header comment, e.g. "build-installer.yml". */
  workflowName?: string
}

export function renderCiWorkflow(input: CiWorkflowInput): string {
  const name = input.workflowName ?? 'build-installer.yml'
  const scriptPath = input.scriptPath
  const artifactName = input.artifactName
  const outputPath = input.outputPath

  return `name: Build NSIS installer

# ${name}
#
# Builds the generated NSIS installer on a Windows runner and uploads the result as a
# workflow artifact. This workflow does NOT publish a release -- building and shipping are
# different authorities, and this file only ever produces an artifact for manual download.
on:
  workflow_dispatch: {}
  push:
    branches: [main]

concurrency:
  group: build-installer-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v7

      - name: Install NSIS
        run: choco install nsis -y --no-progress

      - name: Compile installer
        shell: pwsh
        run: |
          & "C:\\Program Files (x86)\\NSIS\\makensis.exe" "${scriptPath}"

      - uses: actions/upload-artifact@v4
        with:
          name: ${artifactName}
          path: ${outputPath}
          if-no-files-found: error
`
}
