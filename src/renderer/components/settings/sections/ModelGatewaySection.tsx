import { useEffect, useState } from 'react'
import { modelGatewayCredentialKind, modelGatewayRoutes, MODEL_GATEWAY_SECRET_REF, parseModelGatewayEnvReference, type ModelGatewayCredentialStatus } from '@shared/agents/model-gateway'
import { useModelGateway } from '../../../state/modelGateway'
import { useSettings } from '../../../state/settings'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { FieldRow } from '../FieldRow'
import { SearchableRow } from '../SearchableRow'
import { SettingsSection } from '../SettingsSection'

const ROWS = {
  endpoint: { title: 'Model gateway URL', keywords: ['gateway', 'openai', 'anthropic', 'endpoint', 'models'] },
  credential: { title: 'Model gateway credential', keywords: ['api key', 'credential', 'environment', 'secret'] },
  models: { title: 'Gateway models', keywords: ['discover', 'refresh', 'switch model', 'catalogue'] }
}
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export function ModelGatewaySection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const gateway = useSettings((state) => state.settings.modelGateway)
  const update = useSettings((state) => state.update)
  const models = useModelGateway((state) => state.models)
  const status = useModelGateway((state) => state.status)
  const error = useModelGateway((state) => state.error)
  const discover = useModelGateway((state) => state.discover)
  const clear = useModelGateway((state) => state.clear)
  const [mode, setMode] = useState<'environment' | 'stored'>(() => modelGatewayCredentialKind(gateway.apiKey) === 'environment' ? 'environment' : 'stored')
  const [envName, setEnvName] = useState(() => parseModelGatewayEnvReference(gateway.apiKey)?.name ?? '')
  const [key, setKey] = useState('')
  const [envError, setEnvError] = useState('')
  const [credential, setCredential] = useState<ModelGatewayCredentialStatus | null>(null)
  const [credentialError, setCredentialError] = useState('')
  const routes = modelGatewayRoutes(gateway.baseUrl)
  const patch = (value: Partial<typeof gateway>): void => update({ modelGateway: { ...useSettings.getState().settings.modelGateway, ...value } })

  useEffect(() => {
    if (!isActive) return
    let alive = true
    void window.nodeTerminal.agent.gatewayCredentialStatus().then((value) => { if (alive) setCredential(value) }).catch(() => {})
    return () => { alive = false }
  }, [isActive])

  const selectMode = (value: 'environment' | 'stored'): void => {
    setMode(value)
    setCredentialError('')
    if (value === 'environment') patch({ apiKey: envName && ENV_NAME.test(envName) ? `\${env:${envName}}` : '' })
    else patch({ apiKey: credential?.hasStoredKey ? MODEL_GATEWAY_SECRET_REF : '' })
  }

  const saveCredential = async (): Promise<void> => {
    setCredentialError('')
    try {
      const value = await window.nodeTerminal.agent.saveGatewayCredential(key)
      setCredential(value)
      setKey('')
      patch({ apiKey: MODEL_GATEWAY_SECRET_REF })
    } catch (error) {
      setCredentialError(
        error instanceof Error && error.message === 'gateway-secret-storage-unavailable'
          ? 'Protected credential storage is unavailable on this host. Use an environment variable instead.'
          : 'The gateway key could not be saved.'
      )
    }
  }

  return (
    <SettingsSection id="model-gateway" title="Model gateway" description="Configure one OpenAI-compatible gateway and choose a discovered model for supported agent harnesses." isActive={isActive} searchEntries={Object.values(ROWS)}>
      <SearchableRow {...ROWS.endpoint}>
        <FieldRow label="Gateway URL" description="Discovery uses /v1/models. Credentials in the URL are refused." control={<Input type="url" className="w-80" value={gateway.baseUrl} placeholder="https://gateway.example.com" onChange={(event) => patch({ baseUrl: event.target.value })} />} />
        {gateway.baseUrl && !routes ? <p className="text-xs text-[color:var(--warn)]">Enter a valid HTTP(S) URL without embedded credentials.</p> : null}
        {routes ? <div className="space-y-1 text-right font-mono text-xs text-muted"><div>{routes.discovery}</div><div>{routes.openai}</div><div>{routes.anthropic}</div></div> : null}
      </SearchableRow>
      <SearchableRow {...ROWS.credential}>
        <FieldRow label="Credential source" description="Use an environment variable or save a literal key in protected local storage." control={<Select value={mode} onChange={(event) => selectMode(event.target.value as 'environment' | 'stored')}><option value="environment">Environment variable</option><option value="stored">Stored API key</option></Select>} />
        {mode === 'environment' ? <FieldRow label="Environment variable" description="Only the variable name is saved. The key stays in the host environment." control={<Input className="w-64 font-mono" value={envName} placeholder="MODEL_GATEWAY_KEY" onChange={(event) => { const value = event.target.value; setEnvName(value); const invalid = !!value && !ENV_NAME.test(value); setEnvError(invalid ? 'Use letters, digits, and underscores, starting with a letter or underscore.' : ''); patch({ apiKey: value && !invalid ? `\${env:${value}}` : '' }) }} />} /> : <FieldRow label="API key" description="Write-only input. The saved key is never shown or placed in a launch command." control={<div className="flex items-center gap-2"><Input type="password" className="w-56" value={key} onChange={(event) => { setKey(event.target.value); setCredentialError('') }} placeholder={credential?.hasStoredKey ? 'Key saved' : 'API key'} /><Button disabled={!key} onClick={() => void saveCredential()}>Save key</Button>{credential?.hasStoredKey ? <Button onClick={() => void window.nodeTerminal.agent.clearGatewayCredential().then((value) => { setCredential(value); patch({ apiKey: '' }); clear() }).catch(() => setCredentialError('The gateway key could not be cleared.'))}>Clear</Button> : null}</div>} />}
        {mode === 'environment' && envError ? <p className="text-xs text-[color:var(--warn)]">{envError}</p> : null}
        {credential?.storage === 'unavailable' ? <p className="text-xs text-[color:var(--warn)]">Protected credential storage is unavailable on this host. Environment-variable mode remains available.</p> : null}
        {credentialError ? <p className="text-xs text-[color:var(--warn)]">{credentialError}</p> : null}
      </SearchableRow>
      <SearchableRow {...ROWS.models}>
        <div className="flex items-center justify-between gap-4"><div><div className="text-sm font-medium text-text">Available models</div><p className="text-xs text-muted">{status === 'loading' ? 'Discovering models…' : status === 'ready' ? `${models.length} model${models.length === 1 ? '' : 's'} available.` : 'Refresh to read the gateway catalogue.'}</p>{error ? <p className="text-xs text-[color:var(--warn)]">{error}</p> : null}</div><Button disabled={!routes || status === 'loading'} onClick={() => void discover(gateway)}>{status === 'loading' ? 'Discovering…' : models.length ? 'Refresh' : 'Discover models'}</Button></div>
        {models.length ? <div className="mt-2 max-h-40 overflow-y-auto rounded bg-black/15 p-2 font-mono text-xs text-muted">{models.map((model) => <div key={model.id}>{model.id}</div>)}</div> : null}
      </SearchableRow>
    </SettingsSection>
  )
}
