import { useEffect, useState } from 'react'
import type { ClaudeAccount } from '@shared/types'
import { sshHostKey } from '@shared/ssh'
import { useSettings } from '../../../state/settings'
import { useSystemAccount } from '../../../state/systemAccount'
import { isAccountLoginNode } from '../../../state/workspace'
import { useProjects } from '../../../state/projects'
import { useSshConn } from '../../../state/sshConn'
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
import { ConfirmDialog } from '../../ConfirmDialog'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'

const ROWS = {
  accounts: {
    title: 'Claude accounts',
    keywords: ['account', 'claude', 'login', 'isolated', 'multi', 'email']
  }
}
const ENTRIES = Object.values(ROWS)

/** `addingOn` sentinel for the local button — a host key can never be this. */
const LOCAL_TARGET = ''

type PlainAccountRemovalRequest = Parameters<AccountRemovalDispatchDeps['openConfirm']>[0]
interface PendingAccountRemoval {
  request: PlainAccountRemovalRequest
}

/** Spinner + label for an Add button that is mid-setup. */
function AddingLabel({ where }: { where: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="ui-spinner" aria-hidden />
      Setting up on {where}…
    </span>
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

export function AccountsSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const accounts = useSettings((s) => s.settings.claudeAccounts)
  const systemLabelSetting = useSettings((s) => s.settings.systemAccountLabel)
  const systemEmail = useSystemAccount((s) => s.email)
  useEffect(() => useSystemAccount.getState().ensure(), [])
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const activeProject = useProjects((s) => s.projects.find((p) => p.id === activeProjectId))
  // The active project's SSH host key (`user@host`), when it's a connected SSH project. Present →
  // the "Add account" control also offers adding an account ON that host.
  const activeHostKey = activeProject?.ssh ? sshHostKey(activeProject.ssh.server) : undefined
  // Subscribe to live SSH connections so a remote account's Retry button enables/disables as its
  // host connects/disconnects while this panel is open.
  const sshByProject = useSshConn((s) => s.byProject)
  const [versionWarning, setVersionWarning] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<PendingAccountRemoval | null>(null)
  const [removingAccountId, setRemovingAccountId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  /**
   * Which "Add account" button is mid-setup: the host key, or LOCAL_TARGET for this machine.
   * Minting a REMOTE account is 10–15 s of real work on the host — mkdir, merging the status hook
   * into the account dir's settings.json, installing the canvas-control + context-link skills, and
   * a `claude --version` through a login shell — and until this state existed the button simply
   * sat there, so the click read as "nothing happened" until the login node appeared.
   */
  const [addingOn, setAddingOn] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  const setLabel = (id: string, label: string): void =>
    applyAccounts((accs) => accs.map((a) => (a.id === id ? { ...a, label } : a)))

  // The open project whose SSH host matches a remote account (needed for the ssh context of
  // waitLogin / remove). Undefined for local accounts, or when no such project is open.
  const projectIdForHost = (host?: string): string | undefined => {
    if (!host) return undefined
    return useProjects.getState().projects.find((p) => p.ssh && sshHostKey(p.ssh.server) === host)?.id
  }

  // A remote account can only log in on a CONNECTED matching-host project (live ControlMaster in
  // useSshConn). Undefined when the account is remote but no such project is currently connected —
  // Retry is then disabled so `claude /login` never runs against the local system account.
  const connectedProjectIdForHost = (host?: string): string | undefined => {
    const id = projectIdForHost(host)
    return id && sshByProject[id] ? id : undefined
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
    if (addingOn) return // one setup at a time — the buttons are disabled, this is the guard
    const projectId = host ? projectIdForHost(host) : undefined
    setAddingOn(host ?? LOCAL_TARGET)
    setAddError(null)
    let added: { id: string; versionSupported: boolean }
    try {
      added = await window.nodeTerminal.claudeAccounts.add(projectId ? { projectId } : undefined)
    } catch {
      // The remote path does not reject on a failed setup (it answers with an empty configDir and
      // lets the login node report the connection error), so reaching here means the call itself
      // never landed. Say so: after a spinner, silence is the one outcome that teaches nothing.
      setAddError(
        host
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
      perform: commit,
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
      description="Isolated Claude logins. Each account has its own config dir, credentials, and transcripts; a node keeps the account it was created with for life."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.accounts}>
        <div className="space-y-4">
          {versionWarning ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-[color:var(--danger)]/40 bg-[color:var(--danger)]/10 px-3 py-2 text-[13px] leading-relaxed text-[color:var(--danger)]">
              <span>
                Your installed Claude CLI is older than the version that scopes credentials per
                config dir. Accounts still isolate their config, but on macOS logins may collide in
                the shared keychain. Update the Claude CLI to keep them fully separate.
              </span>
              <button
                className="shrink-0 cursor-pointer text-muted hover:text-text"
                onClick={() => setVersionWarning(false)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {/* The SYSTEM account (the machine's default ~/.claude login) is implicit — not a
              ClaudeAccount record — but gets a fixed row so it can be told apart from managed
              accounts: detected email as subtitle, renamable display label (empty = default). */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Input
                  className="w-56"
                  placeholder="System account"
                  value={systemLabelSetting}
                  onChange={(e) => useSettings.getState().update({ systemAccountLabel: e.target.value })}
                />
                <span
                  className="rounded-full bg-fill-weak px-2 py-0.5 text-[11px] font-medium text-muted"
                  title="The machine's default Claude login (~/.claude). Used when a node has no account."
                >
                  system
                </span>
              </div>
              {systemEmail ? <p className="text-[12px] text-muted">{systemEmail}</p> : null}
            </div>
          </div>

          {accounts.length === 0 ? null : (
            accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-56"
                      placeholder="Account label"
                      value={account.label}
                      onChange={(e) => setLabel(account.id, e.target.value)}
                    />
                    {account.pending ? (
                      <span className="rounded-full bg-[color:var(--warn)]/15 px-2 py-0.5 text-[11px] font-medium text-[color:var(--warn)]">
                        pending
                      </span>
                    ) : null}
                    {account.host ? (
                      <span
                        className="rounded-full bg-[color:var(--accent)]/15 px-2 py-0.5 text-[11px] font-medium text-[color:var(--accent)]"
                        title={`Remote account on ${account.host}`}
                      >
                        {account.host}
                      </span>
                    ) : null}
                  </div>
                  {account.email && !account.pending ? (
                    <p className="text-[12px] text-muted">{account.email}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {account.pending
                    ? (() => {
                        // A remote account can only retry login on a connected matching-host
                        // project; without one, disable Retry (a local spawn would log into the
                        // system account instead of the remote host).
                        const blocked = !!account.host && !connectedProjectIdForHost(account.host)
                        return (
                          <Button
                            disabled={blocked || removingAccountId === account.id}
                            title={
                              blocked
                                ? `Connect to ${account.host} to finish logging in`
                                : undefined
                            }
                            onClick={() => void runLogin(account)}
                          >
                            Retry login
                          </Button>
                        )
                      })()
                    : null}
                  <Button
                    variant="ghost"
                    aria-label="Remove account"
                    disabled={removingAccountId === account.id}
                    onClick={(event) => requestRemove(account, event.currentTarget)}
                  >
                    ×
                  </Button>
                </div>
              </div>
            ))
          )}

          {activeHostKey ? (
            // Inside an SSH project: choose where the new account lives. "On this Mac" is a normal
            // local account; "On <host>" creates it on the remote host (usable only there).
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={addingOn !== null}
                  onClick={() => void onAddAccount()}
                >
                  {addingOn === LOCAL_TARGET ? (
                    <AddingLabel where="this Mac" />
                  ) : (
                    'Add account — On this Mac'
                  )}
                </Button>
                <Button
                  variant="primary"
                  disabled={addingOn !== null}
                  onClick={() => void onAddAccount(activeHostKey)}
                >
                  {addingOn === activeHostKey ? (
                    <AddingLabel where={activeHostKey} />
                  ) : (
                    `Add account — On ${activeHostKey}`
                  )}
                </Button>
              </div>
              {/* A spinner says "wait"; this says what for. Setting up a remote account is a
                  handful of ssh round-trips plus a login-shell `claude --version`, so it takes
                  long enough that silence reads as a broken button. */}
              {addingOn !== null ? (
                <p className="text-[12px] leading-relaxed text-muted">
                  {addingOn === LOCAL_TARGET
                    ? 'Creating the config dir and installing the status hook…'
                    : `Creating the config dir on ${addingOn} and installing the status hook and agent skills over SSH — this takes a few seconds. The login terminal opens when it's ready.`}
                </p>
              ) : null}
              {addError ? <p className="text-[12px] text-[color:var(--danger)]">{addError}</p> : null}
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                variant="primary"
                disabled={addingOn !== null}
                onClick={() => void onAddAccount()}
              >
                {addingOn === LOCAL_TARGET ? <AddingLabel where="this Mac" /> : 'Add account'}
              </Button>
              {addingOn !== null ? (
                <p className="text-[12px] leading-relaxed text-muted">
                  Creating the config dir and installing the status hook…
                </p>
              ) : null}
              {addError ? <p className="text-[12px] text-[color:var(--danger)]">{addError}</p> : null}
            </div>
          )}

          {removeError ? (
            <p className="text-[12px] leading-relaxed text-[color:var(--danger)]">{removeError}</p>
          ) : null}

          <p className="text-[12px] leading-relaxed text-muted">
            Accounts are isolated Claude logins. New Claude nodes pick an account from the add
            menus; each node keeps its account for life. Remote accounts live on an SSH host and are
            only offered in that host&apos;s projects.
          </p>
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
    </SettingsSection>
  )
}
