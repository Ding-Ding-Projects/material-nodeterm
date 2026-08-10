const fs = require('fs')
const path = require('path')

exports.default = async function stageCodexRelay(context) {
  const projectDir = context.packager.projectDir
  const source = path.join(projectDir, 'out', 'main', 'codex-relay.js')
  const target = path.join(
    projectDir,
    'dist',
    '.pack-resources',
    'codex-relay.js'
  )
  if (!fs.statSync(source).isFile()) {
    throw new Error('Missing built Codex relay entry')
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  fs.copyFileSync(source, target)
}
