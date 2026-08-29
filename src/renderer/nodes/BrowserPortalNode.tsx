import { useEffect, useMemo, useState } from 'react'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  BROWSER_PORTAL_PRESETS,
  browserPortalPartitionFor,
  browserPortalPreset,
  validateBrowserPortalUrl,
  type BrowserPortalLifecycle,
  type BrowserPortalLocalProfile
} from '@shared/browser-portal'
import type { CanvasNode } from '../state/workspace'
import {
  loadBrowserPortalProfileForNode,
  loadBrowserPortalProfiles,
  saveBrowserPortalProfileForNode,
  saveBrowserPortalProfiles
} from '../state/browserPortalProfiles'
import { useProjects } from '../state/projects'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { BrowserSurface } from './BrowserSurface'

const PROFILE_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff']

function newProfile(): BrowserPortalLocalProfile {
  const id = `portal-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`
  return { id, name: `Portal profile ${id.slice(-4)}`, color: PROFILE_COLORS[Date.now() % PROFILE_COLORS.length] }
}

interface BrowserPortalNodeProps extends NodeProps<CanvasNode> {
  data: CanvasNode['data'] & { browserPortalPresetId?: string; browserPortalUrl?: string }
}

/** A safe, isolated portal surface. It owns no credentials and never reuses the ordinary browser session. */
export default function BrowserPortalNode({ id, data, selected }: BrowserPortalNodeProps) {
  const { deleteElements, updateNodeData } = useReactFlow()
  const activeProjectId = useProjects((state) => state.activeProjectId)
  const headerFill = nodeHeaderFillStyle(data.color)
  const [profiles, setProfiles] = useState<BrowserPortalLocalProfile[]>(loadBrowserPortalProfiles)
  const [profileId, setProfileId] = useState(() => loadBrowserPortalProfileForNode(id) ?? `${id}-local`)
  const [lifecycle, setLifecycle] = useState<BrowserPortalLifecycle>('idle')
  const [urlDraft, setUrlDraft] = useState(String(data.browserPortalUrl ?? data.url ?? ''))
  const preset = browserPortalPreset(data.browserPortalPresetId as string | undefined)
  const portalUrl = validateBrowserPortalUrl(String(data.browserPortalUrl ?? data.url ?? '')) ?? ''
  const partition = useMemo(
    () => browserPortalPartitionFor(activeProjectId, id, profileId),
    [activeProjectId, id, profileId]
  )

  useEffect(() => {
    setUrlDraft(portalUrl)
  }, [portalUrl])

  useEffect(() => {
    saveBrowserPortalProfileForNode(id, profileId)
  }, [id, profileId])

  const chooseProfile = (next: string): void => {
    setProfileId(next)
    setLifecycle('idle')
  }

  const addProfile = (): void => {
    const profile = newProfile()
    const next = [...profiles, profile]
    setProfiles(next)
    saveBrowserPortalProfiles(next)
    setProfileId(profile.id)
  }

  const navigate = (candidate: string): void => {
    const safe = validateBrowserPortalUrl(candidate)
    if (!safe) {
      setLifecycle('error')
      return
    }
    setUrlDraft(safe)
    updateNodeData(id, { browserPortalUrl: safe, url: safe, browserPortalPresetId: 'blank' })
    setLifecycle('loading')
  }

  const choosePreset = (presetId: string): void => {
    const selected = browserPortalPreset(presetId)
    updateNodeData(id, { browserPortalPresetId: selected.id })
    if (selected.url) navigate(selected.url)
    else {
      updateNodeData(id, { browserPortalUrl: undefined, url: undefined })
      setUrlDraft('')
      setLifecycle('idle')
    }
  }

  const statusText =
    lifecycle === 'loading'
      ? 'Loading the selected HTTP(S) destination…'
      : lifecycle === 'ready'
        ? 'Portal ready'
        : lifecycle === 'suspended'
          ? 'Portal suspended while hidden; it will restore from its saved URL.'
          : lifecycle === 'error'
            ? 'The destination could not be loaded. Check that it is a valid HTTP(S) URL.'
            : 'Choose a safe preset or enter an HTTP(S) URL.'

  return (
    <div className={`term-node browser-node browser-portal-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={360} minHeight={240} isVisible={selected} color={data.color} />
      <Handle id="flow-in" type="target" position={Position.Top} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', top: 0 }} />
      <Handle id="flow-out" type="source" position={Position.Bottom} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none', bottom: 0 }} />
      <div className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`} style={headerFill.style}>
        <span className="term-node__title-text" title={portalUrl}>{(data.title as string) || 'Browser Portal'}</span>
        <span className="term-node__spacer" />
        <label className="browser-portal__profile-label">
          <span className="sr-only">Local portal profile</span>
          <select value={profileId} onChange={(event) => chooseProfile(event.target.value)} aria-label="Local portal profile">
            {profiles.length === 0 && <option value={profileId}>Private local profile</option>}
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </label>
        <button type="button" className="browser-node__btn" onClick={addProfile} title="Create an isolated local profile" aria-label="Create an isolated local profile">+</button>
        <button className="term-node__close" title="Close" aria-label="Close Browser Portal" onClick={() => deleteElements({ nodes: [{ id }] })}>×</button>
      </div>
      <div className="browser-portal__controls nodrag">
        <label>
          <span>Preset</span>
          <select value={preset.id} onChange={(event) => choosePreset(event.target.value)} aria-label="Browser Portal preset">
            {BROWSER_PORTAL_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="browser-portal__url-field">
          <span>HTTP(S) URL</span>
          <input value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') navigate(urlDraft) }} placeholder="https://example.com" inputMode="url" spellCheck={false} aria-describedby={`portal-status-${id}`} />
        </label>
        <button type="button" className="browser-node__btn" onClick={() => navigate(urlDraft)} disabled={!validateBrowserPortalUrl(urlDraft)} title="Open this HTTP(S) URL">Open</button>
      </div>
      <p id={`portal-status-${id}`} className={`browser-portal__status browser-portal__status--${lifecycle}`} role="status">{statusText}</p>
      <div className="editor-node__body">
        <BrowserSurface
          key={`${id}::${partition}`}
          nodeId={id}
          url={portalUrl}
          partition={partition}
          strictHttpUrl
          allowPopups={false}
          onLifecycleChange={setLifecycle}
          onUrlChange={(next) => {
            const safe = validateBrowserPortalUrl(next)
            if (safe) updateNodeData(id, { browserPortalUrl: safe, url: safe })
          }}
          onTitleChange={(title) => updateNodeData(id, { title })}
        />
      </div>
    </div>
  )
}
