import { useEffect, useState } from 'react'
import { Button as Md3Button } from '@renderer/ui/md3'
import type { ClaudeAccount, CodexAccount } from '@shared/types'
import { sshAttachmentId, sshHostKey } from '@shared/ssh'
import { useSettings } from '../../../state/settings'
import { useSystemAccount } from '../../../state/systemAccount'
import { useSystemCodexAccount } from '../../../state/systemCodexAccount'
import { isAccountLoginNode, isCodexAccountLoginNode, NODE_COLORS } from '../../../state/workspace'
import { useProjects } from '../../../state/projects'
import { useSshConn } from '../../../state/sshConn'
import { useSshServers } from '../../../state/sshServers'
import { kidsDestructiveGateRequired } from '../../../state/kidsMode'
import { openDestructiveGate } from '../../../state/destructiveGate'
import {
  ACCOUNT_REMOVAL_COMMITTED_EVENT,
  ACCOUNT_REMOVAL_SCOPE_EVENT,
  ACCOUNT_REMOVAL_TEARDOWN_EVENT,
  accountRemovalNodeTargetIdentity,
  accountRemovalTargetIdentity,
  dispatchAccountRemoval,
  planAccountRemoval,
  requestAccountRemovalTeardown,
  requestAccountRemovalScope,
  type AccountRemovalTeardownDetail,
  type AccountRemovalDispatchDeps
} from '../../../lib/accountRemoval'
import { nodeDeletionTargetIncarnation } from '../../../lib/nodeDeletion'
import {
  createDestructiveCommitBarrier,
  type DestructiveAuthorization
} from '../../../lib/destructiveAuthorization'
import { E_UNSUPPORTED } from '@shared/rpc'
import { presentAccount, type AccountPresentation } from '../../../lib/accountPresentation'
import { codexAccountSelectable } from '../../../canvas/codex-account-switch'
import { AccountIdentityPills } from '../../AccountIdentityPills'
import { ConfirmDialog } from '../../ConfirmDialog'
import { SettingsSection } from '../SettingsSection'
import { SettingsText } from '../SettingsText'
import { SearchableRow } from '../SearchableRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { cn } from '@renderer/ui/cn'
import { useVocabularyMapper } from '../../../lib/personalVocabulary/useVocabularyText'
import { Chip } from '@renderer/ui/md3'
import { mapBuiltinAgentLabel } from '../../../lib/personalVocabulary/agentLabel'

const ROWS = {
  accounts: {
    title: 'Agent accounts',
    keywords: [
      'account',
      'claude',
      'codex',
      'openai',
      'chatgpt',
      'login',
      'isolated',
      'multi',
      'email',
      'usage'
    ]
  },
  codex: {
    title: 'Codex accounts',
    keywords: ['account', 'codex', 'openai', 'login', 'isolated', 'multi', 'email', 'machine', 'ssh']
  }
}
const ENTRIES = Object.values(ROWS)

/** The bridge's "this shell registers no such handler" rejection (renderer/bridge/stubs.ts). It is
 *  a fact about the SURFACE, not about this account — worth a different sentence than a failure. */
const isUnsupported = (e: unknown): boolean =>
  !!e && typeof e === 'object' && (e as { code?: string }).code === E_UNSUPPORTED

/** `addingOn` sentinel for the local button — a host key can never be this. */
const LOCAL_TARGET = ''

type PlainAccountRemovalRequest = Parameters<AccountRemovalDispatchDeps['openConfirm']>[0]
interface PendingAccountRemoval {
  request: PlainAccountRemovalRequest
}
/** Spinner + label for an Add button that is mid-setup. */
function AddingLabel({ where }: { where: string }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return (
    <span className="inline-flex items-center gap-2">
      <span className="ui-spinner" aria-hidden />
      <>{vocab('Setting up on')} {where}…</>
    </span>
  )
}

function MachinePanel({
  label,
  endpoint,
  remote,
  connected = true,
  children
}: {
  label: string
  endpoint?: string
  remote: boolean
  connected?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-fill-weak/20">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-fill-weak/40 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-[color:var(--success)]' : 'bg-muted'}`}
            aria-label={vocab(connected ? 'Connected' : 'Not connected')}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-semibold text-text">{label}</span>
              <span className="rounded-full bg-fill-weak px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                {remote ? 'SSH' : 'Local'}
              </span>
            </div>
            {endpoint ? (
              <p className="truncate text-[11px] text-muted" title={endpoint}>
                {endpoint}
              </p>
            ) : null}
          </div>
        </div>
      </header>
      <div>{children}</div>
    </section>
  )
}

function ProviderSection({
  provider,
  addLabel,
  adding,
  disabled,
  onAdd,
  children
}: {
  provider: 'Claude' | 'Codex'
  addLabel: string
  adding: boolean
  disabled?: boolean
  onAdd: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const displayProvider = mapBuiltinAgentLabel(vocab, provider.toLowerCase(), provider)
  return (
    <section className="border-t border-border first:border-t-0">
      <header className="flex items-center justify-between gap-3 bg-fill-weak/15 px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          {displayProvider}
        </span>
        <Button variant="primary" disabled={disabled || adding} onClick={onAdd}>
          {adding ? <AddingLabel where={displayProvider} /> : addLabel}
        </Button>
      </header>
      <div className="divide-y divide-border border-t border-border">{children}</div>
    </section>
  )
}

function AccountRow({
  presentation,
  email,
  pending = false,
  unavailable = false,
  actions,
  details,
  labelControl
}: {
  presentation: AccountPresentation
  email?: string | null
  pending?: boolean
  unavailable?: boolean
  actions?: React.ReactNode
  details?: React.ReactNode
  labelControl?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 bg-bg px-3 py-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <AccountIdentityPills account={presentation} />
          {pending ? (
            <span className="rounded-full bg-[color:var(--warn)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--warn)]">
              pending
            </span>
          ) : null}
        </div>
        {email && email !== presentation.identity ? (
          <p className="truncate text-[12px] text-muted">{email}</p>
        ) : null}
        {labelControl}
        {unavailable ? (
          <p className="text-[12px] text-muted"><SettingsText>Not logged in or unavailable</SettingsText></p>
        ) : null}
        {details}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

function AccountColorSwatches({
  account,
  onChange
}: {
  account: { id: string; label: string; color?: string }
  onChange: (id: string, color?: string) => void
}): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={`Default node color for ${account.label}`}
      className="flex flex-wrap items-center gap-2 pt-1"
    >
      <span className="text-[12px] text-muted">Node color</span>
      <Chip vocabularyMode="factual" selected={!account.color}
       
        aria-label="Default"
        aria-pressed={!account.color}
        title="Use the agent's own color"
        onClick={() => onChange(account.id, undefined)}
        className={cn(
          'flex size-5 items-center justify-center rounded-full border-2 text-[11px] text-muted',
          account.color ? 'border-transparent bg-fill-weak' : 'border-text bg-fill-weak'
        )}
      >
        ×
      </Chip>
      {NODE_COLORS.map((color) => (
        <Chip vocabularyMode="factual" selected={account.color === color}
          key={color}
         
          aria-label={color}
          aria-pressed={account.color === color}
          title={`Use ${color}`}
          onClick={() => onChange(account.id, color)}
          style={{ background: color }}
          className={cn(
            'size-5 rounded-full border-2',
            account.color === color ? 'border-text' : 'border-transparent'
          )} />
      ))}
    </div>
  )
}

/** Reads fresh settings then applies a transform to the accounts list (avoids stale closures
 *  after an awaited login resolves late). */
function applyAccounts(fn: (accs: ClaudeAccount[]) => ClaudeAccount[]): void {
  const s = useSettings.getState()
  s.update({ claudeAccounts: fn(s.settings.claudeAccounts) })
}

/** Exact serialized bindings disclosed with an account removal, sorted for stable comparison. */
function affectedNodesUsing(accountId: string): string[] | null {
  const state = useProjects.getState()
  const live = requestAccountRemovalScope(accountId, (detail) =>
    window.dispatchEvent(new CustomEvent(ACCOUNT_REMOVAL_SCOPE_EVENT, { detail }))
  )
  if (!live) return null
  return [
    ...state.projects
      .filter((project) => project.id !== state.activeProjectId)
      .flatMap((project) =>
      project.nodes
        .filter((node) => node.accountId === accountId)
        .map((node) =>
          accountRemovalNodeTargetIdentity({
            projectId: project.id,
            id: node.id,
            type: node.kind,
            title: node.title,
            accountId: node.accountId,
            accountLogin: node.accountLogin === true,
            incarnation: nodeDeletionTargetIncarnation(node)
          })
        )
      ),
    ...live
  ].sort()
}

/** The same fresh-read/transform for the Codex account list. */
function applyCodexAccounts(fn: (accs: CodexAccount[]) => CodexAccount[]): void {
  const s = useSettings.getState()
  s.update({ codexAccounts: fn(s.settings.codexAccounts) })
}

function AccountColorSwatches({
  label,
  color,
  onPick
}: {
  label: string
  color?: string
  onPick: (color?: string) => void
}): React.JSX.Element {
  return (
    <div role="group" aria-label={`Default node colour for ${label}`} className="flex flex-wrap items-center gap-2 pt-1">
      <span className="text-[12px] text-muted">Node colour</span>
      <button
        type="button"
        aria-label="Default agent colour"
        aria-pressed={!color}
        title="Use the agent's own colour"
        onClick={() => onPick(undefined)}
        className={cn(
          'flex size-5 items-center justify-center rounded-full border-2 text-[11px] text-muted',
          color ? 'border-transparent bg-fill-weak' : 'border-text bg-fill-weak'
        )}
      >
        ×
      </button>
      {NODE_COLORS.map((swatch) => (
        <button
          key={swatch}
          type="button"
          aria-label={`Node colour ${swatch}`}
          aria-pressed={color === swatch}
          title={`Use ${swatch} for new nodes`}
          onClick={() => onPick(swatch)}
          style={{ background: swatch }}
          className={cn('size-5 rounded-full border-2', color === swatch ? 'border-text' : 'border-transparent')}
        />
      ))}
    </div>
  )
}

function captureCodexIdentity(id: string, captured: { email: string | null }): void {
  applyCodexAccounts((accs) =>
    accs.map((a) =>
      a.id === id
        ? {
            ...a,
            label: a.label === 'New Codex account' && captured.email ? captured.email : a.label,
            email: captured.email ?? undefined,
            pending: false
          }
        : a
    )
  )
}

/** Counts nodes bound to an account across every project's SERIALIZED nodes. The active
 *  project's live React Flow edits since the last commit aren't reflected here, so the count
 *  can be slightly stale for the active canvas — acceptable for a confirmation warning. */
function countNodesUsing(accountId: string): number {
  return useProjects
    .getState()
    .projects.reduce(
      (sum, p) => sum + p.nodes.filter((n) => n.accountId === accountId).length,
      0
    )
}

export function AccountsSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const accounts = useSettings((s) => s.settings.claudeAccounts)
  const codexAccounts = useSettings((s) => s.settings.codexAccounts)
  const systemLabelSetting = useSettings((s) => s.settings.systemAccountLabel)
  const systemCodexLabelSetting = useSettings((s) => s.settings.systemCodexAccountLabel)
  const remoteSystemAccountLabels = useSettings((s) => s.settings.remoteSystemAccountLabels)
  const remoteSystemCodexAccountLabels = useSettings(
    (s) => s.settings.remoteSystemCodexAccountLabels
  )
  const systemEmail = useSystemAccount((s) => s.email)
  const systemCodexEmail = useSystemCodexAccount((s) => s.email)
  useEffect(() => useSystemAccount.getState().ensure(), [])
  useEffect(() => useSystemCodexAccount.getState().ensure(), [])
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const activeProject = useProjects((s) => s.projects.find((p) => p.id === activeProjectId))
  // The active project's SSH host key (`user@host`), when it's a connected SSH project. Present →
  // the "Add account" control also offers adding an account ON that host.
  const activeHostKey = activeProject?.ssh ? sshHostKey(activeProject.ssh.server) : undefined
  // Subscribe to live SSH connections so a remote account's Retry button enables/disables as its
  // host connects/disconnects while this panel is open.
  const sshByProject = useSshConn((s) => s.byProject)
  const sshServers = useSshServers((s) => s.servers)
  useEffect(() => {
    void useSshServers.getState().hydrate()
  }, [])
  const [versionWarning, setVersionWarning] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<PendingAccountRemoval | null>(null)
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [pendingCodexRemove, setPendingCodexRemove] = useState<CodexAccount | null>(null)
  const [addingCodexOn, setAddingCodexOn] = useState<string | null>(null)
  const [codexAddError, setCodexAddError] = useState<string | null>(null)
  const remoteSystemCodexEmails = useSystemCodexAccount((s) => s.remoteEmails)
  /**
   * Which "Add account" button is mid-setup: the host key, or LOCAL_TARGET for this machine.
   * Minting a REMOTE account is 10–15 s of real work on the host — mkdir, merging the status hook
   * into the account dir's settings.json, installing the canvas-control + context-link skills, and
   * a `claude --version` through a login shell — and until this state existed the button simply
   * sat there, so the click read as "nothing happened" until the login node appeared.
   */
  const [addingOn, setAddingOn] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const codexRemoteTargets = [
    ...new Map(
      [
        ...sshServers,
        ...(activeProject?.ssh
          ? [
              {
                ...activeProject.ssh.server,
                id: activeHostKey!,
                label: activeHostKey!
              }
            ]
          : [])
      ].map((server) => [sshHostKey(server), server])
    ).entries()
  ]
  const presentationFor = (
    label: string | undefined,
    email: string | null | undefined,
    host?: string
  ): AccountPresentation => {
    const server = host ? sshServers.find((entry) => sshHostKey(entry) === host) : undefined
    return presentAccount({ label, email, host, machineLabel: server?.label })
  }

  // A login may finish just before an app restart, or its terminal may close before the settings
  // waiter updates the row. Reconcile only credential files that already exist and whose
  // account/read succeeds; no login UI and no five-minute poll are started here.
  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    let retryTimer: number | null = null
    const reconcile = async (): Promise<void> => {
      const pending = codexAccounts.filter((account) => account.pending)
      if (pending.length === 0) return
      const captured = await Promise.all(
        pending.map(async (account) => ({
          account,
          identity: await (async () => {
            const projectId = account.host ? await ensureHostConnection(account.host) : undefined
            return window.nodeTerminal.codexAccounts.identity(
              account.id,
              projectId ? { projectId } : undefined
            )
          })().catch(() => null)
        }))
      )
      if (cancelled) return
      let resolved = false
      for (const result of captured) {
        if (!result.identity) continue
        resolved = true
        captureCodexIdentity(result.account.id, result.identity)
      }
      // A daemon can still be coming up when Settings opens. Keep healing the persisted pending
      // marker while the section is visible; a successful capture changes settings and reruns us.
      if (!resolved) retryTimer = window.setTimeout(() => void reconcile(), 2000)
    }
    void reconcile()
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [isActive, codexAccounts])

  const setLabel = (id: string, label: string): void =>
    applyAccounts((accs) => accs.map((a) => (a.id === id ? { ...a, label } : a)))

  const setColor = (id: string, color?: string): void =>
    applyAccounts((accs) =>
      accs.map((account) =>
        account.id === id
          ? color === undefined
            ? { ...account, color: undefined }
            : { ...account, color }
          : account
      )
    )

  const setCodexLabel = (id: string, label: string): void =>
    applyCodexAccounts((accs) => accs.map((a) => (a.id === id ? { ...a, label } : a)))

  const setCodexColor = (id: string, color?: string): void =>
    applyCodexAccounts((accs) =>
      accs.map((account) =>
        account.id === id
          ? color === undefined
            ? { ...account, color: undefined }
            : { ...account, color }
          : account
      )
    )

  const setRemoteSystemLabel = (
    provider: 'claude' | 'codex',
    host: string,
    label: string
  ): void => {
    const settings = useSettings.getState().settings
    if (provider === 'claude') {
      useSettings.getState().update({
        remoteSystemAccountLabels: {
          ...settings.remoteSystemAccountLabels,
          [host]: label
        }
      })
      return
    }
    useSettings.getState().update({
      remoteSystemCodexAccountLabels: {
        ...settings.remoteSystemCodexAccountLabels,
        [host]: label
      }
    })
  }

  const setCodexRemoteCwd = (id: string, remoteCwd: string): void =>
    applyCodexAccounts((accs) => accs.map((a) => (a.id === id ? { ...a, remoteCwd } : a)))

  const ensureHostConnection = async (host: string): Promise<string | undefined> => {
    const existing = projectIdForHost(host)
    const server = useSshServers.getState().servers.find((entry) => sshHostKey(entry) === host)
    const ownerProjectId = useProjects.getState().activeProjectId
    if (!server || !ownerProjectId) return undefined
    // A renderer entry only says that this UI observed a connection. It is not proof that the
    // main-process manager still owns the ControlMaster or that a connection created before the
    // current app build has the full Codex runtime metadata. Re-enter connect() idempotently on
    // the SAME scope before every account lifecycle operation; the manager reuses a healthy
    // master and repairs/bootstrap-checks anything incomplete.
    const connectionId = existing ?? sshAttachmentId(ownerProjectId, server)
    const remoteCwd = server.remoteCwd || '~'
    const info = await window.nodeTerminal.sshProject.connect(connectionId, server, remoteCwd)
    useSshConn.getState().setConn(connectionId, {
      ...info,
      hostKey: host,
      conn: server,
      remoteCwd,
      ownerProjectId
    })
    return connectionId
  }

  useEffect(() => {
    if (!isActive || codexRemoteTargets.length === 0) return
    let cancelled = false
    void Promise.all(
      codexRemoteTargets.map(async ([host]) => {
        const projectId = await ensureHostConnection(host).catch(() => undefined)
        if (!cancelled && projectId) useSystemCodexAccount.getState().ensureRemote(host, projectId)
      })
    )
    return () => {
      cancelled = true
    }
  }, [isActive, sshServers, activeHostKey])

  const runCodexLogin = async (account: Pick<CodexAccount, 'id' | 'host'>): Promise<void> => {
    const projectId = account.host ? await ensureHostConnection(account.host) : undefined
    if (account.host && !projectId) return
    window.dispatchEvent(
      new CustomEvent('nodeterm:add-codex-account-login', {
        detail: {
          accountId: account.id,
          remote: !!account.host,
          host: account.host
        }
      })
    )
    const captured = await window.nodeTerminal.codexAccounts.waitLogin(
      account.id,
      projectId ? { projectId } : undefined
    )
    if (!captured) return
    captureCodexIdentity(account.id, captured)
  }

  const onAddCodexAccount = async (host?: string): Promise<void> => {
    if (addingCodexOn !== null) return
    setAddingCodexOn(host ?? LOCAL_TARGET)
    setCodexAddError(null)
    try {
      const projectId = host ? await ensureHostConnection(host) : undefined
      if (host && !projectId) throw new Error('SSH project is not connected')
      const added = await window.nodeTerminal.codexAccounts.add(
        projectId ? { projectId } : undefined
      )
      const account: CodexAccount = {
        id: added.id,
        label: 'New Codex account',
        pending: true,
        createdAt: Date.now(),
        ...(host
          ? {
              host,
              remoteCwd:
                useSshServers.getState().servers.find((server) => sshHostKey(server) === host)
                  ?.remoteCwd || '~'
            }
          : {})
      }
      applyCodexAccounts((accs) => [...accs, account])
      await runCodexLogin(account)
    } catch (error) {
      setCodexAddError(
        `Could not set up the Codex account: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setAddingCodexOn(null)
    }
  }

  const confirmRemoveCodex = async (account: CodexAccount): Promise<void> => {
    setPendingCodexRemove(null)
    // The active canvas can be newer than its debounced workspace snapshot. Query its live
    // nodes synchronously, then use persisted states only for the inactive projects. Otherwise a
    // node created immediately before opening Settings could be missed and its live CODEX_HOME
    // deleted underneath it.
    const live = { accountId: account.id, count: 0 }
    window.dispatchEvent(
      new CustomEvent('nodeterm:query-live-codex-account-use', {
        detail: live
      })
    )
    const inactiveNodeCount = useProjects
      .getState()
      .projects.filter((project) => project.id !== activeProjectId)
      .reduce(
        (count, project) =>
          count +
          project.nodes.filter(
            (node) => node.codexAccountId === account.id && !isCodexAccountLoginNode(node)
          ).length,
        0
      )
    const activeNodeCount = live.count + inactiveNodeCount
    if (activeNodeCount > 0) {
      setCodexAddError(
        `Switch or remove the ${activeNodeCount} Codex node${activeNodeCount === 1 ? '' : 's'} using this account first.`
      )
      return
    }
    if (account.pending) await window.nodeTerminal.codexAccounts.cancelWaitLogin(account.id)
    try {
      const projectId = account.host ? await ensureHostConnection(account.host) : undefined
      if (account.host && !projectId) throw new Error('SSH host unavailable')
      await window.nodeTerminal.codexAccounts.remove(
        account.id,
        projectId ? { projectId } : undefined
      )
    } catch {
      setCodexAddError(
        'Could not remove this Codex account. An account switch may still be in progress.'
      )
      return
    }
    applyCodexAccounts((accs) => accs.filter((a) => a.id !== account.id))
    useProjects.setState((s) => ({
      projects: s.projects.map((p) => ({
        ...p,
        nodes: p.nodes
          .filter((n) => !(n.codexAccountId === account.id && isCodexAccountLoginNode(n)))
          .map((n) => (n.codexAccountId === account.id ? { ...n, codexAccountId: undefined } : n))
      }))
    }))
    window.dispatchEvent(
      new CustomEvent('nodeterm:codex-account-removed', {
        detail: { accountId: account.id }
      })
    )
  }

  // The open project whose SSH host matches a remote account (needed for the ssh context of
  // waitLogin / remove). Undefined for local accounts, or when no such project is open.
  const projectIdForHost = (host?: string): string | undefined => {
    if (!host) return undefined
    const project = useProjects
      .getState()
      .projects.find(
        (p) => p.ssh && sshHostKey(p.ssh.server) === host && useSshConn.getState().byProject[p.id]
      )
    if (project) return project.id
    return Object.entries(useSshConn.getState().byProject).find(
      ([, info]) => info.hostKey === host
    )?.[0]
  }

  // A remote account can only log in on a CONNECTED matching-host project (live ControlMaster in
  // useSshConn). Undefined when the account is remote but no such project is currently connected —
  // Retry is then disabled so `claude /login` never runs against the local system account.
  const connectedProjectIdForHost = (host?: string): string | undefined => {
    const id = projectIdForHost(host)
    return id && sshByProject[id] ? id : undefined
  }

  // The presented account for a row, resolving the friendly machine label from saved servers.
  const presentCodex = (account: CodexAccount) => {
    const server = account.host
      ? sshServers.find((entry) => sshHostKey(entry) === account.host)
      : undefined
    return presentAccount({
      label: account.label,
      email: account.email,
      host: account.host,
      machineLabel: server?.label
    })
  }

  /** A machine's managed-account rows + the system row header. `remoteHost` set ⇒ that host. */
  const codexRowsFor = (
    accounts: readonly CodexAccount[],
    remoteHost?: string
  ): React.JSX.Element => {
    const systemEmail = remoteHost ? (remoteSystemCodexEmails[remoteHost] ?? null) : systemCodexEmail
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2">
          <AccountIdentityPills
            account={presentAccount({
              label: null,
              email: systemEmail,
              host: remoteHost,
              machineLabel: remoteHost
                ? sshServers.find((s) => sshHostKey(s) === remoteHost)?.label
                : undefined
            })}
          />
        </div>
        {accounts.map((account) => {
          // The SAME fail-closed gate the create/switch UI uses (§5 Property 4): an account that is
          // unsafe, missing, or a remote account with no live connection is not operable. Driving
          // the row's warning state through it (rather than an ad-hoc host check) makes
          // `codexAccountSelectable` a real reader and keeps one definition of "operable".
          const selectable = codexAccountSelectable(account.id, codexAccounts, (host) =>
            connectedProjectIdForHost(host)
          )
          const blockedReason = selectable.ok
            ? undefined
            : selectable.reason === 'no-connection'
              ? `Connect to ${account.host} to use this account`
              : 'This account is unavailable'
          return (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 p-2"
              title={blockedReason}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Input
                  className="w-48"
                  placeholder="Codex account label"
                  value={account.label}
                  onChange={(e) => setCodexLabel(account.id, e.target.value)}
                />
                <AccountIdentityPills account={presentCodex(account)} warning={!selectable.ok} />
                {account.pending ? (
                  <span className="rounded-full bg-[color:var(--warn)]/15 px-2 py-0.5 text-[11px] font-medium text-[color:var(--warn)]">
                    pending
                  </span>
                ) : null}
                <AccountColorSwatches account={account} onChange={setCodexColor} />
              </div>
              <Button
                variant="ghost"
                aria-label="Remove Codex account"
                onClick={() => setPendingCodexRemove(account)}
              >
                ×
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  // Open a login terminal for an account and wait (up to ~5 min) for the CLI to write its
  // credentials; on success flip the row out of `pending` and adopt the captured email. A remote
  // account (`host` set) logs in on its host: the login node runs in remote tmux and waitLogin polls
  // the remote `.claude.json` over ssh (via the ctx `projectId`).
  const runLogin = async (account: Pick<ClaudeAccount, 'id' | 'host'>): Promise<void> => {
    const remote = !!account.host
    const projectId = remote ? projectIdForHost(account.host) : undefined
    // Carry `host` so Canvas resolves the ssh binding BY HOST (among connected projects), not from
    // whatever project happens to be active when Retry fires.
    window.dispatchEvent(
      new CustomEvent('nodeterm:add-account-login', {
        detail: { accountId: account.id, remote, host: account.host }
      })
    )
    const captured = await window.nodeTerminal.claudeAccounts.waitLogin(
      account.id,
      projectId ? { projectId } : undefined
    )
    if (!captured) return // timeout / cancel: row stays pending, offers Retry
    applyAccounts((accs) =>
      accs.map((a) =>
        a.id === account.id
          ? {
              ...a,
              label: a.label === 'New account' ? captured.email : a.label,
              email: captured.email,
              pending: false
            }
          : a
      )
    )
  }

  // `host` set → create the account dir + hook ON that SSH host (via the ctx projectId); the row
  // then carries the host chip and only appears in that host's projects.
  const onAddAccount = async (host?: string): Promise<void> => {
    if (addingOn !== null) return // one setup at a time — the buttons are disabled, this is the guard
    const projectId = host ? await ensureHostConnection(host) : undefined
    if (host && !projectId) {
      setAddError(`Could not connect to ${host}.`)
      return
    }
    setAddingOn(host ?? LOCAL_TARGET)
    setAddError(null)
    let added: { id: string; versionSupported: boolean }
    try {
      added = await window.nodeTerminal.claudeAccounts.add(projectId ? { projectId } : undefined)
    } catch (e) {
      // The remote path does not reject on a failed setup (it answers with an empty configDir and
      // lets the login node report the connection error), so reaching here means the call itself
      // never landed. Say so: after a spinner, silence is the one outcome that teaches nothing.
      // E_UNSUPPORTED is a separate sentence because it is a fact about the surface, not this
      // account: the Server Edition serves these channels now, but a relay tab still refuses them
      // and so does a server binary older than that change.
      setAddError(
        isUnsupported(e)
          ? 'Managed Claude accounts are not available on this surface — manage them from the desktop app or the Server Edition directly.'
          : host
            ? `Could not set up an account on ${host}. Is the project still connected?`
            : 'Could not set up the account.'
      )
      return
    } finally {
      // Cleared before the login wait below: `runLogin` resolves only when the user finishes
      // logging in (up to 5 minutes), and a spinner running that long would claim the setup is
      // still going when the thing to do next is on the canvas.
      setAddingOn(null)
    }
    // Non-blocking: the account still isolates config, but an old CLI's unscoped macOS keychain
    // service would collide across accounts — surface a dismissable warning.
    if (!added.versionSupported) setVersionWarning(true)
    const account: ClaudeAccount = {
      id: added.id,
      label: 'New account',
      pending: true,
      createdAt: Date.now(),
      ...(host ? { host } : {})
    }
    applyAccounts((accs) => [...accs, account])
    await runLogin(account)
  }

  const performRemove = async (account: ClaudeAccount): Promise<void> => {
    try {
      const projectId = projectIdForHost(account.host)
      await window.nodeTerminal.claudeAccounts.remove(
        account.id,
        projectId ? { projectId } : undefined
      )
      applyAccounts((accs) => accs.filter((a) => a.id !== account.id))
      // Clear the account off serialized nodes (all projects) + any project default. Login nodes
      // are dropped rather than kept account-less; ordinary nodes fall back on their next start.
      useProjects.setState((s) => ({
        projects: s.projects.map((p) => ({
          ...p,
          ...(p.defaultAccountId === account.id ? { defaultAccountId: undefined } : {}),
          nodes: p.nodes
            .filter((n) => !(n.accountId === account.id && isAccountLoginNode(n)))
            .map((n) => (n.accountId === account.id ? { ...n, accountId: undefined } : n))
        }))
      }))
      // The async delete may have outlived a project switch. Canvas patches whichever project is
      // live now; inactive serialized projects were handled by the transform above.
      window.dispatchEvent(
        new CustomEvent(ACCOUNT_REMOVAL_COMMITTED_EVENT, {
          detail: { accountId: account.id }
        })
      )
    } catch {
      // Safer partial order: an approved login terminal may already be closed, but credentials,
      // the account record, defaults, and ordinary bindings all remain retryable.
      setRemoveError(
        `Could not remove “${account.label}”. Its active login terminal was closed, but the account and stored credentials were kept. Try again.`
      )
    } finally {
      setRemovingAccountId((current) => (current === account.id ? null : current))
    }
  }

  const beginApprovedRemove = (
    account: ClaudeAccount,
    authorization: DestructiveAuthorization,
    disclosedIdentity: string
  ): void => {
    setPendingRemove(null)
    setRemovingAccountId(account.id)
    setRemoveError(null)
    void (async () => {
      try {
        // Stop the pending poll before the final authorization boundary. No login node, credential,
        // account record, or binding is removed during this await.
        if (account.pending) await window.nodeTerminal.claudeAccounts.cancelWaitLogin(account.id)
      } catch {
        setRemoveError(`Could not prepare “${account.label}” for removal. Nothing was removed.`)
        setRemovingAccountId((current) => (current === account.id ? null : current))
        return
      }

      const finalCommit = createDestructiveCommitBarrier({
        disclosedIdentity,
        authorization,
        readCurrent: () => {
          const current = useSettings
            .getState()
            .settings.claudeAccounts.find((candidate) => candidate.id === account.id)
          const affected = current ? affectedNodesUsing(current.id) : null
          return current && affected
            ? {
                identity: accountRemovalTargetIdentity(current, affected),
                target: current,
                kidsGateRequired: kidsDestructiveGateRequired()
              }
            : null
        },
        perform: (current) => {
          // This dispatch is synchronous. Canvas closes/reconciles login nodes and invokes the
          // continuation before the credential removal call begins, leaving no awaited gap after
          // this final live target + policy check.
          const handled = requestAccountRemovalTeardown(
            current.id,
            authorization,
            () => void performRemove(current),
            (detail: AccountRemovalTeardownDetail) =>
              window.dispatchEvent(new CustomEvent(ACCOUNT_REMOVAL_TEARDOWN_EVENT, { detail }))
          )
          if (!handled) {
            setRemovingAccountId((value) => (value === current.id ? null : value))
            window.dispatchEvent(
              new CustomEvent('nodeterm:toast', {
                detail: {
                  kind: 'error',
                  message: `Could not close the active login session for “${current.label}”. The account was not removed.`
                }
              })
            )
          }
        },
        upgradeToTwoKey: (current) => {
          setRemovingAccountId((value) => (value === current.id ? null : value))
          requestRemove(current, null)
        },
        refuse: () => {
          setRemovingAccountId((current) => (current === account.id ? null : current))
          setRemoveError(
            'That account or its affected nodes changed before removal could commit. Nothing was removed; review it and try again.'
          )
        }
      })
      finalCommit()
    })()
  }

  const requestRemove = (account: ClaudeAccount, anchorEl: HTMLElement | null): boolean => {
    if (removingAccountId === account.id) return false
    const disclosedAccount = useSettings
      .getState()
      .settings.claudeAccounts.find((candidate) => candidate.id === account.id)
    if (
      !disclosedAccount ||
      accountRemovalTargetIdentity(disclosedAccount) !== accountRemovalTargetIdentity(account)
    ) {
      setRemoveError(
        'That account changed before its removal confirmation could open. Review it and try again.'
      )
      return false
    }
    const disclosedAffectedNodes = affectedNodesUsing(disclosedAccount.id)
    if (!disclosedAffectedNodes) {
      setRemoveError(
        'The active canvas could not be re-read, so account removal was not opened. Try again.'
      )
      return false
    }
    const disclosedIdentity = accountRemovalTargetIdentity(
      disclosedAccount,
      disclosedAffectedNodes
    )
    const plan = planAccountRemoval({
      label: disclosedAccount.label,
      affectedNodeCount: disclosedAffectedNodes.length,
      kidsModeOn: kidsDestructiveGateRequired()
    })
    const rect = anchorEl?.getBoundingClientRect()
    const barriers: Partial<Record<DestructiveAuthorization, () => unknown>> = {}
    const commit = (authorization: DestructiveAuthorization): void => {
      const barrier =
        barriers[authorization] ??
        createDestructiveCommitBarrier({
          disclosedIdentity,
          authorization,
          readCurrent: () => {
            const current = useSettings
              .getState()
              .settings.claudeAccounts.find((candidate) => candidate.id === disclosedAccount.id)
            const affected = current ? affectedNodesUsing(current.id) : null
            return current && affected
              ? {
                  identity: accountRemovalTargetIdentity(current, affected),
                  target: current,
                  kidsGateRequired: kidsDestructiveGateRequired()
                }
              : null
          },
          perform: (current) => beginApprovedRemove(current, authorization, disclosedIdentity),
          upgradeToTwoKey: (current) => {
            requestRemove(current, null)
          },
          refuse: () => {
            setRemoveError(
              'That account changed while the confirmation was open. Nothing was removed; review it and try again.'
            )
          }
        })
      barriers[authorization] = barrier
      barrier()
    }
    return dispatchAccountRemoval(plan, {
      perform: (authorization) => commit(authorization),
      openGate: (request) =>
        openDestructiveGate({
          ...request,
          anchor: rect ? { x: rect.left, y: rect.bottom } : undefined,
          restoreFocusEl: anchorEl
        }),
      openConfirm: (request) => {
        setPendingRemove({ request })
        return true
      }
    })
  }

  return (
    <SettingsSection
      id="accounts"
      title="Accounts"
      description="Isolated Claude and Codex logins. Codex accounts each reuse one shared app-server across their nodes."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.accounts}>
    <div className="space-y-4" data-easter-surface="account">
          {versionWarning ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 px-3 py-2 text-[13px] leading-relaxed text-[color:var(--danger)]">
              <span><SettingsText>Your installed Claude CLI is older than the version that scopes credentials per config dir. Accounts still isolate their config, but on macOS logins may collide in the shared keychain. Update the Claude CLI to keep them fully separate.</SettingsText></span>
              <Md3Button variant="text" size="small"
                onClick={() => setVersionWarning(false)}
              >
                <SettingsText>Dismiss</SettingsText>
              </Md3Button>
            </div>
          ) : null}

          <MachinePanel label="This Mac" remote={false}>
            <ProviderSection
              provider="Claude"
              addLabel="Add account"
              adding={addingOn === LOCAL_TARGET}
              disabled={addingOn !== null}
              onAdd={() => void onAddAccount()}
            >
              <AccountRow
                presentation={presentationFor(systemLabelSetting, systemEmail)}
                email={systemEmail}
                labelControl={
                <Input
                  className="w-56"
                  aria-label="Claude account display name"
                  placeholder="Display name (optional)"
                  value={systemLabelSetting}
                  onChange={(event) =>
                    useSettings.getState().update({ systemAccountLabel: event.target.value })
                  }
                />
              }
            />
            {accounts
              .filter((account) => !account.host)
              .map((account) => (
                <AccountRow
                key={account.id}
                presentation={presentationFor(account.label, account.email)}
                email={!account.pending ? account.email : undefined}
                pending={account.pending}
                labelControl={
                  <>
                    <Input
                      className="w-56"
                      placeholder="Display name"
                      value={account.label}
                      onChange={(event) => setLabel(account.id, event.target.value)}
                    />
                    <AccountColorSwatches account={account} onChange={setColor} />
                  </>
                  }
                  details={
                    <AccountColorSwatches label={account.label} color={account.color} onPick={(value) => setColor(account.id, value)} />
                  }
                  actions={
                    <>
                    {account.pending ? (
                      <Button onClick={() => void runLogin(account)}>Retry login</Button>
                    ) : null}
                  <Button
                    variant="ghost"
                    aria-label="Remove account"
                    disabled={removingAccountId === account.id}
                    onClick={(event) => requestRemove(account, event.currentTarget)}
                  >
                    ×
                  </Button>
                </>
              }
            />
          ))}
      </ProviderSection>
      <ProviderSection
        provider="Codex"
        addLabel="Add account"
        adding={addingCodexOn === LOCAL_TARGET}
        disabled={addingCodexOn !== null}
        onAdd={() => void onAddCodexAccount()}
      >
        <AccountRow
          presentation={presentationFor(systemCodexLabelSetting, systemCodexEmail)}
          email={systemCodexEmail}
          labelControl={
            <Input
              className="w-56"
              aria-label="Codex account display name"
              placeholder="Display name (optional)"
              value={systemCodexLabelSetting}
              onChange={(event) =>
                useSettings.getState().update({ systemCodexAccountLabel: event.target.value })
              }
            />
          }
        />
        {codexAccounts
          .filter((account) => !account.host)
          .map((account) => (
            <AccountRow
              key={account.id}
              presentation={presentationFor(account.label, account.email)}
              email={account.email}
              pending={account.pending}
              labelControl={
                <>
                <Input
                  className="w-56"
                  placeholder="Display name"
                  value={account.label}
                  onChange={(event) => setCodexLabel(account.id, event.target.value)}
                />
                <AccountColorSwatches account={account} onChange={setCodexColor} />
                </>
              }
              details={
                <AccountColorSwatches label={account.label} color={account.color} onPick={(value) => setCodexColor(account.id, value)} />
              }
              actions={
                <>
                  {account.pending ? (
                    <Button onClick={() => void runCodexLogin(account)}>Retry login</Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    aria-label="Remove Codex account"
                    onClick={() => setPendingCodexRemove(account)}
                  >
                    ×
                  </Button>
                </>
              }
            />
          ))}
      </ProviderSection>
    </MachinePanel>

    {codexRemoteTargets.map(([host, server]) => {
      const connected = !!connectedProjectIdForHost(host)
      return (
        <MachinePanel
          key={host}
          label={server.label || server.host}
          endpoint={`${server.user}@${server.host}`}
          remote
          connected={connected}
        >
          <ProviderSection
            provider="Claude"
            addLabel="Add account"
            adding={addingOn === host}
            disabled={addingOn !== null}
            onAdd={() => void onAddAccount(host)}
          >
            <AccountRow
              presentation={presentationFor(remoteSystemAccountLabels[host], undefined, host)}
              labelControl={
                <Input
                  className="w-56"
                      aria-label={`Claude account display name on ${server.label || server.host}`}
                      vocabularyMode="factual"
                  placeholder="Display name (optional)"
                  value={remoteSystemAccountLabels[host] ?? ''}
                  onChange={(event) =>
                    setRemoteSystemLabel('claude', host, event.target.value)
                  }
                />
              }
            />
            {accounts
              .filter((account) => account.host === host)
              .map((account) => (
                <AccountRow
                  key={account.id}
                  presentation={presentationFor(account.label, account.email, host)}
                  email={!account.pending ? account.email : undefined}
                  pending={account.pending}
                  labelControl={
                    <>
                    <Input
                      className="w-56"
                      placeholder="Display name"
                      value={account.label}
                      onChange={(event) => setLabel(account.id, event.target.value)}
                    />
                    <AccountColorSwatches account={account} onChange={setColor} />
                    </>
                  }
                  details={
                    <AccountColorSwatches label={account.label} color={account.color} onPick={(value) => setColor(account.id, value)} />
                  }
                  actions={
                    <>
                      {account.pending ? (
                        <Button
                          disabled={!connected || removingAccountId === account.id}
                          title={
                            !connected ? `Connect to ${host} to finish logging in` : undefined
                          }
                          onClick={() => void runLogin(account)}
                        >
                          Retry login
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        aria-label="Remove account"
                        disabled={removingAccountId === account.id}
                        onClick={(event) => requestRemove(account, event.currentTarget)}
                      >
                        ×
                      </Button>
                    </>
                  }
                />
              ))}
          </ProviderSection>
          <ProviderSection
            provider="Codex"
            addLabel="Add account"
            adding={addingCodexOn === host}
            disabled={addingCodexOn !== null}
            onAdd={() => void onAddCodexAccount(host)}
          >
            <AccountRow
              presentation={presentationFor(
                remoteSystemCodexAccountLabels[host],
                remoteSystemCodexEmails[host],
                host
          )}
          email={remoteSystemCodexEmails[host]}
          unavailable={!remoteSystemCodexEmails[host]}
          labelControl={
            <Input
              className="w-56"
              aria-label={`Codex account display name on ${server.label || server.host}`}
              vocabularyMode="factual"
              placeholder="Display name (optional)"
              value={remoteSystemCodexAccountLabels[host] ?? ''}
              onChange={(event) =>
                setRemoteSystemLabel('codex', host, event.target.value)
              }
            />
          }
        />
        {codexAccounts
          .filter((account) => account.host === host)
          .map((account) => (
            <AccountRow
              key={account.id}
              presentation={presentationFor(account.label, account.email, host)}
              email={account.email}
              pending={account.pending}
              labelControl={
                <>
                <Input
                  className="w-56"
                  placeholder="Display name"
                  value={account.label}
                  onChange={(event) => setCodexLabel(account.id, event.target.value)}
                />
                <AccountColorSwatches account={account} onChange={setCodexColor} />
                </>
              }
              details={
                <>
                  <AccountColorSwatches label={account.label} color={account.color} onPick={(value) => setCodexColor(account.id, value)} />
                <label className="mt-2 flex max-w-lg items-center gap-2 text-[11px] text-muted">
                  <span className="shrink-0 font-medium uppercase tracking-wide"><SettingsText>Working directory</SettingsText></span>
                  <Input
                    className="min-w-0 flex-1 font-mono"
                    aria-label={`${vocab('Remote working directory for ')}${account.label}`}
                    vocabularyMode="factual"
                    placeholder="~/nf-management"
                    value={account.remoteCwd ?? '~'}
                    onChange={(event) =>
                      setCodexRemoteCwd(account.id, event.target.value)
                    }
                  />
                </label>
                </>
              }
              actions={
                <>
                  {account.pending ? (
                    <Button
                      disabled={
                        !connected &&
                        !sshServers.some((entry) => sshHostKey(entry) === host)
                      }
                      onClick={() => void runCodexLogin(account)}
                    >
                      Retry login
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    aria-label="Remove Codex account"
                    onClick={() => setPendingCodexRemove(account)}
                  >
                    ×
                  </Button>
                </>
              }
            />
          ))}
      </ProviderSection>
    </MachinePanel>
  )
})}

              {addingOn !== null ? (
                <p className="text-[12px] leading-relaxed text-muted">
                  {addingOn === LOCAL_TARGET
                    ? 'Creating the local account directory and installing the status hook…'
                    : 'Preparing the account, status hook, and agent skills over SSH…'}
                </p>
              ) : null}
              {addError ? <p className="text-[12px] text-[color:var(--danger)]">{addError}</p> : null}
              {codexAddError ? (
                <p className="text-[12px] text-[color:var(--danger)]">{codexAddError}</p>
              ) : null}

              {removeError ? (
                <p className="text-[12px] leading-relaxed text-[color:var(--danger)]">{removeError}</p>
              ) : null}

          <p className="text-[12px] leading-relaxed text-muted"><SettingsText>Each login has its own credentials. Remote logins stay on their SSH machine. Codex nodes on the same machine and account reuse one shared app-server.</SettingsText></p>
        </div>
      </SearchableRow>

      {pendingRemove ? (
        <ConfirmDialog
          message={pendingRemove.request.message}
          confirmLabel="Remove"
          onConfirm={() => {
            const pending = pendingRemove
            setPendingRemove(null)
            // The request callback owns the live target + policy barrier. Keeping that decision
            // out of the component means a renamed/replaced account and a Kids transition are
            // tested as behavior rather than pinned by source text.
            pending.request.onConfirm()
          }}
          onCancel={() => {
            const cancel = pendingRemove.request.onCancel
            setPendingRemove(null)
            cancel?.()
          }}
        />
      ) : null}
      {pendingCodexRemove ? (
        <ConfirmDialog
          message={`Remove Codex account "${pendingCodexRemove.label}"? Its credentials and account-local conversations will be deleted.`}
          confirmLabel="Remove"
          onConfirm={() => void confirmRemoveCodex(pendingCodexRemove)}
          onCancel={() => setPendingCodexRemove(null)}
        />
      ) : null}
    </SettingsSection>
  )
}
