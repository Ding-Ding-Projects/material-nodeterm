import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubCliAccount, GitHubCliAccountList, GitHubCliLoginSession } from '@shared/github-issues'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../../lib/regex/useRegexSearchField'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { SettingsText } from '../SettingsText'

const EMPTY: GitHubCliAccountList = {
  accounts: [],
  active: null,
  ghInstalled: true,
  refreshedAt: 0
}

function accountText(account: GitHubCliAccount): string {
  return [account.login, account.host, account.state, account.tokenSource ?? '', ...account.scopes,
    ...account.organizations, ...account.writableOwners].join(' ')
}

function statusLabel(account: GitHubCliAccount): string {
  if (account.state === 'authenticated') return account.active ? 'Active and authenticated' : 'Authenticated'
  if (account.state === 'unauthenticated') return 'Not authenticated'
  return 'Status unavailable'
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The GitHub CLI account action could not be completed.'
}

export function GitHubCliAccountsPanel(): React.JSX.Element {
  const [accounts, setAccounts] = useState<GitHubCliAccountList>(EMPTY)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [login, setLogin] = useState<GitHubCliLoginSession | null>(null)
  const search = useRegexSearchField({ mode: 'text' })
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = async (): Promise<void> => {
    setBusy('list')
    setNotice('')
    try {
      setAccounts(await window.nodeTerminal.githubCliAccounts.list())
    } catch (error) {
      setNotice(describeError(error))
    } finally {
      setBusy('')
    }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    if (!login || !['starting', 'waiting'].includes(login.state)) return
    const timer = window.setInterval(async () => {
      try {
        const next = await window.nodeTerminal.githubCliAccounts.loginStatus(login.id)
        setLogin(next)
        if (next.state === 'completed') await refresh()
      } catch (error) {
        setNotice(describeError(error))
      }
    }, 750)
    return () => window.clearInterval(timer)
  }, [login?.id, login?.state])

  const filtered = useMemo(() => accounts.accounts.filter((account) => {
    if (!search.active) return true
    return search.test(accountText(account))
  }), [accounts.accounts, search.active, search.test])

  const run = async (name: string, action: () => Promise<void>, success: string): Promise<void> => {
    setBusy(name)
    setNotice('')
    try {
      await action()
      setNotice(success)
    } catch (error) {
      setNotice(describeError(error))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-fill-weak/20 p-4" aria-labelledby="github-cli-accounts-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="github-cli-accounts-title" className="text-base font-semibold text-text">
            <SettingsText>GitHub CLI accounts</SettingsText>
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            <SettingsText>Accounts are discovered from the GitHub CLI credential store. Credentials never enter app settings or renderer state.</SettingsText>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== ''} onClick={() => void run('login', async () => {
            const session = await window.nodeTerminal.githubCliAccounts.startLogin()
            setLogin(session)
          }, 'Sign-in started. Approve it in your browser.')}>Add account</Button>
          <Button disabled={busy !== ''} onClick={() => void refresh()}>Refresh accounts</Button>
        </div>
      </div>

      {login && (
        <div className="rounded-xl border border-border bg-fill-weak/40 p-3" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{login.state === 'waiting' ? 'Approve sign-in in your browser' : `Sign-in ${login.state}`}</strong>
            {['starting', 'waiting'].includes(login.state) && (
              <Button disabled={busy !== ''} onClick={() => void run('cancel-login', () => window.nodeTerminal.githubCliAccounts.cancelLogin(login.id), 'Sign-in cancelled.')}>Cancel</Button>
            )}
          </div>
          {login.userCode && <p className="mt-2 font-mono text-lg tracking-widest">{login.userCode}</p>}
          {login.verificationUri && <p className="mt-1 break-all text-xs text-muted">{login.verificationUri}</p>}
          {login.message && <p className="mt-2 text-sm text-muted">{login.message}</p>}
        </div>
      )}

      {!accounts.ghInstalled && <p className="text-sm text-danger" role="alert"><SettingsText>The GitHub CLI was not found on this computer.</SettingsText></p>}
      {accounts.error && <p className="text-sm text-danger" role="alert">{accounts.error}</p>}

      <div className="flex min-w-0 items-center gap-2">
        <Input
          ref={searchRef}
          type="search"
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
          placeholder={search.mode === 'regex' ? 'Filter accounts (regex)…' : 'Filter accounts…'}
          aria-label="Filter GitHub CLI accounts"
          vocabularyMode="factual"
        />
        <AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex builder for GitHub CLI accounts" />
      </div>
      {search.error && <p className="text-xs text-danger" role="alert">{search.error}</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted"><SettingsText>{accounts.accounts.length ? 'No GitHub CLI accounts match this filter.' : 'No GitHub CLI accounts are signed in.'}</SettingsText></p>
      ) : (
        <div className="space-y-3" role="list" aria-label="GitHub CLI accounts">
          {filtered.map((account) => (
            <article key={`${account.host}:${account.login}`} className="rounded-xl border border-border p-3" role="listitem">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-text">@{account.login}</strong>
                    {account.active && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">Active</span>}
                    <span className="text-xs text-muted">{statusLabel(account)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Host: {account.host}</p>
                  <p className="mt-1 text-xs text-muted">Scopes: {account.scopes.length ? account.scopes.join(', ') : 'Unavailable from gh'}</p>
                  <p className="mt-1 text-xs text-muted">Organizations: {account.organizations.length ? account.organizations.join(', ') : 'Unavailable or none reported'}</p>
                  <p className="mt-1 text-xs text-muted">Writable owners: {account.writableOwners.length ? account.writableOwners.join(', ') : 'Unavailable or none reported'}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {!account.active && account.state === 'authenticated' && <Button disabled={busy !== ''} onClick={() => void run('switch', async () => { setAccounts(await window.nodeTerminal.githubCliAccounts.switchActive(account.host, account.login)) }, 'Active GitHub CLI account changed.')}>Use this account</Button>}
                  {account.state === 'authenticated' && <Button disabled={busy !== ''} onClick={() => void run('refresh-auth', async () => { setLogin(await window.nodeTerminal.githubCliAccounts.refreshAuthorization({ host: account.host, login: account.login })) }, 'Authorization refresh started.')}>Refresh authorization</Button>}
                  <Button disabled={busy !== ''} onClick={() => void run('sign-out', async () => { setAccounts(await window.nodeTerminal.githubCliAccounts.signOut(account.host, account.login)) }, 'Account signed out of the GitHub CLI.')}>Sign out</Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {notice && <p className="text-sm text-muted" role="status">{notice}</p>}
    </section>
  )
}
