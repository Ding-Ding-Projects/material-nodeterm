import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef } from 'react'
import { useSshServers } from '../state/sshServers'
import type { SshServer } from '@shared/ssh'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'

interface RemotePickerProps {
  x: number
  y: number
  onPick: (server: SshServer) => void
  onManage: () => void
  onClose: () => void
}

/** A small portal menu listing saved SSH servers; picking one opens a remote terminal. */
export function RemotePicker({ x, y, onPick, onManage, onClose }: RemotePickerProps) {
  const vocab = useVocabularyMapper()
  const servers = useSshServers((s) => s.servers)
  const search = useRegexSearchField()
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  const visible = useMemo(
    () =>
      servers.filter((server) =>
        search.mode === 'regex'
          ? search.test(server.label)
          : server.label.toLocaleLowerCase().includes(search.query.toLocaleLowerCase())
      ),
    [search.flags, search.mode, search.pattern, search.query, servers]
  )
  return createPortal(
    <>
      <div className="ctx-backdrop" onClick={onClose} />
      <div className="ctx-menu" role="menu" aria-label={vocab('Remote servers')} style={{ top: y, left: x }} onClick={(e) => e.stopPropagation()}>
        <div className="menu-filter" onMouseDown={(e) => e.stopPropagation()}>
          <div className="menu-filter__row">
            <input
              ref={inputRef}
              className="menu-filter__input"
              value={search.value}
              placeholder={search.mode === 'regex' ? vocab('Filter remote servers… (regex)') : vocab('Filter remote servers…')}
              aria-label={vocab('Filter remote servers')}
              onChange={(e) => search.setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  if (search.active) search.reset()
                  else onClose()
                }
              }}
            />
            <AnchoredRegexBuilder search={search} fieldRef={inputRef} label={vocab('Regex — remote servers')} zIndex={90} />
          </div>
          {search.error && <div className="menu-filter__error">{search.error}</div>}
          <span className="sr-only" role="status" aria-live="polite">{visible.length} {vocab('results')}</span>
        </div>
        {servers.length === 0 ? (
          <button
            role="menuitem"
            className="ctx-item"
            onClick={() => {
              onManage()
              onClose()
            }}
          >
            {vocab('Add SSH server…')}
          </button>
          ) : visible.length === 0 ? (
            <div className="ctx-item" role="status">{vocab('No remote servers match this filter.')}</div>
          ) : (
            <>
            {visible.map((s) => (
              <button
                key={s.id}
                role="menuitem"
                className="ctx-item"
                title={`${s.user}@${s.host}`}
                onClick={() => {
                  onPick(s)
                  onClose()
                }}
              >
                {s.label}
              </button>
            ))}
            <div className="ctx-sep" />
            <button
              role="menuitem"
              className="ctx-item"
              onClick={() => {
                onManage()
                onClose()
              }}
            >
              {vocab('Manage SSH servers…')}
            </button>
          </>
        )}
      </div>
    </>,
    document.body
  )
}
