import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const copyPath = join(ROOT, 'src/renderer/wsl/wslCopy.ts')
const copySource = readFileSync(copyPath, 'utf8')
const catalogSource = readFileSync(join(ROOT, 'src/shared/i18n/catalog.ts'), 'utf8')
const dialogSource = readFileSync(join(ROOT, 'src/renderer/wsl/WslCreateDialog.tsx'), 'utf8')
const stateSource = readFileSync(join(ROOT, 'src/renderer/state/wsl.ts'), 'utf8')
const formSource = readFileSync(join(ROOT, 'src/renderer/wsl/wslCreateForm.ts'), 'utf8')
const serviceSource = readFileSync(join(ROOT, 'src/core/wsl/service.ts'), 'utf8')
const sharedSource = readFileSync(join(ROOT, 'src/shared/wsl.ts'), 'utf8')
const rpcSource = readFileSync(join(ROOT, 'src/shared/rpc.ts'), 'utf8')
const canvasSource = readFileSync(join(ROOT, 'src/renderer/canvas/Canvas.tsx'), 'utf8')
const bridgeSource = readFileSync(join(ROOT, 'src/renderer/bridge/ws-bridge.ts'), 'utf8')

function inventoryFrom(source) {
  const rows = []
  const rowPattern = /^\s+(\w+): \{ id: '([^']+)', fallback: '([^']*)' \},?$/gm
  for (const match of source.matchAll(rowPattern)) rows.push({ key: match[1], id: match[2], fallback: match[3] })
  return rows
}

function fail(message) {
  console.error(`WSL copy coverage: ${message}`)
  process.exitCode = 1
}

function assert(condition, message) {
  if (!condition) fail(message)
}

const inventory = inventoryFrom(copySource)
assert(inventory.length > 0, 'WSL_COPY_INVENTORY is empty or unreadable')
assert(new Set(inventory.map((row) => row.id)).size === inventory.length, 'catalogue ids are duplicated')
assert(new Set(inventory.map((row) => row.key)).size === inventory.length, 'copy keys are duplicated')

for (const row of inventory) {
  assert(catalogSource.includes(`'${row.id}':`), `catalogue entry is missing for ${row.id}`)
  assert(row.fallback.length > 0, `English fallback is empty for ${row.id}`)
  const requiredUse = [dialogSource, stateSource, serviceSource, sharedSource, formSource, canvasSource].some((source) =>
    source.includes(`'${row.key}'`) || source.includes(`.${row.key}`) || source.includes(row.fallback)
  )
  assert(requiredUse, `copy key ${row.key} has no production use`)
}

for (const phase of ['validating', 'checking', 'installing', 'recording', 'completed', 'failed', 'cancelled', 'cancelledLate']) {
  assert(sharedSource.includes(`| '${phase}'`), `progress id ${phase} is missing from the shared type`)
  assert(dialogSource.includes(`progress.message.id`), 'renderer does not consume the typed progress id')
}
assert(sharedSource.includes('params: Readonly<Record<string, string>>'), 'progress parameters are not typed')
assert(sharedSource.includes('facts: readonly string[]'), 'progress facts are not typed')
assert(serviceSource.includes('progress.message.params'), 'service does not emit progress parameters')
assert(serviceSource.includes('progress.message.facts'), 'service does not emit progress facts')
assert(sharedSource.includes('WslCatalogueError'), 'catalogue error type is missing from the shared contract')
assert(sharedSource.includes('error: WslCreateError'), 'create result is not typed at the shared boundary')
assert(bridgeSource.includes('ReturnType<import(\'@shared/wsl\').WslApi[\'catalogue\']>'), 'Server RPC catalogue result is not typed as the shared API')
assert(bridgeSource.includes('ReturnType<import(\'@shared/wsl\').WslApi[\'create\']>'), 'Server RPC create result is not typed as the shared API')
assert(bridgeSource.includes('details: m.error.details'), 'Server RPC typed error details are discarded by the client')
assert(rpcSource.includes('details?: unknown'), 'RPC error details are missing from the wire contract')
assert(serviceSource.includes('messageId'), 'catalogue production errors lack a typed authored template id')
assert(stateSource.includes('isWslCatalogueError'), 'renderer catalogue state does not retain typed catalogue errors')

// Negative mutation: deleting one exact inventory row must make the same checks fail. This is
// intentionally in-process, so the regression proves the checker itself rather than a stale list.
const mutant = copySource.replace(`  ${inventory[0].key}: { id: '${inventory[0].id}', fallback: '${inventory[0].fallback}' },\n`, '')
const mutantRows = inventoryFrom(mutant)
assert(mutantRows.length !== inventory.length, 'negative mutation did not remove an exact inventory row')
assert(!mutantRows.some((row) => row.id === inventory[0].id), 'negative mutation escaped exact row matching')

if (process.exitCode !== 1) {
  console.log(`WSL copy coverage: ${inventory.length} inventory rows, catalogue/use/fallback/error/progress checks passed`)
  console.log('WSL copy coverage: negative inventory mutation was rejected')
}
