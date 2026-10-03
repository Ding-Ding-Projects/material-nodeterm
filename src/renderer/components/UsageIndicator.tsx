import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClaudeUsage, ProviderUsage, RemoteAccountUsage, UsageLimit } from '@shared/types'
import { AGENT_CONFIG } from '@shared/agents/config'
import { useSettings } from '../state/settings'
import { useSystemCodexAccount } from '../state/systemCodexAccount'
import { useProjects } from '../state/projects'
import { useSshConn } from '../state/sshConn'
import { markWorkspaceDirty } from '../state/workspaceDirty'
import { dedupeProviderRows, providerRowKey, scopeFromKey, scopeUsage, usageScopeKey } from '../lib/usageScope'
import {
  barFillPercent,
  formatResetCountdown,
  formatTimeAgo,
  heldUsageText,
  percentNumber,
  percentText,
  severityColor,
  usageFailureText,
  type UsageTranslate
} from '../lib/usageFormat'
import { usageDiagnosticLines } from '../lib/usageDiagnostic'
import { UsageOrganization } from './UsageOrganization'
import { useI18n } from '../lib/i18n'
import {
  enabledProviders,
  hasAnyUsage,
  limitKey,
  limitLabel,
  limitShortLabel,
  primaryLimit,
  providerLabel
} from '@shared/usage-limits'
import { systemAccountDisplay } from '../state/workspace'
import { recordClaudeUsage } from '../lib/usageAccountRotation'
import { Button, Chip, IconButton } from '@renderer/ui/md3'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapBuiltinAgentLabel } from '../lib/personalVocabulary/agentLabel'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'

/** Grace period before a hover-opened popover closes, so the pointer can cross the pill's own
 *  gap (or clip a corner en route elsewhere) without the panel flickering shut. */
const USAGE_HOVER_CLOSE_MS = 220

/** How often the collapsed pill re-asks for a MANAGED default account's snapshot. Only the system
 *  account is polled + pushed by the service; the service caches managed reads for its own
 *  debounce, so a re-ask inside that window is free. */
const DEFAULT_ACCOUNT_POLL_MS = 5 * 60 * 1000

/**
 * A single limit row in the popover: bar, "% left"/"% used", reset countdown. The bar's fill
 * honours the display mode (`barFillPercent`) so it tracks the same quantity as the number
 * beside it; its color stays keyed to the TRUE remaining percentage via `severityColor`, so
 * severity red/yellow/green never flips meaning when the mode does.
 */
function LimitRow({ limit, mode }: { limit: UsageLimit; mode: 'used' | 'remaining' | 'tokens' }) {
  const left = 100 - limit.usedPercent
  const fill = barFillPercent(limit.usedPercent, mode)
  return (
    <span className="usage-row">
      <span className="usage-row__title">
        {limitLabel(limit.kind, limit.scopeLabel)}
        {/* The server flags which window is actually gating the account right now. */}
        {limit.isActive && <span className="usage-row__active" title="Currently limiting">●</span>}
      </span>
      <span className="usage-bar">
        <span
          className="usage-bar__fill"
          style={{ width: `${fill}%`, background: severityColor(limit.severity, left) }}
        />
      </span>
      <span className="usage-row__meta">
        <span>{percentText(limit.usedPercent, mode)}</span>
        <span>{formatResetCountdown(limit.resetsAt)}</span>
      </span>
    </span>
  )
}

/** Why the bars above are old — only for numbers kept through a failed read. */
function HeldNote({ u, tr }: { u: ClaudeUsage | null | undefined; tr: UsageTranslate }) {
  const text = u ? heldUsageText(u, tr) : null
  return text ? <span className="usage-popover__held">{text}</span> : null
}

/**
 * One account's limit bars under a label, for the multi-account popover. Reuses LimitRow's
 * markup — `u` is null while its on-demand fetch is in flight.
 */
function AccountUsageBlock({
  label,
  email,
  u,
  mode,
  accountId,
  selected,
  onSelect,
  selectable,
  tr,
  action
}: {
  label: string
  email?: string
  u: ClaudeUsage | null
  mode: 'used' | 'remaining' | 'tokens'
  accountId: string | undefined
  selected: boolean
  onSelect: (accountId: string | undefined) => void
  selectable: boolean
  tr: UsageTranslate
  /** An action that belongs to THIS account (the system row's "Switch Claude account…"). */
  action?: React.ReactNode
}) {
  // The live read names the identity that actually answered; the settings email is the fallback
  // while that read is in flight.
  const shownEmail = u?.email ?? email
  return (
    <div className="usage-account">
      <span className="usage-account__label">
        <span>{label}</span>
        {selected && <span className="usage-account__default" aria-hidden>✓</span>}
      </span>
      {shownEmail && <span className="usage-account__email">{shownEmail}</span>}
      <UsageOrganization organization={u?.organization} email={shownEmail} />
      {u?.limits.map((l) => (
        <LimitRow key={limitKey(l)} limit={l} mode={mode} />
      ))}
      <HeldNote u={u} tr={tr} />
      {u && u.limits.length === 0 && (
        <span className="usage-popover__empty">
          {u.status === 'error' ? usageFailureText(u, '', tr) : tr('usage.empty', 'No usage data.')}
        </span>
      )}
      {!u && <span className="usage-popover__empty usage-pill__pulse">···</span>}
      {action}
      {selectable && (
        <Chip vocabularyMode="factual" selected={selected}
         
          className="usage-account__select"
          role="radio"
          aria-checked={selected}
          aria-label={`Use ${label} for new sessions`}
          onClick={() => onSelect(accountId)}
        >
          Use for new sessions
        </Chip>
      )}
    </div>
  )
}

/**
 * One SSH host's Claude identity. Carries the host explicitly: the same subscription can be
 * logged in on the desktop and on two servers, and a row that only said "Claude" would be
 * indistinguishable from the local one sitting right above it.
 *
 * An 'unavailable' row is dropped exactly like an unused provider — a host where nobody has run
 * `claude` has nothing to report, and listing it would turn "connect an SSH project" into "grow
 * a permanent empty section".
 */
function RemoteUsageBlock({
  row,
  mode,
  accountId,
  selected,
  onSelect,
  selectable,
  tr
}: {
  row: Extract<RemoteAccountUsage, { provider?: 'claude' }>
  tr: UsageTranslate
  mode: 'used' | 'remaining' | 'tokens'
  accountId: string | undefined
  selected: boolean
  onSelect: (accountId: string | undefined) => void
  selectable: boolean
}) {
  if (row.usage.status === 'unavailable') return null
  const showHost = row.label !== row.hostKey
  return (
    <div className="usage-account">
      <span className="usage-account__label">
        <span>{row.label}</span>
        {selected && <span className="usage-account__default" aria-hidden>✓</span>}
        <span className="usage-account__host" title={`Read on ${row.hostKey} over SSH`}>
          {showHost ? row.hostKey : 'SSH'}
        </span>
      </span>
      {row.usage.email && <span className="usage-account__email">{row.usage.email}</span>}
      {row.usage.limits.map((l) => (
        <LimitRow key={limitKey(l)} limit={l} mode={mode} />
      ))}
      <HeldNote u={row.usage} tr={tr} />
      {row.usage.limits.length === 0 && (
        <span className="usage-popover__empty">
          {row.usage.status === 'error'
            ? usageFailureText(row.usage, 'on this host', tr)
            : tr('usage.empty', 'No usage data.')}
        </span>
      )}
      {selectable && (
        <Chip vocabularyMode="factual" selected={selected}
         
          className="usage-account__select"
          role="radio"
          aria-checked={selected}
          aria-label={`Use ${row.label} for new sessions`}
          onClick={() => onSelect(accountId)}
        >
          Use for new sessions
        </Chip>
      )}
    </div>
  )
}

/**
 * One non-Claude provider's section in the popover. Providers that aren't signed in report
 * 'unavailable' and are skipped entirely — showing an empty Codex row to someone who has never
 * run Codex is noise, not information. An 'error' provider IS shown, because that is a
 * configured provider failing and hiding it would make the popover flap between refreshes.
 */
/** AGENT_CONFIG is keyed by builtin ids; billing-only providers fall through to the shared table. */
function labelFor(provider: string): string {
  const agentLabel = (AGENT_CONFIG as Record<string, { label?: string } | undefined>)[provider]?.label
  return providerLabel(provider, agentLabel)
}

function ProviderBlock({
  u,
  mode,
  identity,
  hostKey,
  tr
}: {
  u: ProviderUsage
  mode: 'used' | 'remaining' | 'tokens'
  identity?: string | null
  /** Set for a row read on an SSH host (remote Codex): the badge says where the numbers came from. */
  hostKey?: string
  tr: UsageTranslate
}) {
  const vocab = useVocabularyMapper()
  if (u.status === 'unavailable') return null
  const label = mapBuiltinAgentLabel(vocab, u.provider, labelFor(u.provider))
  return (
    <div className="usage-account">
      <div className="usage-account__label">
        {label}
        {hostKey && (
          <span
            className="usage-account__host"
            title={tr('usage.remote.readOn', 'Read on {host} over SSH', { host: hostKey })}
          >
            {hostKey} · SSH
          </span>
        )}
      </div>
      {(identity || u.account) && (
        <div className="usage-account__email">{identity || u.account}</div>
      )}
      {u.limits.map((l) => (
        <LimitRow key={limitKey(l)} limit={l} mode={mode} />
      ))}
      {/* One line per distinct reason (issue #912): two views failing the same way are one
          failure of this provider, not two paragraphs of the same sentence. */}
      {usageDiagnosticLines(label, u.diagnostics, tr).map((line) => (
        <div className="usage-popover__empty" key={line}>
          {line}
        </div>
      ))}
      {u.limits.length === 0 && !u.diagnostics?.length && (
        <div className="usage-popover__empty">
          {u.status === 'error'
            ? tr('usage.failure.generic', 'Could not read usage.')
            : tr('usage.empty', 'No usage data.')}
        </div>
      )}
    </div>
  )
}

/**
 * Bottom-left Claude usage pill + popover. Renders to the right of the React Flow Controls.
 * States: hidden when 'unavailable'; '···' while first-fetching; '⚠' on error w/o data;
 * last-known data shown on stale/error. Compact pill = mini-bar + one "N% label" per limit,
 * e.g. "93% 5h · 39% wk · 13% Fable" — the bar tracks whichever limit is closest to biting.
 */
export function UsageIndicator({
  overBoard = false,
  onSetDefaultAccount
}: {
  overBoard?: boolean
  /** Existing Canvas call sites may provide the same persisted write path used by its menu. */
  onSetDefaultAccount?: (projectId: string, accountId: string | undefined) => void
}): JSX.Element | null {
  const mapVocabulary = useVocabularyMapper()
  const claudeLabel = mapBuiltinAgentLabel(mapVocabulary, 'claude')
  const { ts } = useI18n()
  const tr: UsageTranslate = ts
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [acctUsage, setAcctUsage] = useState<Record<string, ClaudeUsage | null>>({})
  const [providers, setProviders] = useState<ProviderUsage[]>([])
  const [remote, setRemote] = useState<RemoteAccountUsage[]>([])
  const accountSearch = useRegexSearchField({ mode: 'text' })
  const accountSearchInputRef = useRef<HTMLInputElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const suppressNextPillFocusRef = useRef(false)

  const claudeAccounts = useSettings((s) => s.settings.claudeAccounts)
  const codexAccounts = useSettings((s) => s.settings.codexAccounts)
  const systemCodexLabel = useSettings((s) => s.settings.systemCodexAccountLabel)
  const systemCodexEmail = useSystemCodexAccount((s) => s.email)
  const remoteSystemCodexEmails = useSystemCodexAccount((s) => s.remoteEmails)
  const systemLabelSetting = useSettings((s) => s.settings.systemAccountLabel)
  const hiddenProviders = useSettings((s) => s.settings.hiddenUsageProviders)
  const percentMode = useSettings((s) => s.settings.usagePercentMode)
  // Local logged-in accounts get their own popover row; skip pending logins + remote (host) ones.
  const accounts = useMemo(
    () => claudeAccounts.filter((a) => !a.pending && !a.host),
    [claudeAccounts]
  )
  useEffect(() => useSystemCodexAccount.getState().ensure(), [])

  // The indicator follows the ACTIVE project: on a local project it is this machine, on an SSH
  // project it is that host and nothing else. Showing every source at once is what made the panel
  // unreadable once remote hosts joined it.
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const defaultAccountId = useProjects((s) =>
    s.projects.find((p) => p.id === s.activeProjectId)?.defaultAccountId
  )
  const scopeHostKey = useProjects((s) =>
    usageScopeKey(s.projects.find((p) => p.id === s.activeProjectId))
  )
  const scope = useMemo(() => scopeFromKey(scopeHostKey), [scopeHostKey])

  useEffect(() => {
    void window.nodeTerminal.usage.fetch().then((next) => {
      setUsage(next)
      recordClaudeUsage(undefined, next)
    })
    return window.nodeTerminal.usage.onUpdate((next) => {
      setUsage(next)
      recordClaudeUsage(undefined, next)
    })
  }, [])

  // Fetched once on mount so default-account rotation has a current snapshot even before the
  // popover opens. The service caches subsequent reads, so opening the popover remains cheap. On
  // mount rather than popover-only because the pill itself
  // surfaces enabled providers now — and a provider the user has never signed into costs no
  // network call at all: every fetcher short-circuits to 'unavailable' on a missing credentials
  // file. So the price of asking is one failed read per unused provider, not five round-trips.
  useEffect(() => {
    let cancelled = false
    void window.nodeTerminal.usage.providers().then((ps) => {
      if (!cancelled) setProviders(ps)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  // Remote (SSH host) Claude accounts, for THIS project's host only. Same cadence as
  // `providers` — mount, popover open — plus the moment the project's connection comes up
  // (`sshUp`: an SSH project is usually opened before its master is ready, and without this the
  // pill stays empty until you click it). Never polled: each row is an ssh exec plus an HTTPS
  // request made on the host, which is not a price to pay every 15 minutes for a pill nobody may
  // be looking at.
  const sshConnection = useSshConn((s) => s.byProject[activeProjectId])
  const sshUp = !!sshConnection
  // The identity of the read a ⟳ starts with: a reply that lands after a project switch or a
  // reconnect belongs to a machine (or connection) the panel no longer describes, and is dropped.
  const remoteScope = useRef({ activeProjectId, scopeHostKey, sshConnection })
  if (
    remoteScope.current.activeProjectId !== activeProjectId ||
    remoteScope.current.scopeHostKey !== scopeHostKey ||
    remoteScope.current.sshConnection !== sshConnection
  ) {
    remoteScope.current = { activeProjectId, scopeHostKey, sshConnection }
  }
  useEffect(() => {
    if (!scopeHostKey || !sshUp) {
      // Leaving the rows up after a switch would attribute one machine's numbers to another.
      setRemote((prev) => (prev.length ? [] : prev))
      return
    }
    let cancelled = false
    void window.nodeTerminal.usage.remote({ hostKey: scopeHostKey }).then((rows) => {
      if (!cancelled) setRemote(rows)
    })
    return () => {
      cancelled = true
    }
  }, [open, scopeHostKey, sshUp, sshConnection])

  // Fetch each account's usage on demand when the popover opens (system row uses `usage`).
  // Skipped entirely on an SSH project: those identities are not what this project spends.
  useEffect(() => {
    if (scope.kind !== 'local' || accounts.length === 0) return
    let cancelled = false
    for (const a of accounts) {
      void window.nodeTerminal.usage.fetch(a.id).then((u) => {
        if (!cancelled) setAcctUsage((m) => ({ ...m, [a.id]: u }))
        recordClaudeUsage(a.id, u)
      })
    }
    return () => {
      cancelled = true
    }
  }, [accounts, scope.kind])

  // The project's "Use for new sessions" account, validated exactly as node creation validates
  // it (resolveNewNodeAccount): only an account THIS project can launch — local accounts on a
  // local project, that host's accounts on an SSH project — and never a pending login. A stale id
  // falls back to the system identity. The collapsed pill describes this identity.
  const eligibleAccounts = useMemo(
    () =>
      claudeAccounts.filter(
        (a) => !a.pending && (scopeHostKey ? a.host === scopeHostKey : !a.host)
      ),
    [claudeAccounts, scopeHostKey]
  )
  const pillDefaultId =
    defaultAccountId && eligibleAccounts.some((a) => a.id === defaultAccountId)
      ? defaultAccountId
      : undefined
  const pillDefaultLabel = eligibleAccounts.find((a) => a.id === pillDefaultId)?.label

  // The LOCAL managed default's snapshot, kept fresh while the popover is CLOSED too — the pill
  // spells it out. The mount-time read above is one-off; this re-asks on a slow cadence.
  const localDefaultId = scope.kind === 'local' ? pillDefaultId : undefined
  useEffect(() => {
    if (!localDefaultId) return
    let cancelled = false
    const load = (): void => {
      void window.nodeTerminal.usage.fetch(localDefaultId).then((u) => {
        if (!cancelled) setAcctUsage((m) => ({ ...m, [localDefaultId]: u }))
        recordClaudeUsage(localDefaultId, u)
      })
    }
    load()
    const timer = window.setInterval(load, DEFAULT_ACCOUNT_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [localDefaultId])

  // Close the popover on an outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current) }, [])

  // Hover opens it — the panel is a readout, so making the user click to see numbers they were
  // already looking at is a step for nothing. The popover renders INSIDE this container, so
  // travelling from the pill into it never leaves; only leaving the whole thing closes, and that
  // is delayed so a pointer clipping the corner on its way elsewhere doesn't snap it shut.
  const openNow = (): void => {
    if (suppressNextPillFocusRef.current) {
      suppressNextPillFocusRef.current = false
      return
    }
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
    setOpen(true)
  }
  const closeSoon = (): void => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => setOpen(false), USAGE_HOVER_CLOSE_MS)
  }

  const selectDefaultAccount = (accountId: string | undefined): void => {
    const projectId = useProjects.getState().activeProjectId
    if (!projectId) return
    if (useProjects.getState().getProject(projectId)?.defaultAccountId === accountId) return
    if (onSetDefaultAccount) {
      onSetDefaultAccount(projectId, accountId)
    } else {
      useProjects.getState().setProjectDefaultAccount(projectId, accountId)
      markWorkspaceDirty()
    }
  }

  const moveRadioFocus = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
    const current = radios.indexOf(event.target as HTMLButtonElement)
    if (current < 0 || radios.length < 2) return
    let next = current
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % radios.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (current - 1 + radios.length) % radios.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = radios.length - 1
    else return
    event.preventDefault()
    radios[next].focus()
    radios[next].click()
  }

  // Settings → Usage toggles are a display choice, applied before any other rule — a hidden
  // provider is invisible here even when signed in and mid-limit. Scoping runs after them: the
  // toggles say what you never want to see, the scope says what belongs to where you are.
  const hidden = new Set(hiddenProviders)
  const scoped = scopeUsage({
    scope,
    claude: hidden.has('claude') ? null : usage,
    accounts,
    providers: providers.filter((p) => !hidden.has(p.provider)),
    // Its own switch, not Claude's: hiding the local rows must not silently take the SSH hosts
    // down with them, and vice versa. A host's Codex rows follow the Codex switch.
    remote: remote.filter((r) => !hidden.has(r.provider === 'codex' ? 'codex' : 'claude-remote')),
    defaultAccountId: pillDefaultId,
    defaultUsage:
      localDefaultId && !hidden.has('claude') ? (acctUsage[localDefaultId] ?? null) : null
  })
  const claudeUsage = scoped.claude
  const visibleProviders = scoped.providers
  const visibleRemote = scoped.remote
  // A host's Claude identities and its Codex identities share the remote rows; only the Claude
  // ones can be a project's "Use for new sessions" account.
  const claudeRemote = visibleRemote.filter(
    (row): row is Extract<RemoteAccountUsage, { provider?: 'claude' }> => row.provider !== 'codex'
  )
  const codexRemote = visibleRemote.filter(
    (row): row is Extract<RemoteAccountUsage, { provider: 'codex' }> => row.provider === 'codex'
  )
  const remoteCodexUsages = new Set<ProviderUsage>(codexRemote.map((row) => row.usage))
  // A host's SYSTEM Codex row carries no account label; its identity is that host's own login,
  // resolved once per host and never borrowed from this machine (fail-closed to the host key).
  const hostSystemCodexShown =
    scope.kind === 'ssh' && sshUp && codexRemote.some((row) => row.accountId === null)
  useEffect(() => {
    if (hostSystemCodexShown && scope.kind === 'ssh' && activeProjectId) {
      useSystemCodexAccount.getState().ensureRemote(scope.hostKey, activeProjectId)
    }
  }, [hostSystemCodexShown, scope, activeProjectId])
  const selectableRemote = claudeRemote.some((row) => row.accountId !== null)
  const availableAccountIds =
    scope.kind === 'local'
      ? scoped.accounts.map((account) => account.id)
      : claudeRemote.flatMap((row) => (row.accountId === null ? [] : [row.accountId]))
  const effectiveDefault = availableAccountIds.includes(defaultAccountId ?? '')
    ? defaultAccountId
    : undefined

  // Only providers the user has actually enabled reach the pill; render whenever ANY of them
  // (Claude included) has something to say. Both rules are pure and pinned by tests — gating on
  // Claude alone, which is what this did, left a Codex-only user with no pill at all.
  const enabled = enabledProviders([...visibleProviders, ...codexRemote.map((row) => row.usage)])
  if (!hasAnyUsage(claudeUsage, visibleProviders, visibleRemote) && scoped.pillLimits.length === 0)
    return null
  // Name the identity when the pill shows a managed account, so its numbers are never read as the
  // system account's. The system identity stays unlabelled — exactly the pill as it always was.
  const pillAccountLabel =
    scoped.pillAccountId === null
      ? null
      : scope.kind === 'local'
        ? pillDefaultLabel
        : claudeRemote.find((r) => r.accountId === scoped.pillAccountId)?.label

  // On an SSH project these are the HOST's limits — same shape, same labels, read somewhere else.
  const limits = scoped.pillLimits
  const hasData = limits.length > 0 || enabled.length > 0
  const fetching = refreshing
  const providerError =
    visibleProviders.some((p) => p.status === 'error') ||
    codexRemote.some((r) => r.usage.status === 'error')
  const claudeError =
    claudeUsage?.status === 'error' || claudeRemote.some((r) => r.usage.status === 'error')
  const isError = claudeError || providerError
  // The pill leads with whatever is closest to biting, so a scoped model cap that is nearly
  // exhausted can't hide behind a comfortable 5h window. Considers every enabled provider, not
  // just Claude, so an exhausted Codex window drives the bar too.
  const primary = primaryLimit([...limits, ...enabled.flatMap((p) => p.limits)])
  const updatedAt = claudeUsage?.updatedAt ?? visibleRemote[0]?.usage.updatedAt ?? null
  // The single-account Claude block: its meters, its account and its action together (issue #912).
  // The heading appears once another provider shares the panel, exactly as before.
  const claudeAccountShown = !!(claudeUsage?.email || claudeUsage?.organization)
  const claudeHasContent = limits.length > 0 || claudeError || claudeAccountShown
  const providerIdentity = (p: ProviderUsage): string | null | undefined =>
    p.provider !== 'codex'
      ? p.account
      : remoteCodexUsages.has(p)
        ? // A host's Codex identity: the managed account's label, else the host itself — never
          // this machine's system Codex login.
          p.account ||
          (scope.kind === 'ssh'
            ? remoteSystemCodexEmails[scope.hostKey] || scope.hostKey
            : null)
      : p.accountId
        ? codexAccounts.find((a) => a.id === p.accountId)?.email ||
          codexAccounts.find((a) => a.id === p.accountId)?.label
        : systemCodexEmail || systemCodexLabel || 'System Codex account'

  const refresh = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (refreshing) return
    setRefreshing(true)
    try {
      // ⟳ refreshes what is actually on screen. On an SSH project that is the host — forced past
      // its debounce, since this is the only way to make it re-read before the cache expires —
      // and the local snapshot is left alone rather than spending a request on rows nobody can see.
      const requestedScope = remoteScope.current
      if (scope.kind === 'ssh') {
        const rows = await window.nodeTerminal.usage
          .remote({ hostKey: scope.hostKey, force: true })
          .catch((): RemoteAccountUsage[] => [])
        if (remoteScope.current === requestedScope) setRemote(rows)
      } else {
        // The other providers sit behind the same debounce, so a stale failure (an expired token
        // the CLI has since renewed) would otherwise stay on screen until it runs out. Settled
        // separately: one read failing must not throw away the others' fresh answers.
        const [sys, def, ps] = await Promise.allSettled([
          window.nodeTerminal.usage.refresh(),
          localDefaultId ? window.nodeTerminal.usage.refresh(localDefaultId) : Promise.resolve(null),
          window.nodeTerminal.usage.providers(true)
        ])
        if (sys.status === 'fulfilled') {
          setUsage(sys.value)
          recordClaudeUsage(undefined, sys.value)
        }
        if (localDefaultId && def.status === 'fulfilled' && def.value) {
          const fresh = def.value
          setAcctUsage((m) => ({ ...m, [localDefaultId]: fresh }))
          recordClaudeUsage(localDefaultId, fresh)
        }
        if (ps.status === 'fulfilled') setProviders(ps.value)
      }
    } finally {
      setRefreshing(false)
    }
  }

  // Issue #420 — "Switch account" where the limit is displayed: opens a terminal running the
  // SYSTEM-scoped `claude /login`, so picking the other org is one click from the panel that said
  // you need to. Nothing changes until the user completes the login IN that terminal, which is why
  // there is no confirm dialog in front of it: the terminal is the confirmation surface, and the
  // tooltip names what completing it changes. LOCAL scope only: on an SSH project a system login
  // would rewrite the HOST's ~/.claude. Hidden with the Claude provider.
  // Issue #912: it is rendered INSIDE the block of the account it switches (the Claude block, or
  // the System row when managed accounts are listed). As a popover footer it sat under whichever
  // provider happened to be last, and read as that provider's action.
  const switchAction =
    scope.kind === 'local' && !hidden.has('claude') ? (
      <Button variant="outlined" size="small" vocabularyMode="factual"
        className="usage-popover__switch"
        title={ts(
          'usage.switchAccount.title',
          'Opens a terminal running `claude /login` for the system account (~/.claude). Completing it switches the org/account all system sessions use. Running sessions carry on under the new one. Managed accounts keep their own logins.'
        )}
        onClick={() => {
          setOpen(false)
          window.dispatchEvent(new CustomEvent('nodeterm:switch-system-account'))
        }}
      >
        {ts('usage.switchAccount.label', '⇄ Switch {agent} account…', { agent: claudeLabel })}
      </Button>
    ) : null

  let pillBody: JSX.Element
  if (!hasData && fetching) {
    pillBody = <span className="usage-pill__dim usage-pill__pulse">···</span>
  } else if (!hasData && isError) {
    pillBody = <span className="usage-pill__dim">⚠</span>
  } else {
    pillBody = (
      <>
        {pillAccountLabel && (
          <span
            className="usage-pill__account"
            title={
              scoped.pillAccountId === pillDefaultId
                ? ts('usage.pill.defaultAccount', 'Account used for new sessions in this project')
                : ts('usage.pill.otherAccount', 'Account these limits belong to')
            }
          >
            {pillAccountLabel}
          </span>
        )}
        {primary && (
          <span className="usage-pill__minibar" aria-hidden>
            <span
              className="usage-pill__minibar-fill"
              style={{
                width: `${barFillPercent(primary.usedPercent, percentMode)}%`,
                background: severityColor(primary.severity, 100 - primary.usedPercent)
              }}
            />
          </span>
        )}
        {limits.map((l, i) => (
          <span key={limitKey(l)}>
            {i > 0 && <span className="usage-pill__sep">·</span>}
            <span className="usage-pill__num">
              {percentNumber(l.usedPercent, percentMode)}% {limitShortLabel(l.kind, l.scopeLabel)}
            </span>
          </span>
        ))}
        {/* One segment per enabled provider, carrying only its worst limit — a provider's full
            breakdown belongs in the popover, not in a pill that has to fit beside the canvas. */}
        {enabled.map((p, i) => {
          const worst = primaryLimit(p.limits)
          if (!worst) return null
          return (
            <span key={providerRowKey(p)} className="usage-pill__provider">
              {(limits.length > 0 || i > 0) && <span className="usage-pill__sep">·</span>}
              <span className="usage-pill__num">
              {percentNumber(worst.usedPercent, percentMode)}% {providerIdentity(p) || mapBuiltinAgentLabel(mapVocabulary, p.provider, labelFor(p.provider))}
              </span>
            </span>
          )
        })}
        {isError && hasData && <span className="usage-pill__dim">⚠</span>}
      </>
    )
  }

  return (
    <div
      className={`usage-indicator${overBoard ? ' usage-indicator--board' : ''}`}
      ref={popRef}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
    >
      {/* The SSH pill is visually identical to the local one — same labels, same bar — so the
          title is what answers "whose numbers are these?" without opening the popover. The trigger
          comes first so Tab enters an open popover before the refresh button. */}
      <Button variant="text" size="small" vocabularyMode="factual"
        ref={pillRef}
        className="usage-pill"
        onClick={() => setOpen((v) => !v)}
        onFocus={openNow}
        title={scope.kind === 'ssh' ? `Agent usage on ${scope.hostKey}` : 'Agent usage'}
      >
        <span className="usage-pill__icon">✦</span>
        {pillBody}
      </Button>
      {open && (
        <div
          className="usage-popover"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            suppressNextPillFocusRef.current = true
            setOpen(false)
            pillRef.current?.focus()
          }}
        >
          <div className="usage-popover__head">
            <span className="usage-popover__title">✦ Usage</span>
            {/* Tracks whichever snapshot the panel is actually showing — the local poll's, or
                the host read's on an SSH project. Absent when neither has answered yet. */}
            {updatedAt !== null && (
              <span className="usage-popover__ago">Updated {formatTimeAgo(updatedAt)}</span>
            )}
          </div>
          {/* Issue #503: the account blocks SCROLL, the heading does not. Each account is a tall
              block (name + Session/Weekly/Opus meters), so past about four accounts the popover
              grew off the top of the window. Every row is rendered and the list scrolls. The switch
              action scrolls WITH its block since issue #912 — it belongs to the Claude / System
              block, which is always first. */}
          <div className="usage-popover__body">
            {/* The local Claude section belongs to a LOCAL project only. On an SSH project the
                remote blocks below carry the same limits, and rendering both would print the
                host's numbers twice under two different headings. */}
            {scope.kind === 'local' &&
              (scoped.accounts.length > 0 && claudeUsage ? (
                <div role="radiogroup" aria-label={`Default ${claudeLabel} account for new sessions`} onKeyDown={moveRadioFocus}>
                  <AccountUsageBlock
                    mode={percentMode}
                    label={systemAccountDisplay(systemLabelSetting, claudeUsage.email)}
                    // Avoid printing the email twice when it's already the display label.
                    email={systemLabelSetting.trim() ? (claudeUsage.email ?? undefined) : undefined}
                    u={claudeUsage}
                    accountId={undefined}
                    selected={effectiveDefault === undefined}
                    onSelect={selectDefaultAccount}
                    selectable
                    tr={tr}
                    action={switchAction}
                  />
                  {scoped.accounts.map((a) => (
                    <AccountUsageBlock
                      key={a.id}
                      mode={percentMode}
                      label={a.label}
                      email={a.email}
                      u={acctUsage[a.id] ?? null}
                      accountId={a.id}
                      selected={effectiveDefault === a.id}
                      onSelect={selectDefaultAccount}
                      selectable
                      tr={tr}
                    />
                  ))}
                </div>
              ) : (
                <div className="usage-claude">
                  {/* Claude's rows are bare when it is the only provider; once others share the
                      panel they need a heading of their own to stay attributable. */}
                  {enabled.length > 0 && claudeHasContent && (
                    <div className="usage-account__label">{claudeLabel}</div>
                  )}
                  {limits.map((l) => (
                    <LimitRow key={limitKey(l)} limit={l} mode={percentMode} />
                  ))}
                  <HeldNote u={claudeUsage} tr={tr} />
                  {/* Another provider's data must not hide a failed Claude read. Keep any
                      last-known Claude bars instead of replacing them with the empty state. */}
                  {((!hasData && !providerError) || (claudeError && limits.length === 0)) && (
                    <div className="usage-popover__empty">
                      {claudeError ? usageFailureText(claudeUsage, '', tr) : tr('usage.empty', 'No usage data.')}
                    </div>
                  )}
                  {/* Issue #912: the account is part of Claude's block, set like a meter row under
                      the provider heading, not a peer section between Claude and the next provider. */}
                  {claudeAccountShown && (
                    <div className="usage-row usage-claude__account">
                      <div className="usage-row__title">{tr('usage.claude.account', 'Account')}</div>
                      {claudeUsage?.email && (
                        <div className="usage-account__email">{claudeUsage.email}</div>
                      )}
                      <UsageOrganization
                        organization={claudeUsage?.organization}
                        email={claudeUsage?.email}
                      />
                    </div>
                  )}
                  {switchAction}
                </div>
              ))}
            {/* On an SSH project these are the whole panel; the host badge is what says the numbers
                were read somewhere other than this machine. Only the host's Claude identities are
                selectable for new sessions; its Codex identities are a read-out. */}
            {selectableRemote ? (
              <div role="radiogroup" aria-label={`Default ${claudeLabel} account for new sessions`} onKeyDown={moveRadioFocus}>
                {claudeRemote.map((r) => (
                  <RemoteUsageBlock
                    key={`${r.hostKey}#${r.accountId ?? ''}`}
                    row={r}
                    mode={percentMode}
                    accountId={r.accountId ?? undefined}
                    selected={(r.accountId ?? undefined) === effectiveDefault}
                    onSelect={selectDefaultAccount}
                    selectable
                    tr={tr}
                  />
                ))}
              </div>
            ) : (
              claudeRemote.map((r) => (
                <RemoteUsageBlock
                  key={`${r.hostKey}#${r.accountId ?? ''}`}
                  row={r}
                  mode={percentMode}
                  accountId={r.accountId ?? undefined}
                  selected={(r.accountId ?? undefined) === effectiveDefault}
                  onSelect={selectDefaultAccount}
                  selectable={false}
                  tr={tr}
                />
              ))
            )}
            {codexRemote.map((r) => (
              <ProviderBlock
                key={`codex:${r.hostKey}:${r.accountId ?? ''}`}
                u={r.usage}
                mode={percentMode}
                identity={providerIdentity(r.usage)}
                hostKey={r.hostKey}
                tr={tr}
              />
            ))}
            {scope.kind === 'ssh' && visibleRemote.length === 0 && (
              <div className="usage-popover__empty">
                {tr(
                  'usage.remote.notYet',
                  'No usage from this host yet. It is read once the project connects.'
                )}
              </div>
            )}
            {/* U8 (owed from PR 7): Codex emits one row per account, all `provider: 'codex'`.
                Key on provider+accountId so each account renders distinctly, and reduce true
                duplicates (two settings entries → the same underlying account) to one row. */}
            {dedupeProviderRows(visibleProviders).map((p) => (
              <ProviderBlock key={providerRowKey(p)} u={p} mode={percentMode} identity={providerIdentity(p)} tr={tr} />
            ))}
          </div>
        </div>
      )}
      <IconButton size="compact" icon="refresh" vocabularyMode="factual" aria-label="Refresh usage"
        className={`usage-refresh${fetching ? ' spin' : ''}`}
        onClick={refresh}
        disabled={refreshing}
        title="Refresh usage"
       />
    </div>
  )
}
