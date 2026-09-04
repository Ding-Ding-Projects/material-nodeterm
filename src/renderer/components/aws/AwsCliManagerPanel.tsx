import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AwsCliStatus, AwsModelInventory } from '@shared/aws'
import { useActiveSessionApi } from '../../session/session'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { MaterialSymbol } from '../MaterialSymbol'
import { Button, IconButton, SearchField, Tablist } from '../../ui/md3'

export interface AwsCliManagerPanelProps {
  onClose: () => void
}

type Tab = 'status' | 'models'

function toast(message: string, kind: 'error' | 'info' = 'info'): void {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind, message } }))
}

function stateLabel(status: AwsCliStatus | null): string {
  if (!status) return 'Checking AWS CLI status...'
  if (status.state === 'ready') return `AWS CLI v2 ${status.installedVersion ?? status.expectedVersion} is ready.`
  if (status.state === 'installing') return 'AWS CLI v2 installation is in progress.'
  if (status.state === 'stale') return `AWS CLI ${status.installedVersion ?? 'unknown'} needs repair.`
  return status.detail ?? 'AWS CLI is not ready.'
}

/** Bundled AWS CLI v2 manager and Bedrock foundation-model inventory.
 *  docs/features/integrations/aws-cli-manager.md.
 *
 *  Reads the ACTIVE session's api (`useActiveSessionApi`), never `window.nodeTerminal`: a relay
 *  tab's session refuses `awsCli` outright rather than installing an MSI on the viewing machine. */
export function AwsCliManagerPanel({ onClose }: AwsCliManagerPanelProps): React.JSX.Element {
  const api = useActiveSessionApi()
  const aws = api.awsCli
  const search = useRegexSearchField({ mode: 'text' })
  const searchRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('status')
  const [status, setStatus] = useState<AwsCliStatus | null>(null)
  const [inventory, setInventory] = useState<AwsModelInventory | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await aws.status())
    } catch (error) {
      toast(`Could not read AWS CLI status: ${String(error)}`, 'error')
    }
  }, [aws])

  const refreshModels = useCallback(async () => {
    try {
      setInventory(await aws.refreshModels())
    } catch (error) {
      toast(`Could not discover AWS models: ${String(error)}`, 'error')
    }
  }, [aws])

  useEffect(() => {
    void refreshStatus()
    return aws.onStatus(setStatus)
  }, [aws, refreshStatus])

  const install = useCallback(
    async (repair: boolean) => {
      setBusy(true)
      try {
        const next = repair ? await aws.repair() : await aws.ensure()
        setStatus(next)
        if (next.state === 'ready') toast('AWS CLI v2 is ready for the current user.')
        else toast(next.detail ?? 'AWS CLI could not be prepared.', 'error')
      } catch (error) {
        toast(`AWS CLI install failed: ${String(error)}`, 'error')
      } finally {
        setBusy(false)
      }
    },
    [aws]
  )

  const rows = useMemo(() => {
    const models = inventory?.models ?? []
    return models.filter((model) => search.test(`${model.id} ${model.name} ${model.provider ?? ''}`))
  }, [inventory, search])

  return createPortal(
    <div className="drawer-overlay md3-aws" onClick={onClose}>
      <aside
        className="drawer aws-cli"
        role="dialog"
        aria-label="AWS CLI manager"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer__head">
          <h2>AWS CLI v2 manager</h2>
          <IconButton className="drawer__close" icon="close" onClick={onClose} aria-label="Close AWS CLI manager" />
        </header>
        <Tablist className="aws-cli__tabs" ariaLabel="AWS CLI manager sections">
          <Button
            variant={tab === 'status' ? 'tonal' : 'text'}
            size="small"
            role="tab"
            aria-selected={tab === 'status'}
            onClick={() => setTab('status')}
          >
            Status and install
          </Button>
          <Button
            variant={tab === 'models' ? 'tonal' : 'text'}
            size="small"
            role="tab"
            aria-selected={tab === 'models'}
            onClick={() => {
              setTab('models')
              if (!inventory) void refreshModels()
            }}
          >
            Foundation models
          </Button>
        </Tablist>
        {tab === 'status' ? (
          <section className="aws-cli__section" role="tabpanel">
            <h3>Windows x64 CLI</h3>
            <p className={`aws-cli__state aws-cli__state--${status?.state ?? 'checking'}`}>
              <MaterialSymbol
                name={status?.state === 'ready' ? 'check_circle' : status?.state === 'failed' ? 'warning' : 'sync'}
                size={18}
              />
              {stateLabel(status)}
            </p>
            <dl className="aws-cli__facts">
              <div>
                <dt>Required version</dt>
                <dd>{status?.expectedVersion ?? 'Not reported yet'}</dd>
              </div>
              <div>
                <dt>Installed version</dt>
                <dd>{status?.installedVersion ?? 'Not installed'}</dd>
              </div>
              <div>
                <dt>Installer</dt>
                <dd>{status?.installerSource ?? 'Bundled resource, then verified AWS fetch'}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>Official AWS endpoint only</dd>
              </div>
              <div>
                <dt>PATH use</dt>
                <dd>Never used for authority</dd>
              </div>
            </dl>
            <p className="aws-cli__note">
              The manager uses a user-scoped install and verifies the exact SHA-256 before invoking the installer. It
              does not change PATH, request administrator access, or send credentials to this app.
            </p>
            <div className="aws-cli__actions">
              <Button variant="filled" disabled={busy || status?.state === 'ready'} onClick={() => void install(false)}>
                {busy ? 'Preparing...' : 'Install or repair'}
              </Button>
              <Button variant="outlined" disabled={!busy} onClick={() => void aws.cancel()}>
                Cancel
              </Button>
              <Button variant="outlined" disabled={busy} onClick={() => void install(true)}>
                Repair from verified source
              </Button>
              <Button variant="outlined" disabled={busy} onClick={() => void refreshStatus()}>
                Check again
              </Button>
            </div>
            {status?.state === 'installing' && status.progress !== null && status.progress !== undefined && (
              <div
                className="aws-cli__progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={status.progress}
              >
                <div style={{ width: `${Math.round(status.progress * 100)}%` }} />
              </div>
            )}
          </section>
        ) : (
          <section className="aws-cli__section" role="tabpanel">
            <div className="aws-cli__search-row">
              <SearchField
                ref={searchRef}
                value={search.value}
                onChange={(event) => search.setValue(event.target.value)}
                placeholder="Search every model"
                aria-label="Search every AWS foundation model"
                trailingSlot={
                  <AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex for AWS model search" />
                }
              />
              <Button variant="outlined" onClick={() => void refreshModels()}>
                Refresh
              </Button>
            </div>
            <p className="aws-cli__note">
              The inventory is discovered through the installed AWS CLI using the official Bedrock API. When AWS or the
              CLI is unavailable, the last verified local cache stays visible and is marked stale.
            </p>
            {!inventory ? (
              <p>Loading the model inventory...</p>
            ) : inventory.models.length === 0 ? (
              <p>{inventory.detail ?? 'No foundation models are available.'}</p>
            ) : (
              <>
                <p>
                  {rows.length} of {inventory.models.length} models shown.{' '}
                  {inventory.stale ? 'Offline cache.' : 'Fresh from AWS CLI.'}
                </p>
                <ul className="aws-cli__models">
                  {rows.map((model) => (
                    <li key={model.id}>
                      <strong>{model.name}</strong>
                      <span>{model.id}</span>
                      <span>{model.provider ?? 'Provider not reported'}</span>
                      <span>
                        {model.inputModalities.join(', ') || 'Input not reported'} to{' '}
                        {model.outputModalities.join(', ') || 'Output not reported'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </aside>
    </div>,
    document.body
  )
}
