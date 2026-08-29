import { useMemo, useState } from 'react'
import type { NextcloudAioProfile } from '@shared/nextcloud-aio'
import {
  assessNextcloudAioCapacity,
  buildNextcloudAioRunPlan,
  NEXTCLOUD_AIO_CATALOG_ENTRY,
  NEXTCLOUD_AIO_DEPENDENCIES,
  nextcloudAioReadinessUrl,
  nextcloudAioSetupUrl,
  normalizeNextcloudAioProfile,
  validateNextcloudAioProfile
} from '@shared/nextcloud-aio'
import { safeServiceEndpoint, type ServiceConnection } from '@shared/node-exec'

type Operation = 'deploy' | 'update' | 'backup' | 'restore'

interface NextcloudAioPanelProps {
  nodeId: string
  profile: NextcloudAioProfile | undefined
  connection: ServiceConnection | undefined
  onProfileChange: (profile: NextcloudAioProfile) => void
  onConnectionChange: (connection: ServiceConnection | undefined) => void
}

const operationLabels: Record<Operation, string> = {
  deploy: 'Deploy AIO',
  update: 'Update image',
  backup: 'Create backup',
  restore: 'Restore backup'
}

/**
 * Guided profile surface for the official Nextcloud AIO master container.
 *
 * The panel owns portable intent only. Endpoint, Docker context, container id, health state,
 * backup files, and credentials belong to the machine-local host binding. No control accepts an
 * image, Compose document, entrypoint, shell command, environment map, or secret.
 */
export function NextcloudAioPanel({
  nodeId,
  profile: profileInput,
  connection,
  onProfileChange,
  onConnectionChange
}: NextcloudAioPanelProps): React.JSX.Element {
  const profile = normalizeNextcloudAioProfile(profileInput)
  const [endpointDraft, setEndpointDraft] = useState(connection?.endpoint ?? '')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [notice, setNotice] = useState('')
  const [planVisible, setPlanVisible] = useState(false)

  const setupUrl = connection ? nextcloudAioSetupUrl(connection.endpoint, profile.setupPort) : undefined
  const readinessUrl = connection ? nextcloudAioReadinessUrl(connection.endpoint, profile.httpsPort) : undefined
  const capacity = useMemo(
    () => assessNextcloudAioCapacity(profile, {
      availableStorageGiB: null,
      availableMemoryMiB: null,
      availableCpus: null
    }),
    [profile]
  )
  const plan = useMemo(() => buildNextcloudAioRunPlan(profile), [profile])
  const validProfile = !!validateNextcloudAioProfile(profile)

  const update = (patch: Partial<NextcloudAioProfile>): void => {
    onProfileChange({ ...profile, ...patch })
    setNotice('Profile changes are portable intent and are saved with this canvas.')
  }

  const commitEndpoint = (): void => {
    const trimmed = endpointDraft.trim()
    if (trimmed === '') {
      onConnectionChange(undefined)
      setNotice('Host binding cleared. The profile stays portable and unbound.')
      return
    }
    if (!safeServiceEndpoint(trimmed)) {
      setNotice('Enter an HTTP(S) or SSH host address without credentials.')
      return
    }
    onConnectionChange({ ...connection, endpoint: trimmed })
    setNotice('Host binding saved on this computer only.')
  }

  const requestOperation = (next: Operation): void => {
    if (!connection) {
      setNotice(`${operationLabels[next]} is unavailable until a local Docker host is configured.`)
      return
    }
    if (!validProfile) {
      setNotice(`${operationLabels[next]} is unavailable until the profile values are valid.`)
      return
    }
    // The fixed plan is the operation boundary. The host bridge is deliberately not guessed here:
    // this panel cannot claim that Docker acted when no host runtime has accepted the plan.
    setOperation(next)
    setNotice(`${operationLabels[next]} is prepared as a fixed AIO operation. Host readiness is still required.`)
  }

  return (
    <div className="service-node__body nextcloud-aio-body" data-node-id={nodeId}>
      <div className="service-node__state">Nextcloud AIO profile</div>
      <p className="service-node__note">
        Official image is pinned. The profile never accepts arbitrary Compose, image, command,
        entrypoint, environment, or credential input.
      </p>
      <p className="service-node__note">
        Catalog: {NEXTCLOUD_AIO_CATALOG_ENTRY.title} · {NEXTCLOUD_AIO_CATALOG_ENTRY.capabilities.join(', ')}.
        Required host dependencies: {NEXTCLOUD_AIO_DEPENDENCIES.map((dependency) => dependency.label).join(' and ')}.
        The host probe, not PATH alone, decides whether they are available.
      </p>

      <label className="service-node__field" htmlFor={`${nodeId}-aio-host`}>
        <span className="service-node__field-label">Docker host address</span>
        <input
          id={`${nodeId}-aio-host`}
          className="service-node__input nodrag"
          type="text"
          spellCheck={false}
          value={endpointDraft}
          placeholder="ssh://docker@host or https://host"
          aria-describedby={`${nodeId}-aio-host-note`}
          aria-invalid={endpointDraft !== '' && !safeServiceEndpoint(endpointDraft)}
          onChange={(event) => setEndpointDraft(event.target.value)}
          onBlur={commitEndpoint}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitEndpoint()
            }
            if (event.key === 'Escape') setEndpointDraft(connection?.endpoint ?? '')
          }}
        />
      </label>
      <p id={`${nodeId}-aio-host-note`} className="service-node__note">
        {connection
          ? 'Saved on this computer only. Credentials and host-specific identifiers never travel with the canvas.'
          : 'Unbound. Choose a host before any deployment operation can be prepared.'}
      </p>

      <div className="nextcloud-aio-grid" role="group" aria-label="Nextcloud AIO capacity and ports">
        <label className="service-node__field" htmlFor={`${nodeId}-aio-storage`}>
          <span className="service-node__field-label">Storage (GiB)</span>
          <input id={`${nodeId}-aio-storage`} className="service-node__input nodrag" type="number" min={10} max={1048576} step={1} value={profile.storageGiB} onChange={(e) => update({ storageGiB: Number(e.target.value) })} />
        </label>
        <label className="service-node__field" htmlFor={`${nodeId}-aio-memory`}>
          <span className="service-node__field-label">Memory (MiB)</span>
          <input id={`${nodeId}-aio-memory`} className="service-node__input nodrag" type="number" min={2048} max={1048576} step={256} value={profile.memoryMiB} onChange={(e) => update({ memoryMiB: Number(e.target.value) })} />
        </label>
        <label className="service-node__field" htmlFor={`${nodeId}-aio-cpus`}>
          <span className="service-node__field-label">CPUs</span>
          <input id={`${nodeId}-aio-cpus`} className="service-node__input nodrag" type="number" min={1} max={128} step={1} value={profile.cpus} onChange={(e) => update({ cpus: Number(e.target.value) })} />
        </label>
        <label className="service-node__field" htmlFor={`${nodeId}-aio-binding`}>
          <span className="service-node__field-label">Binding</span>
          <select id={`${nodeId}-aio-binding`} className="service-node__input nodrag" value={profile.binding} onChange={(e) => update({ binding: e.target.value as NextcloudAioProfile['binding'] })}>
            <option value="loopback">Private loopback</option>
            <option value="private-network">Private network</option>
          </select>
        </label>
        <label className="service-node__field" htmlFor={`${nodeId}-aio-setup-port`}>
          <span className="service-node__field-label">Setup port</span>
          <input id={`${nodeId}-aio-setup-port`} className="service-node__input nodrag" type="number" min={1024} max={65535} step={1} value={profile.setupPort} onChange={(e) => update({ setupPort: Number(e.target.value) })} />
        </label>
        <label className="service-node__field" htmlFor={`${nodeId}-aio-https-port`}>
          <span className="service-node__field-label">HTTPS port</span>
          <input id={`${nodeId}-aio-https-port`} className="service-node__input nodrag" type="number" min={1024} max={65535} step={1} value={profile.httpsPort} onChange={(e) => update({ httpsPort: Number(e.target.value) })} />
        </label>
        <label className="service-node__field" htmlFor={`${nodeId}-aio-retention`}>
          <span className="service-node__field-label">Backup retention (days)</span>
          <input id={`${nodeId}-aio-retention`} className="service-node__input nodrag" type="number" min={1} max={3650} step={1} value={profile.backupRetentionDays} onChange={(e) => update({ backupRetentionDays: Number(e.target.value) })} />
        </label>
      </div>
      <label className="mc-checkbox nodrag" htmlFor={`${nodeId}-aio-updates`}>
        <input id={`${nodeId}-aio-updates`} type="checkbox" checked={profile.automaticUpdates} onChange={(e) => update({ automaticUpdates: e.target.checked })} />
        Allow scheduled AIO image updates after health checks
      </label>

      <p className={`service-node__note${capacity.status === 'insufficient' ? ' mc-note--warn' : ''}`}>
        Capacity: {capacity.status === 'unknown' ? 'unknown until the bound Docker host reports storage, memory, and CPUs.' : capacity.reasons.join(' ')}
      </p>
      <p className="service-node__note">
        Docker socket authority: this profile mounts the daemon socket read-only so AIO can create
        its child containers. Read-only file mounting does not reduce Docker API authority, so this
        is equivalent to granting control of the Docker daemon. `privileged` mode is never used.
      </p>

      <div className="mc-row">
        <button type="button" className="mc-button nodrag" onClick={() => { setPlanVisible((visible) => !visible); setNotice('The fixed deployment plan is local preview data and has not started Docker.') }}>
          {planVisible ? 'Hide deployment plan' : 'Review deployment plan'}
        </button>
        <button type="button" className="mc-button mc-button--primary nodrag" disabled={!connection || !validProfile} title={!connection ? 'Configure a Docker host first.' : !validProfile ? 'Correct the profile values first.' : undefined} onClick={() => requestOperation('deploy')}>
          Deploy AIO
        </button>
      </div>
      {planVisible && (
        <div className="service-node__note" role="region" aria-label="Fixed Nextcloud AIO deployment plan">
          <div>Image: {plan.image}</div>
          <div>Ports: {plan.ports.setup} setup, {plan.ports.https} HTTPS</div>
          <div>Volume: {plan.volumeName}</div>
          <div>Socket authority: Docker daemon control</div>
          <div>Privileged mode: never</div>
        </div>
      )}

      <div className="mc-row" role="group" aria-label="Nextcloud AIO lifecycle operations">
        {(Object.keys(operationLabels) as Operation[]).slice(1).map((item) => (
          <button key={item} type="button" className="mc-button nodrag" disabled={!connection || !validProfile || operation === item} title={!connection ? 'Configure a Docker host first.' : !validProfile ? 'Correct the profile values first.' : undefined} onClick={() => requestOperation(item)}>
            {operationLabels[item]}
          </button>
        ))}
      </div>

      <p className="service-node__note" role="status" aria-live="polite">
        {notice || (setupUrl ? `Initial setup opens at ${setupUrl}; complete the first-user setup in AIO before the service is ready.` : 'Initial setup is available after a private host binding is configured.')}
      </p>
      {readinessUrl && <p className="service-node__note">Readiness probe target: {readinessUrl}. A failed or pending probe never becomes a success claim.</p>}
      <p className="service-node__hint">
        Backups and restores must name the selected local destination and stay resumable. A tunnel
        handoff remains unavailable until this local health state is verified, then it can be handed
        to the separate tunnel flow without exposing the Docker socket.
      </p>
    </div>
  )
}
