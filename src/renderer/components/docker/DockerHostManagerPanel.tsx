import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DOCKER_GUIDED_IMAGES,
  DOCKER_TYPED_EXEC_TASKS,
  type DockerHostAction,
  type DockerHostJobProgress,
  type DockerHostResourceKind,
  type DockerHostSnapshot
} from '@shared/docker-host-manager'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { openDestructiveGate } from '../../state/destructiveGate'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { useI18n } from '../../lib/i18n'
import { Checkbox, Chip } from '@renderer/ui/md3'

const TABS: Array<{ id: DockerHostResourceKind | 'exec'; label: string; key: string }> = [
  { id: 'containers', label: 'Containers', key: 'containers' }, { id: 'images', label: 'Images', key: 'images' },
  { id: 'volumes', label: 'Volumes', key: 'volumes' }, { id: 'networks', label: 'Networks', key: 'networks' },
  { id: 'compose', label: 'Compose', key: 'compose' }, { id: 'exec', label: 'Typed tasks', key: 'typedTasks' }
]

function corpus(row: unknown): string {
  return Object.values(row as Record<string, unknown>).flat().join(' ')
}

export function DockerHostManagerPanel(): React.JSX.Element {
  const { ts } = useI18n()
  const copy = (key: string, fallback: string): string => ts(`dockerHost.${key}`, fallback)
  const [contexts, setContexts] = useState<Awaited<ReturnType<typeof window.nodeTerminal.relayHost.manager.contexts>>>([])
  const [context, setContext] = useState('')
  const [snapshot, setSnapshot] = useState<DockerHostSnapshot | null>(null)
  const [tab, setTab] = useState<DockerHostResourceKind | 'exec'>('containers')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [jobs, setJobs] = useState<DockerHostJobProgress[]>([])
  const [logs, setLogs] = useState('')
  const [containerPrefix, setContainerPrefix] = useState('nodeterm')
  const [volumeName, setVolumeName] = useState('nodeterm-data')
  const [networkName, setNetworkName] = useState('nodeterm-private')
  const [internalNetwork, setInternalNetwork] = useState(true)
  const [selectedImage, setSelectedImage] = useState<(typeof DOCKER_GUIDED_IMAGES)[number]['ref']>(DOCKER_GUIDED_IMAGES[0].ref)
  const [selectedNetwork, setSelectedNetwork] = useState('none')
  const [readOnly, setReadOnly] = useState(true)
  const [execContainer, setExecContainer] = useState('')
  const [execTask, setExecTask] = useState<(typeof DOCKER_TYPED_EXEC_TASKS)[number]['id']>('os')
  const [composeProfiles, setComposeProfiles] = useState<Record<string, string>>({})
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const contextSearch = useRegexSearchField()
  const contextSearchRef = useRef<HTMLInputElement>(null)

  const refresh = async (wanted = context): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const found = await window.nodeTerminal.relayHost.manager.contexts()
      setContexts(found)
      const chosen = wanted || found.find((item) => item.current)?.name || found[0]?.name || ''
      setContext(chosen)
      if (!chosen) {
        setSnapshot(null)
        setError('No Docker contexts were found. Start Docker or create an SSH Docker context, then retry.')
        return
      }
      const next = await window.nodeTerminal.relayHost.manager.snapshot(chosen)
      setSnapshot(next)
      setExecContainer((current) => next.containers.rows.some((row) => row.id === current) ? current : (next.containers.rows[0]?.id ?? ''))
      setSelectedNetwork((current) => current === 'none' || next.networks.rows.some((row) => row.name === current) ? current : 'none')
    } catch (cause) {
      setSnapshot(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void refresh('') }, [])
  useEffect(() => window.nodeTerminal.relayHost.manager.onProgress((progress) => {
    setJobs((current) => [progress, ...current.filter((job) => job.jobId !== progress.jobId)].slice(0, 12))
    if (progress.phase === 'completed') void refresh()
  }), [context])

  const run = async (action: DockerHostAction): Promise<void> => {
    setError('')
    try { await window.nodeTerminal.relayHost.manager.run(action) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const destructive = (title: string, description: string, affected: string, action: DockerHostAction): void => {
    openDestructiveGate({ title, description, affected: [affected], confirmLabel: 'Remove', onConfirm: () => void run(action) })
  }

  const visibleContexts = contexts.filter((item) => contextSearch.test(`${item.name} ${item.endpointLabel} ${item.kind}`))
  const rows = useMemo(() => {
    if (!snapshot || tab === 'exec') return []
    return snapshot[tab].rows.filter((row) => search.test(corpus(row)))
  }, [search, snapshot, tab])

  const areaError = snapshot && tab !== 'exec' ? snapshot[tab].error : undefined
  const currentJob = jobs.find((job) => job.phase === 'queued' || job.phase === 'running')

  return (
    <div className="docker-manager nodrag" aria-label={copy('title', 'Docker host manager')}>
      <div className="docker-manager__context">
        <label htmlFor="docker-context-search">{copy('contexts', 'Docker contexts')}</label>
        <div className="docker-manager__search">
          <Input ref={contextSearchRef} id="docker-context-search" type="search" value={contextSearch.value} onChange={(event) => contextSearch.setValue(event.target.value)} placeholder={copy('searchContexts', 'Search local and SSH contexts')} />
          <AnchoredRegexBuilder search={contextSearch} fieldRef={contextSearchRef} label={copy('regexContexts', 'Regex builder for Docker context search')} />
        </div>
        <div className="docker-manager__pills" role="listbox" aria-label="Available Docker contexts">
          {visibleContexts.map((item) => <Chip vocabularyMode="factual" selected={item.name === context} key={item.name} className={item.name === context ? 'selected' : ''} role="option" aria-selected={item.name === context} disabled={!item.available || busy} title={item.available ? item.endpointLabel : item.reason} onClick={() => void refresh(item.name)}>{item.name}<small>{item.kind}</small></Chip>)}
        </div>
      </div>

      <div className="docker-manager__tabs" role="tablist" aria-label={copy('resources', 'Docker resources')}>
        {TABS.map((item) => <Chip vocabularyMode="factual" selected={tab === item.id} key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => { setTab(item.id); search.reset() }}>{copy(item.key, item.label)}</Chip>)}
      </div>

      <div className="docker-manager__toolbar">
        <div className="docker-manager__search">
          <Input ref={searchRef} type="search" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={`Search ${TABS.find((item) => item.id === tab)?.label.toLowerCase()}`} aria-label={`Search ${tab}`} />
          <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={`Regex builder for ${tab} search`} />
        </div>
        <Button disabled={busy} onClick={() => void refresh()}>{busy ? copy('refreshing', 'Refreshing…') : copy('refresh', 'Refresh')}</Button>
      </div>
      {search.error ? <p className="docker-manager__error" role="alert">{search.error}</p> : null}
      {error ? <p className="docker-manager__error" role="alert">{error}</p> : null}
      {areaError ? <p className="docker-manager__error" role="status">This resource could not be read: {areaError}</p> : null}

      {tab === 'containers' && snapshot ? <>
        <section className="docker-manager__create" aria-label="Create a bounded container">
          <h5>{copy('createContainer', 'Create bounded container')}</h5>
          <Input value={containerPrefix} onChange={(event) => setContainerPrefix(event.target.value)} aria-label="Container name prefix" placeholder="Name prefix" />
          <div className="docker-manager__pills">{DOCKER_GUIDED_IMAGES.map((item) => <Button size="small" vocabularyMode="factual" key={item.ref} className={selectedImage === item.ref ? 'selected' : ''} onClick={() => setSelectedImage(item.ref)}>{item.label}</Button>)}</div>
          <div className="docker-manager__pills"><Button size="small" vocabularyMode="factual" className={selectedNetwork === 'none' ? 'selected' : ''} onClick={() => setSelectedNetwork('none')}>No network</Button>{snapshot.networks.rows.map((row) => <Button size="small" vocabularyMode="factual" key={row.id} className={selectedNetwork === row.name ? 'selected' : ''} onClick={() => setSelectedNetwork(row.name)}>{row.name}</Button>)}</div>
          <label><Checkbox vocabularyMode="factual" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} /> Read-only root filesystem</label>
          <Button onClick={() => void run({ type: 'container-create', context, image: selectedImage, namePrefix: containerPrefix, network: selectedNetwork, readOnly })}>{copy('createAndStart', 'Create and start')}</Button>
        </section>
        <div className="docker-manager__rows">{(rows as DockerHostSnapshot['containers']['rows']).map((row) => <article key={row.id}><header><strong>{row.name}</strong><span>{row.state} · {row.status}</span></header><p>{row.image}{row.ports ? ` · ${row.ports}` : ''}</p><div className="docker-manager__actions">{(['start','stop','restart','pause','unpause'] as const).map((action) => <Button key={action} onClick={() => void run({ type: 'container-lifecycle', context, containerId: row.id, action })}>{action}</Button>)}<Button onClick={async () => { try { setLogs(await window.nodeTerminal.relayHost.manager.logs(context, row.id)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }}>Logs</Button><Button onClick={() => destructive('Remove container', 'The selected container and its writable layer will be removed. Named volumes remain.', row.name, { type: 'container-remove', context, containerId: row.id })}>Remove</Button></div>{snapshot.stats.rows.find((stat) => stat.id.startsWith(row.id) || stat.name === row.name) ? <p className="docker-manager__stats">{Object.values(snapshot.stats.rows.find((stat) => stat.id.startsWith(row.id) || stat.name === row.name)!).slice(2).join(' · ')}</p> : null}</article>)}</div>
      </> : null}

      {tab === 'images' ? <><section className="docker-manager__create"><h5>{copy('pullCatalog', 'Pull from guided catalog')}</h5><div className="docker-manager__pills">{DOCKER_GUIDED_IMAGES.map((item) => <Button size="small" vocabularyMode="factual" key={item.ref} onClick={() => void run({ type: 'image-pull', context, image: item.ref })}>{item.label}</Button>)}</div></section><div className="docker-manager__rows">{(rows as DockerHostSnapshot['images']['rows']).map((row) => <article key={`${row.id}-${row.repository}-${row.tag}`}><header><strong>{row.repository}:{row.tag}</strong><span>{row.size}</span></header><p>{row.createdSince}</p><Button onClick={() => destructive('Remove image', 'The selected local image reference will be removed. Containers using it can block the action.', `${row.repository}:${row.tag}`, { type: 'image-remove', context, imageId: row.id })}>{copy('remove', 'Remove')}</Button></article>)}</div></> : null}

      {tab === 'volumes' ? <><section className="docker-manager__create"><h5>Create volume</h5><Input value={volumeName} onChange={(event) => setVolumeName(event.target.value)} aria-label="Volume name" /><Button onClick={() => void run({ type: 'volume-create', context, name: volumeName })}>Create</Button></section><div className="docker-manager__rows">{(rows as DockerHostSnapshot['volumes']['rows']).map((row) => <article key={row.name}><header><strong>{row.name}</strong><span>{row.driver} · {row.scope}</span></header><Button onClick={() => destructive('Remove volume', 'The selected volume and its stored data will be removed. This cannot be undone.', row.name, { type: 'volume-remove', context, name: row.name })}>Remove</Button></article>)}</div></> : null}

      {tab === 'networks' ? <><section className="docker-manager__create"><h5>Create bridge network</h5><Input value={networkName} onChange={(event) => setNetworkName(event.target.value)} aria-label="Network name" /><label><Checkbox vocabularyMode="factual" checked={internalNetwork} onChange={(event) => setInternalNetwork(event.target.checked)} /> Internal only</label><Button onClick={() => void run({ type: 'network-create', context, name: networkName, internal: internalNetwork })}>Create</Button></section><div className="docker-manager__rows">{(rows as DockerHostSnapshot['networks']['rows']).map((row) => <article key={row.id}><header><strong>{row.name}</strong><span>{row.driver} · {row.scope}{row.internal ? ' · internal' : ''}</span></header><Button disabled={['bridge','host','none'].includes(row.name)} title={['bridge','host','none'].includes(row.name) ? 'Built-in networks cannot be removed here.' : 'Remove network'} onClick={() => destructive('Remove network', 'The selected user-created network will be removed if no container is attached.', row.name, { type: 'network-remove', context, networkId: row.id })}>Remove</Button></article>)}</div></> : null}

      {tab === 'compose' ? <div className="docker-manager__rows">{(rows as DockerHostSnapshot['compose']['rows']).map((row) => <article key={row.name}><header><strong>{row.name}</strong><span>{row.status}</span></header><p>{row.configLabel}</p>{row.profiles.length ? <div className="docker-manager__pills"><Button size="small" vocabularyMode="factual" className={!composeProfiles[row.name] ? 'selected' : ''} onClick={() => setComposeProfiles((state) => ({ ...state, [row.name]: '' }))}>Default profile</Button>{row.profiles.map((profile) => <Button size="small" vocabularyMode="factual" key={profile} className={composeProfiles[row.name] === profile ? 'selected' : ''} onClick={() => setComposeProfiles((state) => ({ ...state, [row.name]: profile }))}>{profile}</Button>)}</div> : <p>No named profiles. Actions use the project default.</p>}<div className="docker-manager__actions">{(['start','stop','restart'] as const).map((action) => <Button key={action} onClick={() => void run({ type: 'compose-lifecycle', context, project: row.name, profile: composeProfiles[row.name] || undefined, action })}>{action}</Button>)}</div></article>)}</div> : null}

      {tab === 'exec' && snapshot ? <section className="docker-manager__create"><h5>{copy('runTypedTask', 'Run a fixed typed task')}</h5><p>{copy('noShell', 'No shell or free-form arguments are accepted.')}</p><div className="docker-manager__pills">{snapshot.containers.rows.filter((row) => search.test(corpus(row))).map((row) => <Button size="small" vocabularyMode="factual" key={row.id} className={execContainer === row.id ? 'selected' : ''} onClick={() => setExecContainer(row.id)}>{row.name}</Button>)}</div><div className="docker-manager__pills">{DOCKER_TYPED_EXEC_TASKS.filter((task) => search.test(`${task.id} ${task.label}`)).map((task) => <Button size="small" vocabularyMode="factual" key={task.id} className={execTask === task.id ? 'selected' : ''} onClick={() => setExecTask(task.id)}>{task.label}</Button>)}</div><Button disabled={!execContainer} title={execContainer ? copy('runTaskReady', 'Run the selected fixed task') : copy('chooseContainer', 'Choose a container first.')} onClick={() => void run({ type: 'typed-exec', context, containerId: execContainer, task: execTask })}>{copy('runTask', 'Run task')}</Button></section> : null}

      {logs ? <section className="docker-manager__output"><header><strong>Container logs</strong><Button onClick={() => setLogs('')}>Close</Button></header><pre>{logs}</pre></section> : null}
      {jobs.length ? <section className="docker-manager__jobs" aria-label="Docker operation history"><h5>Operations</h5>{jobs.map((job) => <article key={job.jobId}><header><strong>{job.label}</strong><span>{job.phase} · {job.completedSteps}/{job.totalSteps}</span></header><progress max={job.totalSteps} value={job.completedSteps} /><p>{job.message}</p>{job.output ? <pre>{job.output}</pre> : null}{(job.phase === 'queued' || job.phase === 'running') ? <Button onClick={() => window.nodeTerminal.relayHost.manager.cancel(job.jobId)}>Cancel</Button> : null}</article>)}</section> : null}
      {!snapshot && !busy && !error ? <p>No host state is available.</p> : null}
      {currentJob ? <span className="sr-only" role="status">{currentJob.label}: {currentJob.message}</span> : null}
    </div>
  )
}
