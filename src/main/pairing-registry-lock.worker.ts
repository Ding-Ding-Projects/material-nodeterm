import { promises as fs } from 'fs'
import { renameAtomic, tempNameFor } from '../core/fs-atomic'
import { withPairingRegistryLock } from './pairing-registry-lock'

async function main(): Promise<void> {
  const [agentJsonPath, role, holdMode] = process.argv.slice(2)
  if (
    !agentJsonPath ||
    (role !== 'host' && role !== 'desktop') ||
    (holdMode !== 'hold' && holdMode !== 'run')
  ) {
    throw new Error('usage: worker <agent-json-path> <host|desktop> <hold|run>')
  }

  await withPairingRegistryLock(
    agentJsonPath,
    async () => {
      const obj = JSON.parse(await fs.readFile(agentJsonPath, 'utf8')) as Record<string, unknown>
      process.send?.({ type: 'entered', role })
      if (holdMode === 'hold') {
        await new Promise<void>((resolve) => {
          process.once('message', (message) => {
            if (message === 'release') resolve()
          })
        })
      }
      if (role === 'host') {
        obj.port = 4321
        obj.lastHostWrite = 'preserved'
      } else {
        obj.devices = [{ id: 'new-phone', token: 'test-token' }]
      }
      const temp = tempNameFor(agentJsonPath)
      try {
        await fs.writeFile(temp, JSON.stringify(obj) + '\n', { mode: 0o600 })
        await renameAtomic(temp, agentJsonPath)
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => undefined)
        throw error
      }
    },
    {
      retryMs: 5,
      timeoutMs: 5_000,
      onContended: () => process.send?.({ type: 'contended', role })
    }
  )

  process.send?.({ type: 'done', role })
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
