import { useMemo, useState } from 'react'
import { useSettings } from '../../../state/settings'
import type { CustomAgent } from '@shared/types'
import {
  AGENT_CONFIG,
  BUILTIN_AGENT_IDS,
  type AgentId,
  type PromptInjectionMode
} from '@shared/agents/config'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { uuid } from '@renderer/lib/uuid'
import { assembleLaunchCommand } from '@shared/agents/launch'
import { agentEnvSnapshot } from '@renderer/lib/agentEnv'

const ROWS = {
  custom: { title: 'Custom agents', keywords: ['custom', 'agent', 'cli', 'byo', 'aider'] }
}
const ENTRIES = Object.values(ROWS)

export function CustomAgentsSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const customAgents = useSettings((s) => s.settings.customAgents)
  const update = useSettings((s) => s.update)
  const patchAgent = (id: string, patch: Partial<CustomAgent>) =>
    update({ customAgents: customAgents.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
  const removeAgent = (id: string) => update({ customAgents: customAgents.filter((a) => a.id !== id) })
  const addAgent = () =>
    update({
      customAgents: [
        ...customAgents,
        {
          id: 'custom:' + uuid(),
          label: 'Custom agent',
          launchCmd: '',
          promptInjectionMode: 'argv'
        }
      ]
    })
  return (
    <SettingsSection
      id="custom-agents"
      title="Custom agents"
      description="Bring your own agent CLI, or inherit a built-in harness for hooks, resume, permission modes, and canvas control. Environment values support ${env:VAR} and ${env:VAR:fallback}."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.custom}>
        <div className="space-y-4">
          {customAgents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} onPatch={patchAgent} onRemove={removeAgent} />
          ))}
          <Button onClick={addAgent}>Add agent</Button>
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}

function AgentCard({
  agent,
  onPatch,
  onRemove
}: {
  agent: CustomAgent
  onPatch: (id: string, patch: Partial<CustomAgent>) => void
  onRemove: (id: string) => void
}): React.JSX.Element {
  const base = agent.baseAgent ? AGENT_CONFIG[agent.baseAgent] : undefined
  const [showValues, setShowValues] = useState(false)
  const signature = `${agent.id}|${agent.launchCmd}|${agent.args ?? ''}|${agent.baseAgent ?? ''}|${agent.promptInjectionMode ?? ''}`
  const preview = useMemo(
    () => assembleLaunchCommand({ agentId: agent.id as AgentId, customAgent: agent, sessionIdFlagSupported: true }, agentEnvSnapshot()),
    [agent, signature]
  )
  const patchEnv = (key: string, value: string): void => {
    const env = { ...(agent.env ?? {}) }
    if (!value) delete env[key]
    else env[key] = value
    onPatch(agent.id, { env })
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <FieldRow label="Label" control={<Input className="w-56" placeholder="e.g. Aider" value={agent.label} onChange={(e) => onPatch(agent.id, { label: e.target.value })} />} />
      <FieldRow
        label="Base harness"
        description={base ? `Inherits ${base.label}'s hooks, resume, permission modes, and canvas control.` : 'Blank keeps this as a standalone CLI with spawn and title status only.'}
        control={
          <Select value={agent.baseAgent ?? ''} onChange={(e) => onPatch(agent.id, { baseAgent: (e.target.value || undefined) as CustomAgent['baseAgent'] })}>
            <option value="">None (standalone CLI)</option>
            {BUILTIN_AGENT_IDS.map((id) => <option key={id} value={id}>{AGENT_CONFIG[id].label}</option>)}
          </Select>
        }
      />
      <FieldRow label="Launch command" description={base && !agent.launchCmd.trim() ? `Blank uses ${base.launchCmd}.` : undefined} control={<Input className="w-56" placeholder={base?.launchCmd ?? 'e.g. aider'} value={agent.launchCmd} onChange={(e) => onPatch(agent.id, { launchCmd: e.target.value })} />} />
      <FieldRow label="Extra args" description="Inserted before the prompt. Supports ${env:VAR}." control={<Input className="w-72" placeholder="--model ${env:MODEL}" value={agent.args ?? ''} onChange={(e) => onPatch(agent.id, { args: e.target.value })} />} />
      <FieldRow
        label="Prompt injection"
        description={base ? `Resolved from ${base.label}'s harness.` : 'How an initial prompt is passed to the CLI.'}
        control={
          <Select disabled={!!base} value={base?.promptInjectionMode ?? agent.promptInjectionMode ?? 'argv'} onChange={(e) => onPatch(agent.id, { promptInjectionMode: e.target.value as PromptInjectionMode })}>
            <option value="argv">argv</option>
            <option value="flag-prompt">flag-prompt</option>
            <option value="flag-interactive">flag-interactive</option>
            <option value="stdin-after-start">stdin-after-start</option>
          </Select>
        }
      />
      <FieldRow label="Node colour" description="Used for new nodes when set; blank inherits the harness colour." control={<Input className="w-40" type="text" placeholder={base?.color ?? '#888888'} value={agent.color ?? ''} onChange={(e) => onPatch(agent.id, { color: e.target.value || undefined })} />} />
      <div className="space-y-1.5">
        <div className="text-sm font-medium text-text">Environment variables</div>
        {Object.entries(agent.env ?? {}).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <Input className="w-40 font-mono" value={key} aria-label={`${key} variable name`} onChange={(e) => {
              const env = { ...(agent.env ?? {}) }
              delete env[key]
              env[e.target.value] = value
              onPatch(agent.id, { env })
            }} />
            <Input className="w-52 font-mono" type={showValues ? 'text' : 'password'} value={value} aria-label={`${key} variable value`} onChange={(e) => patchEnv(key, e.target.value)} />
            <Button onClick={() => { const env = { ...(agent.env ?? {}) }; delete env[key]; onPatch(agent.id, { env }) }}>Remove</Button>
          </div>
        ))}
        <Button onClick={() => {
          const env = { ...(agent.env ?? {}) }
          let key = 'NEW_VAR'
          let suffix = 1
          while (env[key] !== undefined) key = `NEW_VAR_${++suffix}`
          env[key] = ''
          onPatch(agent.id, { env })
        }}>Add variable</Button>
        <Button variant="default" onClick={() => setShowValues((value) => !value)}>{showValues ? 'Hide values' : 'Show values'}</Button>
      </div>
      <div className="rounded-md bg-bg-2 p-2">
        <div className="text-xs font-medium text-muted">Launch preview</div>
        <code className="block break-all text-xs text-text">{preview.command || '(empty)'}</code>
        {preview.missingEnv.length ? <div className="text-xs text-[color:var(--warn)]">Unset: {preview.missingEnv.join(', ')}</div> : null}
      </div>
      <Button onClick={() => onRemove(agent.id)}>Remove</Button>
    </div>
  )
}
