import { useMemo, useRef, useState } from 'react'
import type { NamedTerminalProfile } from '@shared/types'
import { useSettings } from '../../../state/settings'
import {
  createNamedTerminalProfile,
  namedTerminalProfileLabel,
  type NamedTerminalProfileDraft
} from '../../../lib/named-terminal-profiles'
import { useLocalizedVocabularyText } from '../../../lib/personalVocabulary/useLocalizedVocabularyText'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { TextField } from '@renderer/ui/md3/TextField'
import { AnchoredRegexBuilder } from '../../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../../lib/regex/useRegexSearchField'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'

export interface NamedTerminalProfilesRows {
  title: string
  keywords: string[]
}

const EMPTY_DRAFT: NamedTerminalProfileDraft = { name: '', cwd: '', startupCommand: '' }

function profileMatches(profile: NamedTerminalProfile, query: string, test: (value: string) => boolean): boolean {
  if (!query) return true
  return test(`${profile.name}\n${profile.cwd}\n${profile.startupCommand}`)
}

/** Settings editor for user-owned local profile recipes. Paths and commands stay machine-local. */
export function NamedTerminalProfilesControls({ rows }: { rows: NamedTerminalProfilesRows }): React.JSX.Element {
  const profileText = useLocalizedVocabularyText()
  const profiles = useSettings((state) => state.settings.namedTerminalProfiles)
  const defaultId = useSettings((state) => state.settings.defaultNamedTerminalProfileId)
  const update = useSettings((state) => state.update)
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<NamedTerminalProfileDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => profileMatches(profile, search.query, search.test)),
    [profiles, search.query, search.test]
  )

  const resetDraft = (): void => {
    setDraft(EMPTY_DRAFT)
    setEditingId(null)
    setRemoveId(null)
    setError(null)
  }

  const save = (): void => {
    const next = createNamedTerminalProfile(draft)
    if (!next) {
      setError(
        profileText(
          'terminalProfiles.named.invalid',
          'Enter a name and initial directory. Keep each value within its stated limit.'
        )
      )
      return
    }
    const saved = editingId
      ? profiles.map((profile) => (profile.id === editingId ? { ...next, id: editingId } : profile))
      : [...profiles, next]
    update({
      namedTerminalProfiles: saved,
      ...(defaultId === null && !editingId ? { defaultNamedTerminalProfileId: next.id } : {})
    })
    resetDraft()
  }

  const edit = (profile: NamedTerminalProfile): void => {
    setEditingId(profile.id)
    setRemoveId(null)
    setError(null)
    setDraft({ name: profile.name, cwd: profile.cwd, startupCommand: profile.startupCommand })
  }

  const remove = (id: string): void => {
    const next = profiles.filter((profile) => profile.id !== id)
    update({
      namedTerminalProfiles: next,
      defaultNamedTerminalProfileId: defaultId === id ? (next[0]?.id ?? null) : defaultId
    })
    if (editingId === id) resetDraft()
    setRemoveId(null)
  }

  return (
    <SearchableRow {...rows} resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all' }}>
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text">
            {profileText('terminalProfiles.named.heading', 'Named terminal profiles')}
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            {profileText(
              'terminalProfiles.named.description',
              'Save a name, initial directory, and optional startup command for new terminal or agent nodes. These values stay on this computer and are not written to shared project files.'
            )}
          </p>
        </div>

        <TextField
          ref={searchRef}
          label={profileText('terminalProfiles.named.search', 'Search named profiles')}
          value={search.value}
          onChange={(event) => search.setValue(event.target.value)}
          trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex: named terminal profiles" />}
          supportText={search.error ?? `${visibleProfiles.length} profile${visibleProfiles.length === 1 ? '' : 's'} shown`}
          invalid={!!search.error}
          aria-controls="named-terminal-profile-list"
        />

        <ul id="named-terminal-profile-list" className="grid gap-2" aria-label={profileText('terminalProfiles.named.listLabel', 'Saved named terminal profiles')}>
          {visibleProfiles.length === 0 ? (
            <li className="rounded-lg border border-border/70 px-3 py-3 text-xs text-muted">
              {profileText('terminalProfiles.named.empty', 'No named profiles match this search. Create one below.')}
            </li>
          ) : (
            visibleProfiles.map((profile) => (
              <li key={profile.id} className="rounded-lg border border-border/70 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block text-sm text-text">{profile.name}</strong>
                    <span className="block truncate text-xs text-muted" title={profile.cwd}>{profile.cwd}</span>
                    {profile.startupCommand ? (
                      <code className="mt-1 block truncate text-xs text-muted" title={profile.startupCommand}>{profile.startupCommand}</code>
                    ) : (
                      <span className="mt-1 block text-xs text-muted">{profileText('terminalProfiles.named.noStartup', 'No startup command')}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      type="button"
                      onClick={() => update({ defaultNamedTerminalProfileId: profile.id })}
                      aria-pressed={defaultId === profile.id}
                    >
                      {defaultId === profile.id
                        ? profileText('terminalProfiles.named.default', 'Default')
                        : profileText('terminalProfiles.named.useDefault', 'Use for new nodes')}
                    </Button>
                    <Button type="button" onClick={() => edit(profile)}>
                      {profileText('terminalProfiles.named.edit', 'Edit')}
                    </Button>
                    {removeId === profile.id ? (
                      <Button type="button" onClick={() => remove(profile.id)}>
                        {profileText('terminalProfiles.named.confirmRemove', 'Confirm remove')}
                      </Button>
                    ) : (
                      <Button type="button" onClick={() => setRemoveId(profile.id)}>
                        {profileText('terminalProfiles.named.remove', 'Remove')}
                      </Button>
                    )}
                  </div>
                </div>
                {defaultId === profile.id ? (
                  <p className="mt-2 text-xs text-muted" role="status">
                    {profileText('terminalProfiles.named.defaultStatus', '{profile} is used for one-click new nodes.', {
                      profile: namedTerminalProfileLabel(profile.id, profiles)
                    })}
                  </p>
                ) : null}
              </li>
            ))
          )}
        </ul>

        <div className="rounded-lg border border-border/70 p-3">
          <h4 className="text-sm font-medium text-text">
            {profileText('terminalProfiles.named.editorTitle', editingId ? 'Edit named profile' : 'Create named profile')}
          </h4>
          <div className="mt-3 grid gap-3">
            <FieldRow
              resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all' }}
              label={profileText('terminalProfiles.named.nameLabel', 'Name')}
              description={profileText('terminalProfiles.named.nameDescription', 'A short label shown in profile pickers.')}
              htmlFor="named-terminal-profile-name"
              control={<Input id="named-terminal-profile-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />}
            />
            <FieldRow
              resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all' }}
              label={profileText('terminalProfiles.named.cwdLabel', 'Initial directory')}
              description={profileText('terminalProfiles.named.cwdDescription', 'The directory opened before the startup command runs.')}
              htmlFor="named-terminal-profile-cwd"
              control={
                <div className="flex max-w-[430px] flex-wrap justify-end gap-2">
                  <Input id="named-terminal-profile-cwd" className="w-72 font-mono" value={draft.cwd} onChange={(event) => setDraft({ ...draft, cwd: event.target.value })} />
                  <Button type="button" onClick={() => void window.nodeTerminal.dialog.selectFolder().then((cwd) => cwd !== null && setDraft((current) => ({ ...current, cwd })))}>
                    {profileText('terminalProfiles.named.browse', 'Browse…')}
                  </Button>
                </div>
              }
            />
            <FieldRow
              resolvedVocabulary={{ source: 'localized-vocabulary', fields: 'all' }}
              label={profileText('terminalProfiles.named.commandLabel', 'Startup command')}
              description={profileText('terminalProfiles.named.commandDescription', 'Optional text sent once after the shell is ready. It is user-authored and runs locally.')}
              htmlFor="named-terminal-profile-command"
              control={<Input id="named-terminal-profile-command" className="w-72 font-mono" value={draft.startupCommand} onChange={(event) => setDraft({ ...draft, startupCommand: event.target.value })} />}
            />
          </div>
          {error ? <p className="mt-3 text-xs text-[color:var(--warn)]" role="alert">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            {editingId ? <Button type="button" onClick={resetDraft}>{profileText('terminalProfiles.named.cancel', 'Cancel')}</Button> : null}
            <Button type="button" onClick={save}>{editingId ? profileText('terminalProfiles.named.saveChanges', 'Save changes') : profileText('terminalProfiles.named.create', 'Create profile')}</Button>
          </div>
        </div>
      </div>
    </SearchableRow>
  )
}
