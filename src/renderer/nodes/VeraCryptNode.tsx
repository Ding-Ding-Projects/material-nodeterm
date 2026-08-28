import { useCallback, useEffect, useMemo, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { copy, fact, mapOwnedSentence, type DisplaySegment } from '../lib/personalVocabulary/ownedCopy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import type {
  VeraCryptAvailability,
  VeraCryptFavorite,
  VeraCryptMountInventory,
  VeraCryptMountOptions,
  VeraCryptOperation
} from '@shared/veracrypt'

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

type VeraCryptMessage = DisplaySegment

const authoredMessage = (text: string): VeraCryptMessage => copy(text)
const factualMessage = (text: string): VeraCryptMessage => fact(text)

export function mapVeraCryptMessage(
  message: VeraCryptMessage | null,
  fallback: string,
  map: (text: string) => string
): string {
  return message ? mapOwnedSentence(map, [message]) : map(fallback)
}

export function mapVeraCryptFavoriteLabel(
  path: string,
  preferredDriveLetter: string | null | undefined,
  map: (text: string) => string
): string {
  return mapOwnedSentence(map, [fact(displayPath(path)), copy(' · '), preferredDriveLetter ? fact(`${preferredDriveLetter}:`) : copy('no letter')])
}

export function mapVeraCryptOperationText(
  message: string,
  driveLetter: string | null | undefined,
  map: (text: string) => string
): string {
  return mapOwnedSentence(map, [fact(message), ...(driveLetter ? [copy(' · '), fact(`${driveLetter}:`)] : [])])
}

export default function VeraCryptNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const { updateNodeData } = useReactFlow()
  const [availability, setAvailability] = useState<VeraCryptAvailability | null>(null)
  const [inventory, setInventory] = useState<VeraCryptMountInventory | null>(null)
  const [favorites, setFavorites] = useState<VeraCryptFavorite[]>([])
  const [options, setOptions] = useState<VeraCryptMountOptions>(data.veracryptIntent ?? defaultOptions)
  const [operation, setOperation] = useState<VeraCryptOperation | null>(null)
  const [message, setMessage] = useState<VeraCryptMessage | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextAvailability, nextInventory, nextFavorites] = await Promise.all([
        window.nodeTerminal.veracrypt.availability(),
        window.nodeTerminal.veracrypt.refresh(),
        window.nodeTerminal.veracrypt.favorites()
      ])
      setAvailability(nextAvailability)
      setInventory(nextInventory)
      setFavorites(nextFavorites)
      const reason = nextInventory.reason ?? nextAvailability.reason
      setMessage(reason ? factualMessage(reason) : null)
    } catch (error) {
      setMessage(error instanceof Error ? factualMessage(error.message) : authoredMessage('The VeraCrypt manager could not refresh its host state.'))
    }
  }, [])

  useEffect(() => {
    void refresh()
    return window.nodeTerminal.veracrypt.onOperation((next) => setOperation(next))
  }, [refresh])

  const mounted = useMemo(() => inventory?.volumes.filter((volume) => volume.managerCreated) ?? [], [inventory])
  const setOption = <K extends keyof VeraCryptMountOptions>(key: K, value: VeraCryptMountOptions[K]): void => {
    const next = { ...options, [key]: value }
    setOptions(next)
    updateNodeData(id, { veracryptIntent: next })
  }

  const chooseFile = async (): Promise<void> => {
    const path = await window.nodeTerminal.dialog.selectFile()
    if (path) setOption('containerPath', path)
  }

  const mount = async (): Promise<void> => {
    setMessage(null)
    try {
      const preflight = await window.nodeTerminal.veracrypt.preflight(options)
      if (!preflight.ok) {
        if (preflight.reason) setMessage(factualMessage(preflight.reason))
        return
      }
      setOperation(await window.nodeTerminal.veracrypt.mount(options))
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? factualMessage(error.message) : authoredMessage('The VeraCrypt mount could not start.'))
    }
  }

  const saveFavorite = async (): Promise<void> => {
    if (!options.containerPath) return
    const favorite: VeraCryptFavorite = {
      id: `container-${options.containerPath.toLowerCase()}`.slice(0, 128),
      containerPath: options.containerPath,
      preferredDriveLetter: options.driveLetter,
      readOnly: options.readOnly === true,
      removable: options.removable === true,
      preserveTimestamp: options.preserveTimestamp === true,
      exploreAfterMount: options.exploreAfterMount === true
    }
    setFavorites(await window.nodeTerminal.veracrypt.saveFavorite(favorite))
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
        <button type="button" className="term-node__close" onClick={() => void refresh()} title={vocab('Refresh VeraCrypt state')} aria-label={vocab('Refresh VeraCrypt state')}>⟳</button>
      </div>
      <div className="veracrypt-node__body nodrag nowheel">
        <p className={`veracrypt-node__status${unsupported || availability?.state === 'error' ? ' is-error' : ''}`} role={unsupported || availability?.state === 'error' ? 'alert' : 'status'}>{mapVeraCryptMessage(message, availability?.state === 'available' ? 'VeraCrypt is available on this computer.' : 'Checking VeraCrypt availability…', vocab)}</p>
        <p className="veracrypt-node__note">{vocab('Only existing regular files are supported. VeraCrypt collects the password, PIM, keyfiles, and hidden-volume protection choice in its own prompt.')} </p>
        <label className="veracrypt-node__field">{vocab('Container file')}
          <span className="veracrypt-node__path-row"><input value={options.containerPath} onChange={(event) => setOption('containerPath', event.target.value)} placeholder={vocab('Choose an existing container file')} aria-label={vocab('VeraCrypt container file path')} /><button type="button" onClick={() => void chooseFile()} disabled={unsupported}>{vocab('Browse')}</button></span>
        </label>
        <label className="veracrypt-node__field">{vocab('Drive letter')}
          <select value={options.driveLetter} onChange={(event) => setOption('driveLetter', event.target.value)} aria-label={vocab('VeraCrypt drive letter')} disabled={unsupported}><option value="">{vocab('Choose a letter')}</option>{'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => <option key={letter} value={letter}>{letter}: {inventory?.volumes.some((volume) => volume.driveLetter === letter) ? vocab('occupied') : vocab('available')}</option>)}</select>
        </label>
        <div className="veracrypt-node__checks">
          <label><input type="checkbox" checked={options.readOnly === true} onChange={(event) => setOption('readOnly', event.target.checked)} /> {vocab('Read-only')}</label>
          <label><input type="checkbox" checked={options.removable === true} onChange={(event) => setOption('removable', event.target.checked)} /> {vocab('Removable')}</label>
          <label><input type="checkbox" checked={options.preserveTimestamp === true} onChange={(event) => setOption('preserveTimestamp', event.target.checked)} /> {vocab('Preserve timestamp')}</label>
          <label><input type="checkbox" checked={options.exploreAfterMount === true} onChange={(event) => setOption('exploreAfterMount', event.target.checked)} /> {vocab('Explore after mount')}</label>
        </div>
        <div className="veracrypt-node__actions"><button type="button" className="primary" onClick={() => void mount()} disabled={unsupported || operation?.state === 'running'}>{vocab('Mount')}</button><button type="button" onClick={() => void saveFavorite()} disabled={!options.containerPath}>{vocab('Save favorite')}</button><button type="button" onClick={() => setConfirmWipe(true)} disabled={unsupported || operation?.state === 'running'}>{vocab('Wipe password cache')}</button>{operation?.state === 'running' && <button type="button" onClick={() => void window.nodeTerminal.veracrypt.cancel(operation.id)}>{vocab('Cancel')}</button>}</div>
        {confirmWipe && <div className="veracrypt-node__confirm" role="alertdialog" aria-label={vocab('Confirm password cache wipe')}><p>{vocab('Wipe VeraCrypt password cache on this computer? This clears cached credentials and cannot be undone.')}</p><div className="veracrypt-node__actions"><button type="button" className="primary" onClick={() => { setConfirmWipe(false); void window.nodeTerminal.veracrypt.wipeCache().then(setOperation).catch((error) => setMessage(factualMessage(String(error)))) }}>{vocab('Confirm wipe')}</button><button type="button" onClick={() => setConfirmWipe(false)}>{vocab('Cancel')}</button></div></div>}
        {favorites.length > 0 && <section className="veracrypt-node__favorites" aria-label={vocab('VeraCrypt favorites')}><h3>{vocab('Favorites')}</h3>{favorites.map((favorite) => <button type="button" key={favorite.id} onClick={() => loadFavorite(favorite)} title={favorite.containerPath}>{mapVeraCryptFavoriteLabel(favorite.containerPath, favorite.preferredDriveLetter, vocab)}</button>)}</section>}
        <section className="veracrypt-node__mounted" aria-label={vocab('Verified VeraCrypt mounts')}><h3>{vocab('Verified mounts')}</h3>{mounted.length === 0 ? <p>{vocab('No manager-created mounts are currently verified.')}</p> : mounted.map((volume) => <article key={volume.driveLetter}><strong>{volume.driveLetter}:</strong><span>{volume.containerPath ?? vocab('Container path not returned by VeraCrypt')}</span><button type="button" onClick={() => void window.nodeTerminal.veracrypt.explore(volume.driveLetter)}>{vocab('Explore')}</button><button type="button" onClick={() => void window.nodeTerminal.veracrypt.unmount(volume.driveLetter).then(setOperation).then(() => refresh()).catch((error) => setMessage(factualMessage(String(error))))}>{vocab('Unmount')}</button></article>)}</section>
        {operation && <p className="veracrypt-node__operation" role="status">{mapVeraCryptOperationText(operation.message, operation.driveLetter, vocab)}</p>}
      </div>
    </div>
  )
}
