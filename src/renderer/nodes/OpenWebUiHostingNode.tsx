import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { OPEN_WEBUI_DEFAULT_INTENT, type OpenWebUiContext, type OpenWebUiIntent, type OpenWebUiJobProgress, safeOpenWebUiEndpoint } from '@shared/open-webui-hosting'
import type { CanvasNode } from '../state/workspace'
import { useReactFlow } from '@xyflow/react'
import { nodeBorderStyle, nodeColorStyle } from '../lib/nodeColor'
import { ColumnPill } from '../components/kanban/ColumnPill'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { openDestructiveGate } from '../state/destructiveGate'

function statusLabel(health: string): string {
  return health.replace(/-/g, ' ')
}

function contextCorpus(context: OpenWebUiContext): string {
  return `${context.name} ${context.kind} ${context.endpointLabel} ${context.reason ?? ''}`
}

export default function OpenWebUiHostingNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const vocab = useVocabularyMapper()
  const border = nodeBorderStyle(data.color)
  const tint = nodeColorStyle(data.color, 0.2)
  const [intent, setIntent] = useState<OpenWebUiIntent>(data.openWebUiIntent ?? OPEN_WEBUI_DEFAULT_INTENT)
  const [contexts, setContexts] = useState<OpenWebUiContext[]>([])
  const [context, setContext] = useState('')
  const [providerEndpoint, setProviderEndpoint] = useState('')
  const [state, setState] = useState<Awaited<ReturnType<typeof window.nodeTerminal.openWebUi.state>> | null>(null)
  const [jobs, setJobs] = useState<OpenWebUiJobProgress[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const contextSearch = useRegexSearchField()
  const contextSearchRef = useRef<HTMLInputElement>(null)
  const modelSearch = useRegexSearchField()
  const modelSearchRef = useRef<HTMLInputElement>(null)

  const persistIntent = (next: OpenWebUiIntent): void => {
    setIntent(next)
    updateNodeData(id, { openWebUiIntent: next })
  }

  const refresh = async (wanted = context): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const found = await window.nodeTerminal.openWebUi.contexts()
      setContexts(found)
      const chosen = wanted || found.find((item) => item.current)?.name || found[0]?.name || ''
      setContext(chosen)
      const next = await window.nodeTerminal.openWebUi.state(id, intent)
      setState(next)
      if (next.providerEndpoint) setProviderEndpoint(next.providerEndpoint)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setState(null)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void refresh('') }, [id])
  useEffect(() => window.nodeTerminal.openWebUi.onProgress((progress) => {
    if (progress.nodeId !== id) return
    setJobs((current) => [progress, ...current.filter((job) => job.jobId !== progress.jobId)].slice(0, 10))
    if (progress.phase === 'completed') void refresh()
  }), [id, context, intent])

  const visibleContexts = useMemo(() => contexts.filter((item) => contextSearch.test(contextCorpus(item))), [contexts, contextSearch])
  const run = async (input: Parameters<typeof window.nodeTerminal.openWebUi.run>[0]): Promise<void> => {
    setError('')
    try { await window.nodeTerminal.openWebUi.run(input) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const chooseFolder = async (label: string): Promise<string | null> => {
    const picked = await window.nodeTerminal.dialog.selectFolder()
    if (!picked) setError(`${label} was cancelled.`)
    return picked
  }
  const chooseFile = async (): Promise<string | null> => {
    const picked = await window.nodeTerminal.dialog.selectFile()
    if (!picked) setError('Backup source selection was cancelled.')
    return picked
  }
  const restore = async (): Promise<void> => {
    const source = await chooseFile()
    if (!source) return
    openDestructiveGate({
      title: 'Restore Open WebUI data',
      description: 'The selected validated backup will overwrite the persistent Open WebUI data volume. The source file remains unchanged.',
      affected: [state?.volumeName ?? 'Open WebUI data volume'],
      confirmLabel: 'Restore data',
      onConfirm: () => void run({ operation: 'restore', nodeId: id, source })
    })
  }

  const modelMatches = (value: string): boolean => modelSearch.test(value)
  const endpointValid = intent.provider === 'ollama' || providerEndpoint === '' || safeOpenWebUiEndpoint(providerEndpoint)
  const deploymentReady = !!context && endpointValid && !!intent.model.trim() && !busy
  const currentJob = jobs.find((job) => job.phase === 'queued' || job.phase === 'running')
  const localBound = !!state && contexts.find((item) => item.name === state.context)?.kind === 'local'

  return (
    <>
      <ColumnPill nodeId={id} />
      <div className={`open-webui-node${selected ? ' selected' : ''} ${border.className}`} style={border.style} role="group" aria-label={vocab('Open WebUI hosting')}>
        <NodeResizer minWidth={520} minHeight={420} isVisible={selected} color={data.color} />
        <div className={`open-webui-node__header ${tint.className}`} style={tint.style}>
          <span className="open-webui-node__icon" aria-hidden="true">◉</span>
          <EditableNodeTitle value={data.serviceLabel ?? ''} onChange={(next) => updateNodeData(id, { serviceLabel: next })} ariaLabel="Name for this Open WebUI hosting node" title="Rename" baseTriggerClassName="" triggerClassName="open-webui-node__label" emptyLabel={<span>Open WebUI hosting…</span>} rejectEmpty={false} />
        </div>

        <div className="open-webui-node__body nodrag">
          <p className="open-webui-node__intro">Host the pinned Open WebUI image with persistent data. Existing local Ollama is reused by default. Import carries safe intent only, and never deploys or contacts a host.</p>

          <section aria-label="Provider settings" className="open-webui-node__section">
            <h4>Provider</h4>
            <div className="open-webui-node__pills" role="radiogroup" aria-label="Open WebUI provider">
              <button type="button" role="radio" aria-checked={intent.provider === 'ollama'} className={intent.provider === 'ollama' ? 'selected' : ''} onClick={() => persistIntent({ ...intent, provider: 'ollama', reuseOllama: true })}>Local Ollama</button>
              <button type="button" role="radio" aria-checked={intent.provider === 'openai-compatible'} className={intent.provider === 'openai-compatible' ? 'selected' : ''} onClick={() => persistIntent({ ...intent, provider: 'openai-compatible', reuseOllama: false })}>OpenAI-compatible</button>
            </div>
            <p className="open-webui-node__hint">{intent.provider === 'ollama' ? 'Open WebUI connects to Ollama through the fixed local host route. No key is copied into the container command.' : 'The base URL is stored locally without credentials. Finish API-key setup in Open WebUI after the first-user setup.'}</p>
            {intent.provider === 'openai-compatible' && <label className="open-webui-node__field"><span>OpenAI-compatible base URL</span><Input value={providerEndpoint} onChange={(event) => setProviderEndpoint(event.target.value)} placeholder="https://provider.example/v1" aria-invalid={providerEndpoint !== '' && !endpointValid} /><small>{providerEndpoint !== '' && !endpointValid ? 'Use an http:// or https:// URL without a username or password.' : 'Credentials are never accepted in this field.'}</small></label>}
            <label className="open-webui-node__field"><span>Model</span><div className="open-webui-node__search"><Input ref={modelSearchRef} value={modelSearch.value} onChange={(event) => modelSearch.setValue(event.target.value)} placeholder="Search suggested model names" aria-label="Search suggested model names" /><AnchoredRegexBuilder search={modelSearch} fieldRef={modelSearchRef} label="Regex builder for model search" /></div><Input value={intent.model} onChange={(event) => persistIntent({ ...intent, model: event.target.value })} placeholder="llama3.2" aria-describedby={`${id}-model-note`} /><div className="open-webui-node__pills" aria-label="Suggested models">{['llama3.2', 'qwen2.5', 'mistral', 'gemma2'].filter(modelMatches).map((model) => <button key={model} type="button" className={intent.model === model ? 'selected' : ''} onClick={() => persistIntent({ ...intent, model })}>{model}</button>)}</div><small id={`${id}-model-note`}>Choose a suggested model or enter a validated model name. The name is passed as data, never as a shell command.</small></label>
          </section>

          <section aria-label="Docker context" className="open-webui-node__section">
            <h4>Docker context</h4>
            <div className="open-webui-node__search"><Input ref={contextSearchRef} value={contextSearch.value} onChange={(event) => contextSearch.setValue(event.target.value)} placeholder="Search available contexts" aria-label="Search available Docker contexts" /><AnchoredRegexBuilder search={contextSearch} fieldRef={contextSearchRef} label="Regex builder for Docker context search" /></div>
            <div className="open-webui-node__pills" role="listbox" aria-label="Available Docker contexts">{visibleContexts.map((item) => <button key={item.name} type="button" role="option" aria-selected={item.name === context} disabled={!item.available || busy} title={item.available ? item.endpointLabel : item.reason} className={item.name === context ? 'selected' : ''} onClick={() => setContext(item.name)}>{item.name}<small>{item.kind}</small></button>)}</div>
            {!visibleContexts.length && <p className="open-webui-node__empty">No Docker contexts match this search. Refresh to discover local and SSH contexts.</p>}
          </section>

          <section aria-label="Open WebUI state" className="open-webui-node__section open-webui-node__state">
            <header><h4>Health</h4><Button disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking…' : 'Refresh health'}</Button></header>
            <p><strong>{state ? statusLabel(state.health) : 'not checked'}</strong>{state?.detail ? ` · ${state.detail}` : ''}</p>
            {state?.setupRequired && <p className="open-webui-node__setup">First-user setup is required. Open the page, create the first local account there, then refresh health. This node never invents an account or reports setup as complete.</p>}
          </section>

          <div className="open-webui-node__actions">
            <Button disabled={!deploymentReady} title={deploymentReady ? 'Deploy Open WebUI with persistent data' : !context ? 'Choose an available Docker context first.' : !endpointValid ? 'Fix the provider base URL first.' : 'Choose a valid model and wait for the current operation.'} onClick={() => void run({ operation: 'deploy', nodeId: id, intent, context, ...(providerEndpoint ? { providerEndpoint } : {}) })}>Deploy / start</Button>
            <Button disabled={!state?.endpoint || (state.health !== 'running' && state.health !== 'needs-setup')} title={state?.endpoint && (state.health === 'running' || state.health === 'needs-setup') ? (state.setupRequired ? 'Open Open WebUI to complete first-user setup.' : 'Open the verified local Open WebUI page') : 'A verified local running page is required before opening.'} onClick={() => state?.endpoint && void window.nodeTerminal.shell.openExternal(state.endpoint)}>Open page</Button>
            <Button disabled={!localBound || !!currentJob} title={localBound ? 'Back up the local persistent volume' : 'Backup requires a locally bound Docker context.'} onClick={async () => { const destination = await chooseFolder('Backup destination'); if (destination) void run({ operation: 'backup', nodeId: id, destination }) }}>Back up data</Button>
            <Button disabled={!localBound || !!currentJob} title={localBound ? 'Restore into the local persistent volume' : 'Restore requires a locally bound Docker context.'} onClick={() => void restore()}>Restore data</Button>
            <Button disabled={!state || state.health === 'unbound' || !!currentJob} title="Pull the pinned image and recreate the owned container with its volume" onClick={() => void run({ operation: 'update', nodeId: id, intent })}>Update image</Button>
            <Button disabled={!state || state.health === 'unbound' || !jobs.some((job) => job.operation === 'update' && job.phase === 'completed') || !!currentJob} title="Restore the prior image recorded by this node" onClick={() => void run({ operation: 'rollback', nodeId: id, intent })}>Roll back image</Button>
            {currentJob && <Button onClick={() => window.nodeTerminal.openWebUi.cancel(currentJob.jobId)}>Cancel</Button>}
          </div>
          {error && <p className="open-webui-node__error" role="alert">{error}</p>}
          {contextSearch.error && <p className="open-webui-node__error" role="alert">{contextSearch.error}</p>}
          {modelSearch.error && <p className="open-webui-node__error" role="alert">{modelSearch.error}</p>}
          {jobs.length > 0 && <section aria-label="Open WebUI operation history" className="open-webui-node__jobs"><h4>Operations</h4>{jobs.map((job) => <article key={job.jobId}><header><strong>{job.operation}</strong><span>{job.phase} · {job.completedSteps}/{job.totalSteps}</span></header><progress max={job.totalSteps} value={job.completedSteps} /><p>{job.message}</p>{job.detail && <small>{job.detail}</small>}</article>)}</section>}
        </div>
      </div>
    </>
  )
}
