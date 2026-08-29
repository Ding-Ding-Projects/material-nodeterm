import { useEffect, useMemo, useRef, useState } from 'react'
import type { ClaudeSkillScope, ClaudeSkillsResult } from '@shared/claude-skills'
import { useRegexSearchField } from '../../../lib/regex/useRegexSearchField'
import { matchesEntry } from '../search'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'

const ROWS = {
  skills: {
    title: 'Claude skills',
    keywords: ['claude', 'skill', 'skills', 'config', 'local', 'remote', 'account', 'available', 'missing', 'unavailable', 'refresh']
  }
}
const ENTRIES = Object.values(ROWS)

function stateLabel(state: ClaudeSkillScope['state']): string {
  return state === 'available' ? 'Available' : state === 'missing' ? 'Missing' : 'Unavailable'
}

export function ClaudeSkillsSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const [catalogue, setCatalogue] = useState<ClaudeSkillsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useRegexSearchField()

  const refresh = (): void => {
    setLoading(true)
    setError(null)
    void window.nodeTerminal.claude.skills.list()
      .then(setCatalogue)
      .catch((reason: unknown) => {
        setCatalogue(null)
        setError(reason instanceof Error ? reason.message : 'Claude skill discovery is unavailable.')
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (isActive) refresh()
  }, [isActive])

  const visibleScopes = useMemo(() => {
    if (!catalogue) return []
    if (!search.active) return catalogue.scopes
    return catalogue.scopes.map((scope) => {
      const scopeMatch = matchesEntry(search, {
        title: scope.label,
        description: `${scope.location} ${scope.state} ${scope.reason ?? ''}`,
        keywords: [scope.kind, ...scope.skills.map((skill) => `${skill.name} ${skill.state}`)]
      })
      if (scopeMatch) return scope
      const skills = scope.skills.filter((skill) => matchesEntry(search, {
        title: skill.name,
        description: `${skill.state} ${skill.reason ?? ''}`,
        keywords: [scope.label, scope.location, scope.kind]
      }))
      return skills.length ? { ...scope, skills } : null
    }).filter((scope): scope is ClaudeSkillScope => scope !== null)
  }, [catalogue, search.active, search.query, search.pattern, search.flags, search.mode])

  return (
    <SettingsSection
      id="claude-skills"
      title="Claude skills"
      description="See which Claude skill folders are visible in each local and connected remote config scope. Discovery reads metadata only and never opens SKILL.md contents."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.skills}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[240px] flex-1">
              <Input
                ref={inputRef}
                value={search.value}
                onChange={(event) => search.setValue(event.target.value)}
                placeholder={search.mode === 'regex' ? 'Search skills (regex)' : 'Search skills'}
                aria-label="Search Claude skills"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2">
                <AnchoredRegexBuilder search={search} fieldRef={inputRef} label="Regex, Claude skill search" />
              </div>
            </div>
            <Button onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh skill catalogue'}</Button>
          </div>
          {search.error ? <p className="text-xs text-danger">{search.error}</p> : null}
          {error ? <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert"><strong>Skill discovery unavailable.</strong> {error}</div> : null}
          {!catalogue && !loading && !error ? <p className="text-sm text-muted">No Claude skill catalogue has been loaded yet.</p> : null}
          {catalogue && visibleScopes.length === 0 ? <p className="text-sm text-muted">No Claude skill scopes or skills match this search.</p> : null}
          {visibleScopes.map((scope) => (
            <div key={scope.id} className="rounded-md border border-border p-3" data-skill-scope={scope.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="text-sm font-semibold">{scope.label}</h3><p className="text-xs text-muted">{scope.location}</p></div>
                <span className="rounded-full border border-border px-2 py-1 text-xs" data-skill-scope-state={scope.state}>{stateLabel(scope.state)}</span>
              </div>
              {scope.reason ? <p className="mt-2 text-xs text-muted">{scope.reason}</p> : null}
              <div className="mt-3 space-y-2">
                {scope.skills.map((skill) => <FieldRow key={skill.name} label={skill.name} note={skill.reason} control={<span className="text-xs text-muted">{stateLabel(skill.state)}</span>} />)}
                {scope.skills.length === 0 ? <p className="text-xs text-muted">No readable skill folders were found in this scope.</p> : null}
              </div>
            </div>
          ))}
          {catalogue ? <p className="text-xs text-muted" role="status">Refreshed {new Date(catalogue.refreshedAt).toLocaleString()}. Skill file contents, credentials, session data, and private paths are never returned by this catalogue.</p> : null}
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
