const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

/**
 * Stage a COPY of package.json for the Server Edition deployment resources.
 *
 * The Docker build context needs a package.json, but the project's own one may NOT be listed as an
 * `extraResources` source: electron-builder excludes an extraResources source file from the app
 * package to avoid shipping it twice, so naming `package.json` there deletes it from app.asar and
 * the build dies with
 *
 *     Application "package.json" in the ... app.asar is corrupted:
 *     "package.json" was not found in this archive
 *
 * That is not a guess. Measured by bisection on this build: with every deployment resource present
 * the build fails; dropping ONLY the package.json entry and keeping the other fifteen — including
 * the whole `src` tree, package-lock.json and the tsconfigs — builds clean.
 *
 * A staged copy under a different source path has no such interaction, which is exactly why the
 * Codex relay below is staged rather than referenced in place.
 */
function stageDeploymentPackageJson(projectDir) {
  const source = path.join(projectDir, 'package.json')
  const target = path.join(projectDir, 'dist', '.pack-resources', 'server-deployment', 'package.json')
  if (!fs.statSync(source).isFile()) {
    throw new Error('Missing package.json to stage for the Server Edition deployment resources')
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  fs.copyFileSync(source, target)
}

exports.default = async function stagePackResources(context) {
  const projectDir = context.packager.projectDir

  stageDeploymentPackageJson(projectDir)

  const source = path.join(projectDir, 'out', 'main', 'codex-relay.js')
  const target = path.join(projectDir, 'dist', '.pack-resources', 'codex-relay.js')
  if (!fs.statSync(source).isFile()) {
    throw new Error('Missing built Codex relay entry')
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  // The same artifact is uploaded to SSH hosts. Bundle `ws` so Ubuntu needs only its existing
  // Node.js + Codex binaries, never a NodeTerm checkout or npm install.
  await esbuild.build({
    entryPoints: [source],
    outfile: target,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18'
  })
}
