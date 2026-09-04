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
  percentNumber,
  percentText,
  severityColor
} from '../lib/usageFormat'
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

/** Grace period before a hover-opened popover closes, so the pointer can cross the pill's own
 *  gap (or clip a corner en route elsewhere) without the panel flickering shut. */
const USAGE_HOVER_CLOSE_MS = 220

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
  selectable
}: {
  label: string
  email?: string
  u: ClaudeUsage | null
  mode: 'used' | 'remaining' | 'tokens'
  accountId: string | undefined
  selected: boolean
  onSelect: (accountId: string | undefined) => void
  selectable: boolean
}) {
  return (
    <div className="usage-account">
      <span className="usage-account__label">
        <span>{label}</span>
        {selected && <span className="usage-account__default" aria-hidden>✓</span>}
      </span>
      {(email ?? u?.email) && <span className="usage-account__email">{email ?? u?.email}</span>}
      {u?.limits.map((l) => (
        <LimitRow key={limitKey(l)} limit={l} mode={mode} />
      ))}
      {u && u.limits.length === 0 && <span className="usage-popover__empty">No usage data.</span>}
      {!u && <span className="usage-popover__empty usage-pill__pulse">···</span>}
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
  selectable
}: {
  row: RemoteAccountUsage
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
      {row.usage.limits.length === 0 && (
        <span className="usage-popover__empty">
          {row.usage.status === 'error' ? 'Could not read usage on this host.' : 'No usage data.'}
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
  identity
}: {
  u: ProviderUsage
  mode: 'used' | 'remaining' | 'tokens'
  identity?: string | null
}) {
  const vocab = useVocabularyMapper()
  if (u.status === 'unavailable') return null
  const label = mapBuiltinAgentLabel(vocab, u.provider, labelFor(u.provider))
  return (
    <div className="usage-account">
      <div className="usage-account__label">{label}</div>
      {(identity || u.account) && (
        <div className="usage-account__email">{identity || u.account}</div>
      )}
      {u.limits.map((l) => (
        <LimitRow key={limitKey(l)} limit={l} mode={mode} />
      ))}
      {u.limits.length === 0 && (
        <div className="usage-popover__empty">
          {u.status === 'error' ? 'Could not read usage.' : 'No usage data.'}
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
  const defaultAccountId = useProjects((s) =>
    s.projects.find((p) => p.id === s.activeProjectId)?.defaultAccountId
  )

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
  const sshUp = useSshConn((s) => !!s.byProject[activeProjectId])
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
  }, [open, scopeHostKey, sshUp])

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
    // down with them, and vice versa.
    remote: hidden.has('claude-remote') ? [] : remote
  })
  const claudeUsage = scoped.claude
  const visibleProviders = scoped.providers
  const visibleRemote = scoped.remote
  const selectableRemote = visibleRemote.some((row) => row.accountId !== null)
  const availableAccountIds =
    scope.kind === 'local'
      ? scoped.accounts.map((account) => account.id)
      : visibleRemote.flatMap((row) => (row.accountId === null ? [] : [row.accountId]))
  const effectiveDefault = availableAccountIds.includes(defaultAccountId ?? '')
    ? defaultAccountId
    : undefined

  // Only providers the user has actually enabled reach the pill; render whenever ANY of them
  // (Claude included) has something to say. Both rules are pure and pinned by tests — gating on
  // Claude alone, which is what this did, left a Codex-only user with no pill at all.
  const enabled = enabledProviders(visibleProviders)
  if (!hasAnyUsage(claudeUsage, visibleProviders, visibleRemote)) return null

  // On an SSH project these are the HOST's limits — same shape, same labels, read somewhere else.
  const limits = scoped.pillLimits
  const status = claudeUsage?.status ?? visibleRemote[0]?.usage.status ?? 'unavailable'
  const hasData = limits.length > 0 || enabled.length > 0
  const fetching = refreshing
  const isError = status === 'error'
  // The pill leads with whatever is closest to biting, so a scoped model cap that is nearly
  // exhausted can't hide behind a comfortable 5h window. Considers every enabled provider, not
  // just Claude, so an exhausted Codex window drives the bar too.
  const primary = primaryLimit([...limits, ...enabled.flatMap((p) => p.limits)])
  const updatedAt = claudeUsage?.updatedAt ?? visibleRemote[0]?.usage.updatedAt ?? null
  const providerIdentity = (p: ProviderUsage): string | null | undefined =>
    p.provider !== 'codex'
      ? p.account
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
      if (scope.kind === 'ssh') {
        setRemote(
          await window.nodeTerminal.usage
            .remote({ hostKey: scope.hostKey, force: true })
            .catch((): RemoteAccountUsage[] => [])
        )
      } else {
        setUsage(await window.nodeTerminal.usage.refresh())
      }
    } finally {
      setRefreshing(false)
    }
  }

  let pillBody: JSX.Element
  if (!hasData && fetching) {
    pillBody = <span className="usage-pill__dim usage-pill__pulse">···</span>
  } else if (!hasData && isError) {
    pillBody = <span className="usage-pill__dim">⚠</span>
  } else {
    pillBody = (
      <>
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
            <span key={p.provider} className="usage-pill__provider">
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
                  />
                ))}
              </div>
            ) : (
              <>
                {/* No Claude snapshot is available, but enabled providers may still have limits. */}
                {enabled.length > 0 && limits.length > 0 && (
                  <div className="usage-account__label">{claudeLabel}</div>
                )}
                {limits.map((l) => (
                  <LimitRow key={limitKey(l)} limit={l} mode={percentMode} />
                ))}
                {!hasData && <div className="usage-popover__empty">No usage data.</div>}
                {claudeUsage?.email && (
                  <div className="usage-account">
                    <div className="usage-account__label">{claudeLabel} Account</div>
                    <div className="usage-account__email">{claudeUsage.email}</div>
                  </div>
                )}
              </>
            ))}
          {/* On an SSH project these are the whole panel; the host badge is what says the numbers
              were read somewhere other than this machine. */}
          {selectableRemote ? (
            <div role="radiogroup" aria-label={`Default ${claudeLabel} account for new sessions`} onKeyDown={moveRadioFocus}>
              {visibleRemote.map((r) => (
                <RemoteUsageBlock
                  key={`${r.hostKey}#${r.accountId ?? ''}`}
                  row={r}
                  mode={percentMode}
                  accountId={r.accountId ?? undefined}
                  selected={(r.accountId ?? undefined) === effectiveDefault}
                  onSelect={selectDefaultAccount}
                  selectable
                />
              ))}
            </div>
          ) : (
            visibleRemote.map((r) => (
              <RemoteUsageBlock
                key={`${r.hostKey}#${r.accountId ?? ''}`}
                row={r}
                mode={percentMode}
                accountId={r.accountId ?? undefined}
                selected={(r.accountId ?? undefined) === effectiveDefault}
                onSelect={selectDefaultAccount}
                selectable={false}
              />
            ))
          )}
          {scope.kind === 'ssh' && visibleRemote.length === 0 && (
            <div className="usage-popover__empty">
              No usage from this host yet — it is read once the project connects.
            </div>
          )}
          {/* U8 (owed from PR 7): Codex emits one row per account, all `provider: 'codex'`.
              Key on provider+accountId so each account renders distinctly, and reduce true
              duplicates (two settings entries → the same underlying account) to one row. */}
          {dedupeProviderRows(visibleProviders).map((p) => (
            <ProviderBlock key={providerRowKey(p)} u={p} mode={percentMode} identity={providerIdentity(p)} />
          ))}
          {scope.kind === 'local' && !hidden.has('claude') && (
            <Button variant="outlined" size="small" vocabularyMode="factual"
             
              className="usage-popover__switch"
              title={
                'Opens a terminal running \`claude /login\` for the system account (~/.claude). ' +
                'Completing it switches the org/account all system sessions use. Running ' +
                'sessions carry on under the new one. Managed accounts keep their own logins.'
              }
              onClick={() => {
                setOpen(false)
                window.dispatchEvent(new CustomEvent('nodeterm:switch-system-account'))
              }}
            >
              ⇄ Switch account…
            </Button>
          )}
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
