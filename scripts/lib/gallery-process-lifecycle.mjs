import path from 'node:path'

// CIM DateTime stringification differs between Windows PowerShell and PowerShell 7.
// Decimal UTC ticks preserve its full precision through JSON and JavaScript.
export const identityPowerShell = `function Identity($p) { if($null -eq $p){return $null}; if(-not $p.ExecutablePath -or -not $p.CreationDate){throw 'Process identity unavailable'}; [pscustomobject]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;creationTime=$p.CreationDate.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture);executable=[string]$p.ExecutablePath} }`
export const processInventoryScript = `$ErrorActionPreference='Stop';${identityPowerShell};$items=@(Get-CimInstance Win32_Process -ErrorAction Stop);$result=@($items | ForEach-Object { if($_.ExecutablePath -and $_.CreationDate){Identity $_} else {[pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;unavailable=$true}} });ConvertTo-Json -InputObject @{processes=$result} -Depth 4 -Compress`
export function processProbeScript(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid process PID.')
  return `$ErrorActionPreference='Stop';${identityPowerShell};$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop;ConvertTo-Json -InputObject @{process=(Identity $p)} -Depth 4 -Compress`
}
export function listenerProbeScript(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('Invalid listener port.')
  // Query the complete table first: a successful empty filter is absence, a failed
  // provider query is an error. Get-NetTCPConnection's no-match error is ambiguous.
  return `$ErrorActionPreference='Stop';$all=@(Get-NetTCPConnection -ErrorAction Stop);$items=@($all|Where-Object { $_.State -eq 'Listen' -and $_.LocalPort -eq ${port} });ConvertTo-Json -InputObject @{owners=@($items|ForEach-Object {[int]$_.OwningProcess})} -Compress`
}
export function validIdentity(value) {
  return value && Number.isInteger(value.pid) && value.pid > 0 && Number.isInteger(value.parentPid) && value.parentPid >= 0 && /^\d{17,19}$/u.test(value.creationTime) && typeof value.executable === 'string' && path.win32.isAbsolute(value.executable)
}
export function sameIdentity(a, b) {
  return validIdentity(a) && validIdentity(b) && a.pid === b.pid && a.parentPid === b.parentPid && a.creationTime === b.creationTime && path.win32.normalize(a.executable).toLowerCase() === path.win32.normalize(b.executable).toLowerCase()
}
export function childFirst(records) {
  const byPid = new Map(records.map((item) => [item.pid, item]))
  const depth = (item) => {
    let n = 0
    const seen = new Set([item.pid])
    while (byPid.has(item.parentPid)) {
      if (seen.has(item.parentPid)) throw new Error('Process ancestry cycle.')
      seen.add(item.parentPid); item = byPid.get(item.parentPid); n++
    }
    return n
  }
  return [...records].sort((a, b) => depth(b) - depth(a))
}
export class OwnedProcessLedger {
  constructor(root, persist = () => {}) {
    if (!validIdentity(root)) throw new Error('Launch identity is incomplete.')
    this.root = root; this.records = [root]; this.persist = persist; this.observedTree = false
    this.save()
  }
  save() { this.persist({ root: this.root, processes: this.records, observedTree: this.observedTree }) }
  observe(inventory) {
    if (!Array.isArray(inventory)) throw new Error('Process inventory unavailable.')
    const root = inventory.find((p) => p.pid === this.root.pid)
    if (!sameIdentity(root, this.root)) throw new Error('Launch root is absent or its identity changed; descendant ownership is unknown.')
    for (const record of this.records) {
      const current = inventory.find((p) => p.pid === record.pid)
      if (current && !sameIdentity(record, current)) throw new Error('Recorded process identity changed; replacement retained.')
    }
    const live = this.records.filter((record) => inventory.some((p) => sameIdentity(record, p)))
    for (let i = 0; i < live.length; i++) {
      const parent = live[i]
      for (const p of inventory.filter((item) => item.parentPid === parent.pid && item.pid !== parent.pid)) {
        if (!validIdentity(p)) throw new Error('Descendant identity is unavailable; retained.')
        if (BigInt(p.creationTime) < BigInt(parent.creationTime)) continue
        if (!live.some((item) => item.pid === p.pid)) live.push(p)
        if (!this.records.some((item) => item.pid === p.pid)) this.records.push(p)
      }
    }
    this.observedTree = true; this.save()
    return live
  }
  async revalidate(expected, probe) {
    const live = await probe(expected.pid)
    if (live === null) return null
    if (!sameIdentity(expected, live)) throw new Error(`Recorded PID ${expected.pid} identity changed; replacement retained.`)
    return live
  }
  async terminate({ inventory, probe, kill, wait = () => new Promise((resolve) => setTimeout(resolve, 100)), timeoutMs = 10_000 }) {
    // Freeze the complete observed tree before any parent is closed or terminated.
    this.observe(await inventory())
    const actions = []
    for (const expected of childFirst(this.records)) {
      if (await this.revalidate(expected, probe)) { await kill(expected.pid); actions.push(expected.pid) }
    }
    const deadline = Date.now() + timeoutMs
    do {
      const remaining = []
      for (const expected of this.records) if (await this.revalidate(expected, probe)) remaining.push(expected.pid)
      if (!remaining.length) return { processesExited: true, savedProcesses: this.records, terminated: actions }
      await wait()
    } while (Date.now() < deadline)
    throw new Error('Recorded launch processes remain after termination; desktop retained.')
  }
}
