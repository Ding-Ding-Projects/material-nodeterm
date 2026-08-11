const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')

exports.default = async function stageCodexRelay(context) {
  const projectDir = context.packager.projectDir
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
