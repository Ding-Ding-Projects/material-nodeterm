import { useEffect, useState } from 'react'
import { useSshServers } from '../../../state/sshServers'
import type { SshServer } from '@shared/ssh'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { uuid } from '@renderer/lib/uuid'
import type { SettingsSectionId } from '../nav'

const ROWS = {
  servers: {
    title: 'Saved SSH servers',
    keywords: ['ssh', 'remote', 'server', 'host', 'connect', 'identity', 'key']
  }
}
const ENTRIES = Object.values(ROWS)

export function SshSection({
  isActive,
  onNavigate
}: {
  isActive: boolean
  onNavigate: (id: SettingsSectionId) => void
}): React.JSX.Element {
  const sshServers = useSshServers((s) => s.servers)
  const [sshDraft, setSshDraft] = useState<SshServer | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void useSshServers.getState().hydrate()
  }, [])

  // Import named hosts from ~/.ssh/config. Dedupe against saved servers by user@host:port and
  // skip hosts without a User (can't form a usable connection); the user can add those by hand.
  const importFromConfig = async () => {
    // Surface a clear message in every case — a silent no-op (e.g. the IPC bridge missing
    // because the app wasn't restarted after an update) is worse than an error.
    if (typeof window.nodeTerminal.ssh.importCandidates !== 'function') {
      setImportMsg('Import unavailable — fully quit and reopen the app to load the update.')
      return
    }
    setImportMsg('Importing…')
    try {
      const key = (s: { user?: string; host: string; port?: number }) =>
        `${s.user ?? ''}@${s.host}:${s.port ?? 22}`
      const candidates = await window.nodeTerminal.ssh.importCandidates()
      const withUser = candidates.filter((c) => c.user)
      const skipped = candidates.length - withUser.length
      const seen = new Set(useSshServers.getState().servers.map(key))
      const fresh = withUser.filter((c) => !seen.has(key(c)))
      for (const c of fresh) {
        await useSshServers.getState().save({
          id: uuid(),
          label: c.label,
          host: c.host,
          user: c.user as string,
          port: c.port,
          identityFile: c.identityFile
        })
      }
      setImportMsg(
        candidates.length === 0
          ? 'No hosts found in ~/.ssh/config'
          : `${fresh.length ? `Imported ${fresh.length} server${fresh.length === 1 ? '' : 's'}` : 'No new servers to import'}${
              skipped ? ` · skipped ${skipped} without a user` : ''
            }`
      )
    } catch (err) {
      setImportMsg(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const saveDisabled =
    !sshDraft || !sshDraft.label.trim() || !sshDraft.host.trim() || !sshDraft.user.trim()

  const saveDraft = async (manageAccounts: boolean): Promise<void> => {
    if (!sshDraft || saveDisabled) return
    await useSshServers.getState().save({
      ...sshDraft,
      remoteCwd: sshDraft.remoteCwd?.trim() || '~'
    })
    setSshDraft(null)
    setTestMsg(null)
    if (manageAccounts) onNavigate('accounts')
  }

  const testConnection = async (): Promise<void> => {
    if (!sshDraft || saveDisabled || testing) return
    const connectionId = `ssh-settings-test-${sshDraft.id}`
    setTesting(true)
    setTestMsg(`Connecting to ${sshDraft.label}…`)
    try {
      await window.nodeTerminal.sshProject.connect(
        connectionId,
        sshDraft,
        sshDraft.remoteCwd?.trim() || '~'
      )
      setTestMsg('Connection successful. NodeTerm and Codex are available on this machine.')
    } catch (error) {
      setTestMsg(`Connection failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await window.nodeTerminal.sshProject.disconnect(connectionId).catch(() => {})
      setTesting(false)
    }
  }

  return (
    <SettingsSection
      id="ssh"
      title="Remote machines (SSH)"
      description="Add a machine once, then run terminals and isolated Codex accounts on it from any local canvas."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.servers}>
        <div className="space-y-4">
          {sshServers.map((server) => (
            <div
              key={server.id}
              className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-text">
                  {server.label} — {server.user}@{server.host}
                  {server.port && server.port !== 22 ? `:${server.port}` : ''}
                </div>
                <div className="truncate text-xs text-muted">
                  Default folder: {server.remoteCwd || '~'}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button onClick={() => onNavigate('accounts')}>Accounts</Button>
                <Button
                  onClick={() => {
                    setTestMsg(null)
                    setSshDraft(server)
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => void useSshServers.getState().remove(server.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}

          {sshDraft ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <FieldRow
                label="Label"
                control={
                  <Input
                    className="w-56"
                    placeholder="e.g. Prod box"
                    value={sshDraft.label}
                    onChange={(e) => setSshDraft({ ...sshDraft, label: e.target.value })}
                  />
                }
              />
              <FieldRow
                label="Host"
                control={
                  <Input
                    className="w-56"
                    placeholder="e.g. example.com"
                    value={sshDraft.host}
                    onChange={(e) => setSshDraft({ ...sshDraft, host: e.target.value })}
                  />
                }
              />
              <FieldRow
                label="User"
                control={
                  <Input
                    className="w-56"
                    placeholder="e.g. root"
                    value={sshDraft.user}
                    onChange={(e) => setSshDraft({ ...sshDraft, user: e.target.value })}
                  />
                }
              />
              <FieldRow
                label="Port"
                control={
                  <Input
                    className="w-24"
                    type="number"
                    value={sshDraft.port ?? 22}
                    onChange={(e) =>
                      setSshDraft({ ...sshDraft, port: Number(e.target.value) || 22 })
                    }
                  />
                }
              />
              <FieldRow
                label="Default working directory"
                description="Folder used by new terminals and Codex nodes on this machine."
                control={
                  <Input
                    className="w-72 font-mono"
                    placeholder="~/projects/my-project"
                    value={sshDraft.remoteCwd ?? '~'}
                    onChange={(e) => setSshDraft({ ...sshDraft, remoteCwd: e.target.value })}
                  />
                }
              />
              <FieldRow
                label="Identity file"
                description="Optional private key passed with -i."
                control={
                  <div className="flex gap-2">
                    <Input
                      className="w-56"
                      placeholder="~/.ssh/id_ed25519"
                      value={sshDraft.identityFile ?? ''}
                      onChange={(e) => setSshDraft({ ...sshDraft, identityFile: e.target.value })}
                    />
                    <Button
                      onClick={async () => {
                        const file = await window.nodeTerminal.dialog.selectFile()
                        if (file) setSshDraft({ ...sshDraft, identityFile: file })
                      }}
                    >
                      Choose…
                    </Button>
                  </div>
                }
              />
              <FieldRow
                label="Extra ssh args"
                description="Optional advanced flags, e.g. -o StrictHostKeyChecking=no."
                control={
                  <Input
                    className="w-56"
                    placeholder="(optional)"
                    value={sshDraft.extraArgs ?? ''}
                    onChange={(e) => setSshDraft({ ...sshDraft, extraArgs: e.target.value })}
                  />
                }
              />
              {testMsg ? <p className="text-xs text-muted">{testMsg}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setSshDraft(null)}>
                  Cancel
                </Button>
                <Button disabled={saveDisabled || testing} onClick={() => void testConnection()}>
                  {testing ? 'Testing…' : 'Test connection'}
                </Button>
                <Button disabled={saveDisabled} onClick={() => void saveDraft(false)}>
                  Save
                </Button>
                <Button
                  variant="primary"
                  disabled={saveDisabled}
                  onClick={() => void saveDraft(true)}
                >
                  Save &amp; manage accounts
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                onClick={() =>
                  setSshDraft({
                    id: uuid(),
                    label: '',
                    host: '',
                    user: '',
                    port: 22,
                    remoteCwd: '~'
                  })
                }
              >
                Add server
              </Button>
              <Button variant="ghost" onClick={() => void importFromConfig()}>
                Import from ~/.ssh/config
              </Button>
              {importMsg && <span className="text-xs text-muted">{importMsg}</span>}
            </div>
          )}
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
