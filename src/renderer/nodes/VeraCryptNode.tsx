import { useCallback, useEffect, useMemo, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { DestructiveConfirmGate } from '../components/DestructiveConfirmGate'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { useActiveSessionApi } from '../session/session'
import type {
  VeraCryptAvailability,
  VeraCryptFavorite,
  VeraCryptMountInventory,
  VeraCryptMountPreflight,
  VeraCryptMountOptions,
  VeraCryptOperation
} from '@shared/veracrypt'
import { Button, Checkbox, IconButton } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'

const defaultOptions: VeraCryptMountOptions = {
  containerPath: '',
  driveLetter: 'V',
  readOnly: false,
  removable: false,
  preserveTimestamp: false,
  exploreAfterMount: false
}

function displayPath(path: string): string {
  const name = path.split(/[\\/]/u).pop()
  return name || path
}

export default function VeraCryptNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const api = useActiveSessionApi()
  const vocab = useVocabularyMapper()
  const { updateNodeData } = useReactFlow()
  const [availability, setAvailability] = useState<VeraCryptAvailability | null>(null)
  const [inventory, setInventory] = useState<VeraCryptMountInventory | null>(null)
  const [preflight, setPreflight] = useState<VeraCryptMountPreflight | null>(null)
  const [favorites, setFavorites] = useState<VeraCryptFavorite[]>([])
  const [options, setOptions] = useState<VeraCryptMountOptions>(data.veracryptIntent ?? defaultOptions)
  const [operation, setOperation] = useState<VeraCryptOperation | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [destructive, setDestructive] = useState<{ kind: 'wipe' | 'force-unmount'; letter?: string; anchor: { x: number; y: number }; restoreFocusEl: HTMLElement | null } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextAvailability, nextInventory, nextFavorites, nextPreflight] = await Promise.all([
        api.veracrypt.availability(),
        api.veracrypt.refresh(),
        api.veracrypt.favorites(),
        api.veracrypt.preflight(options)
      ])
      setAvailability(nextAvailability)
      setInventory(nextInventory)
      setFavorites(nextFavorites)
      setPreflight(nextPreflight)
      setMessage(nextInventory.reason ?? nextAvailability.reason)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The VeraCrypt manager could not refresh its host state.')
    }
  }, [api, options])

  useEffect(() => {
    void refresh()
    return api.veracrypt.onOperation((next) => setOperation(next))
  }, [api, refresh])

  const mounted = useMemo(() => inventory?.volumes.filter((volume) => volume.managerCreated) ?? [], [inventory])
  const setOption = <K extends keyof VeraCryptMountOptions>(key: K, value: VeraCryptMountOptions[K]): void => {
    const next = { ...options, [key]: value }
    setOptions(next)
    updateNodeData(id, { veracryptIntent: next })
  }

  const chooseFile = async (): Promise<void> => {
    const path = await api.dialog.selectFile()
    if (path) setOption('containerPath', path)
  }

  const mount = async (): Promise<void> => {
    setMessage(null)
    try {
      const result = await api.veracrypt.preflight(options)
      setPreflight(result)
      if (!result.ok) {
        setMessage(result.reason)
        return
      }
      setOperation(await api.veracrypt.mount(options))
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The VeraCrypt mount could not start.')
    }
  }

  const saveFavorite = async (): Promise<void> => {
    if (!options.containerPath) return
    const bytes = new TextEncoder().encode(options.containerPath)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const id = `container-${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`
    const favorite: VeraCryptFavorite = {
      id,
      containerPath: options.containerPath,
      preferredDriveLetter: options.driveLetter,
      readOnly: options.readOnly === true,
      removable: options.removable === true,
      preserveTimestamp: options.preserveTimestamp === true,
      exploreAfterMount: options.exploreAfterMount === true
    }
    setFavorites(await api.veracrypt.saveFavorite(favorite))
  }

  const loadFavorite = (favorite: VeraCryptFavorite): void => {
    const next: VeraCryptMountOptions = {
      containerPath: favorite.containerPath,
      driveLetter: favorite.preferredDriveLetter ?? 'V',
      readOnly: favorite.readOnly,
      removable: favorite.removable,
      preserveTimestamp: favorite.preserveTimestamp,
      exploreAfterMount: favorite.exploreAfterMount
    }
    setOptions(next)
    updateNodeData(id, { veracryptIntent: next })
  }

  const fill = nodeHeaderFillStyle(data.color)
  const unsupported = availability?.state === 'unsupported'
  return (
    <div className={`term-node veracrypt-node${selected ? ' selected' : ''}`} style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={560} minHeight={420} isVisible={selected} color={data.color} />
      <div className={`term-node__header ${fill.className}${fill.filled ? ' term-node__header--filled' : ''}`} style={fill.style}>
        <EditableNodeTitle value={data.title} onChange={(title) => updateNodeData(id, { title })} emptyLabel={vocab('VeraCrypt containers')} title={vocab('Click to rename')} ariaLabel={vocab('VeraCrypt manager node name')} rejectEmpty={false} />
        <span className="term-node__spacer" />
        <IconButton size="compact" className="term-node__refresh" icon="refresh" vocabularyMode="factual" onClick={() => void refresh()} title={vocab('Refresh VeraCrypt state')} aria-label={vocab('Refresh VeraCrypt state')} />
      </div>
      <div className="veracrypt-node__body nodrag nowheel">
        <p className={`veracrypt-node__status${unsupported || availability?.state === 'error' ? ' is-error' : ''}`} role={unsupported || availability?.state === 'error' ? 'alert' : 'status'}>{message ?? vocab(availability?.state === 'available' ? 'VeraCrypt is available on this computer.' : 'Checking VeraCrypt availability…')}</p>
        <p className="veracrypt-node__note">{vocab('Only existing regular files are supported. VeraCrypt collects the password, PIM, keyfiles, and hidden-volume protection choice in its own prompt.')} </p>
        <label className="veracrypt-node__field">{vocab('Container file')}
          <span className="veracrypt-node__path-row"><Input vocabularyMode="factual" value={options.containerPath} onChange={(event) => setOption('containerPath', event.target.value)} placeholder={vocab('Choose an existing container file')} aria-label={vocab('VeraCrypt container file path')} /><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void chooseFile()} disabled={unsupported}>{vocab('Browse')}</Button></span>
        </label>
        <label className="veracrypt-node__field">{vocab('Drive letter')}
          <Select vocabularyMode="factual" value={options.driveLetter} onChange={(event) => setOption('driveLetter', event.target.value)} aria-label={vocab('VeraCrypt drive letter')} disabled={unsupported}><option value="">{vocab('Choose a letter')}</option>{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => <option key={letter} value={letter}>{letter}: {preflight?.availableDriveLetters.includes(letter) ? vocab('available') : vocab('occupied')}</option>)}</Select>
        </label>
        <div className="veracrypt-node__checks">
          <label><Checkbox vocabularyMode="factual" checked={options.readOnly === true} onChange={(event) => setOption('readOnly', event.target.checked)} /> {vocab('Read-only')}</label>
          <label><Checkbox vocabularyMode="factual" checked={options.removable === true} onChange={(event) => setOption('removable', event.target.checked)} /> {vocab('Removable')}</label>
          <label><Checkbox vocabularyMode="factual" checked={options.preserveTimestamp === true} onChange={(event) => setOption('preserveTimestamp', event.target.checked)} /> {vocab('Preserve timestamp')}</label>
          <label><Checkbox vocabularyMode="factual" checked={options.exploreAfterMount === true} onChange={(event) => setOption('exploreAfterMount', event.target.checked)} /> {vocab('Explore after mount')}</label>
        </div>
        <div className="veracrypt-node__actions"><Button variant="filled" size="small" vocabularyMode="factual" type="button" onClick={() => void mount()} disabled={unsupported || operation?.state === 'running'}>{vocab('Mount')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void saveFavorite()} disabled={!options.containerPath}>{vocab('Save favorite')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setDestructive({ kind: 'wipe', anchor: { x: rect.left, y: rect.bottom }, restoreFocusEl: event.currentTarget }) }} disabled={unsupported || operation?.state === 'running'}>{vocab('Wipe password cache')}</Button>{operation?.state === 'running' && <Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void api.veracrypt.cancel(operation.id)}>{vocab('Cancel')}</Button>}</div>
        {favorites.length > 0 && <section className="veracrypt-node__favorites" aria-label={vocab('VeraCrypt favorites')}><h3>{vocab('Favorites')}</h3>{favorites.map((favorite) => <Button variant="outlined" size="small" vocabularyMode="factual" key={favorite.id} onClick={() => loadFavorite(favorite)} title={favorite.containerPath}>{displayPath(favorite.containerPath)} · {favorite.preferredDriveLetter ?? vocab('no letter')}</Button>)}</section>}
        <section className="veracrypt-node__mounted" aria-label={vocab('Verified VeraCrypt mounts')}><h3>{vocab('Verified mounts')}</h3>{mounted.length === 0 ? <p>{vocab('No manager-created mounts are currently verified.')}</p> : mounted.map((volume) => <article key={volume.driveLetter}><strong>{volume.driveLetter}:</strong><span>{volume.containerPath}</span><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void api.veracrypt.explore(volume.driveLetter)}>{vocab('Explore')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={() => void api.veracrypt.unmount(volume.driveLetter).then(setOperation).then(() => refresh()).catch((error) => setMessage(String(error)))}>{vocab('Unmount')}</Button><Button variant="outlined" size="small" vocabularyMode="factual" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setDestructive({ kind: 'force-unmount', letter: volume.driveLetter, anchor: { x: rect.left, y: rect.bottom }, restoreFocusEl: event.currentTarget }) }}>{vocab('Force unmount')}</Button></article>)}</section>
        {operation && <p className="veracrypt-node__operation" role="status">{operation.message}{operation.driveLetter ? ` · ${operation.driveLetter}:` : ''}</p>}
      </div>
      {destructive && <DestructiveConfirmGate anchor={destructive.anchor} restoreFocusEl={destructive.restoreFocusEl} title={destructive.kind === 'wipe' ? 'Wipe VeraCrypt password cache' : 'Force unmount VeraCrypt drive'} description={destructive.kind === 'wipe' ? 'This clears cached VeraCrypt credentials on this computer and cannot be undone.' : `This force-unmounts drive ${destructive.letter ?? ''}: and may interrupt open files.`} confirmLabel={destructive.kind === 'wipe' ? 'Confirm wipe' : 'Force unmount'} onCancel={() => setDestructive(null)} onConfirm={() => { const action = destructive; setDestructive(null); void (action.kind === 'wipe' ? api.veracrypt.wipeCache() : api.veracrypt.unmount(action.letter ?? '', true)).then(setOperation).catch((error) => setMessage(error instanceof Error ? error.message : String(error))) }} />}
    </div>
  )
}
