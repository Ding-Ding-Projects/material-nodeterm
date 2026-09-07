import { describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { OwnedProcessLedger, childFirst, listenerProbeScript, processInventoryScript, processProbeScript, sameIdentity } from './gallery-process-lifecycle.mjs'
import { reviewedPowerShellWrapper } from './cheap-mcp-transport.mjs'

const identity = (pid, parentPid, ticks = '638000000000000000') => ({ pid, parentPid, creationTime: ticks, executable: 'C:\\fixture\\child.exe' })
const shell7 = path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe')
const shell5 = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
function ps(source, shell = shell5) {
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, encoding: 'utf8', timeout: 15_000 })
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || 'PowerShell failed')
  return JSON.parse(result.stdout)
}

describe('exact launch process lifecycle', () => {
  it('orders by ancestry depth rather than numeric parent PID', () => {
    const root = identity(900, 1), child = identity(7, 900), grandchild = identity(600, 7)
    expect(childFirst([root, child, grandchild]).map((p) => p.pid)).toEqual([600, 7, 900])
  })
  it('retains replacements, unavailable identities and an absent unobserved root', async () => {
    const root = identity(900, 1), child = identity(7, 900)
    const ledger = new OwnedProcessLedger(root)
    expect(() => ledger.observe([])).toThrow(/ownership is unknown/)
    expect(() => ledger.observe([root, { pid: 7, parentPid: 900, unavailable: true }])).toThrow(/unavailable/)
    ledger.observe([root, child])
    const killed = []
    await expect(ledger.terminate({ inventory: async () => [root, child], probe: async (pid) => pid === 7 ? { ...child, creationTime: '638000000000000001' } : root, kill: async (pid) => killed.push(pid) })).rejects.toThrow(/replacement retained/)
    expect(killed).toEqual([])
  })
  it('proves each saved child absent after root removal and rejects late replacements', async () => {
    const root = identity(900, 1), child = identity(7, 900), grandchild = identity(600, 7)
    const current = new Map([root, child, grandchild].map((p) => [p.pid, p]))
    const saved = []
    const ledger = new OwnedProcessLedger(root, (record) => saved.push(structuredClone(record)))
    const killed = []
    const result = await ledger.terminate({ inventory: async () => [...current.values()], probe: async (pid) => current.get(pid) ?? null, kill: async (pid) => { killed.push(pid); current.delete(pid) } })
    expect(killed).toEqual([600, 7, 900])
    expect(result.processesExited).toBe(true)
    expect(saved.at(-1).processes).toHaveLength(3)
    current.set(7, { ...child, creationTime: '638000000000000001' })
    await expect(ledger.revalidate(child, async (pid) => current.get(pid) ?? null)).rejects.toThrow(/replacement retained/)
  })
  it('distinguishes a successful empty TCP query from provider failure in real PowerShell', () => {
    const source = listenerProbeScript(9939)
    expect(ps(`function Get-NetTCPConnection { @() };${source}`)).toEqual({ owners: [] })
    expect(() => ps(`function Get-NetTCPConnection { throw 'fixture TCP provider unavailable' };${source}`)).toThrow(/fixture TCP provider unavailable/)
    expect(ps(`function Get-NetTCPConnection { [pscustomobject]@{State='Listen';LocalPort=9939;OwningProcess=71} };${source}`)).toEqual({ owners: [71] })
  }, 30_000)
  it('returns explicit JSON null for an absent process and stable ticks across PowerShell versions', () => {
    const a = ps(processProbeScript(process.pid), shell5).process
    const b = ps(processProbeScript(process.pid), shell7).process
    expect(sameIdentity(a, b)).toBe(true)
    expect(ps(`function Get-CimInstance { $null };${processProbeScript(123)}`)).toEqual({ process: null })
  }, 30_000)
  for (const partial of [false, true]) it(`recovers durable wrapper ownership with ${partial ? 'lost launch response' : 'normal response'} and terminates real children`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-lifecycle-'))
    const receipt = path.join(root, 'launch.json')
    const childScript = path.join(root, 'child.ps1')
    fs.writeFileSync(childScript, 'Start-Sleep -Seconds 40')
    const wrapper = reviewedPowerShellWrapper(shell7, shell7, ['-NoProfile', '-NonInteractive', '-File', childScript], { NODE_OPTIONS: '', NODE_PATH: '' }, receipt)
    const launched = spawn(wrapper.executable, wrapper.arguments, { windowsHide: true, stdio: 'ignore' })
    const exited = new Promise((resolve) => launched.once('exit', resolve))
    let proof
    try {
      await expect.poll(() => { try { proof = JSON.parse(fs.readFileSync(receipt, 'utf8')); return proof.child !== null } catch { return false } }, { timeout: 10_000 }).toBe(true)
      if (!partial) expect(proof.wrapper.pid).toBe(launched.pid)
      const ledger = new OwnedProcessLedger(proof.wrapper)
      const result = await ledger.terminate({ inventory: async () => ps(processInventoryScript).processes, probe: async (pid) => ps(processProbeScript(pid)).process, kill: async (pid) => { ps(`$ErrorActionPreference='Stop';Stop-Process -Id ${pid} -Force -ErrorAction Stop;ConvertTo-Json -InputObject @{stopped=$true}`) } })
      expect(result.processesExited).toBe(true)
      expect(result.savedProcesses.some((p) => sameIdentity(p, proof.child))).toBe(true)
      expect(ps(processProbeScript(proof.child.pid)).process).toBeNull()
      await exited
    } finally {
      // Exact Process object owned by this test, no process-name cleanup.
      fs.writeFileSync(receipt + '.release', '')
      if (proof?.child && sameIdentity(proof.child, ps(processProbeScript(proof.child.pid)).process)) ps(`Stop-Process -Id ${proof.child.pid} -Force;ConvertTo-Json -InputObject @{stopped=$true}`)
      if (launched.exitCode === null) launched.kill()
      await exited
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
