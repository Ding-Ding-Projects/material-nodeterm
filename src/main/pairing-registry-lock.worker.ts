import { promises as fs } from 'fs'
import { withPairingRegistryLock } from './pairing-registry-lock'

async function main(): Promise<void> {
  const [agentJsonPath, role] = process.argv.slice(2)
  if (!agentJsonPath || (role !== 'host' && role !== 'desktop')) {
    throw new Error('usage: worker <agent-json-path> <host|desktop>')
  }

  await withPairingRegistryLock(
    agentJsonPath,
    async () => {
      const obj = JSON.parse(await fs.readFile(agentJsonPath, 'utf8')) as Record<string, unknown>
      process.send?.({ type: 'entered', role })
      if (role === 'host') {
        await new Promise<void>((resolve) => {
          process.once('message', (message) => {
            if (message === 'release') resolve()
          })
        })
        obj.port = 4321
        obj.lastHostWrite = 'preserved'
      } else {
        obj.devices = [{ id: 'new-phone', token: 'test-token' }]
      }
      const temp = `${agentJsonPath}.${process.pid}.worker.tmp`
      await fs.writeFile(temp, JSON.stringify(obj) + '\n', { mode: 0o600 })
      await fs.rename(temp, agentJsonPath)
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
