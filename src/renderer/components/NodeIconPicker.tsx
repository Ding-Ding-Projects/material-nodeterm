import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { normalizeNodeIcon, portableIconPath, type NodeIcon } from '@shared/node-icon'
import { canvasImportRefusal } from '../canvas/canvas-image-import'
import { useProjects } from '../state/projects'
import { sessionForProject } from '../session/session'
import { useDialogStack } from './dialog-stack'
import { Button } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

const PALETTE: readonly string[] = [
  '\u{1F680}', '\u{1F525}', '\u{2B50}', '\u{26A1}', '\u{1F41B}', '\u{1F527}',
  '\u{1F9EA}', '\u{1F4E6}', '\u{1F310}', '\u{1F512}', '\u{1F5C4}', '\u{1F4CA}',
  '\u{1F3AF}', '\u{1F4DD}', '\u{1F4DA}', '\u{1F9E0}', '\u{1F916}', '\u{1F441}',
  '\u{1F3D7}', '\u{1F9F9}', '\u{1F6A8}', '\u{1F6A7}', '\u{2705}', '\u{1F534}',
  '\u{1F7E2}', '\u{1F535}', '\u{1F7E1}', '\u{1F7E3}', '\u{1F3A8}', '\u{1F3B5}',
  '\u{2615}', '\u{1F31E}', '\u{1F319}', '\u{1F332}', '\u{1F433}', '\u{1F431}'
]

export type NodeIconChoice = NodeIcon | null | undefined

interface DialogState {
  current: { nodeId: string; title: string; icon?: NodeIcon; resolve: (choice: NodeIconChoice) => void } | null
}

const useStore = create<DialogState>(() => ({ current: null }))

export function nodeIconDialog(opts: { nodeId: string; title: string; icon?: NodeIcon }): Promise<NodeIconChoice> {
  return new Promise((resolve) => {
    const previous = useStore.getState().current
    if (previous) {
      useStore.setState({ current: null })
      previous.resolve(undefined)
    }
    useStore.setState({ current: { ...opts, resolve } })
  })
}

export function NodeIconDialogHost(): React.JSX.Element | null {
  const current = useStore((state) => state.current)
  if (!current) return null
  const finish = (choice: NodeIconChoice): void => {
    useStore.setState({ current: null })
    current.resolve(choice)
  }
  return <NodeIconPicker title={current.title} icon={current.icon} onDone={finish} />
}

function NodeIconPicker({ title, icon, onDone }: { title: string; icon?: NodeIcon; onDone: (choice: NodeIconChoice) => void }): React.JSX.Element {
  const [typed, setTyped] = useState(icon?.type === 'emoji' ? icon.value : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useDialogStack()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const commitTyped = (raw: string): void => {
    const next = normalizeNodeIcon({ type: 'emoji', value: raw })
    onDone(next ?? null)
  }

  const chooseImage = async (): Promise<void> => {
    setError('')
    const { activeProjectId, getProject } = useProjects.getState()
    const project = activeProjectId ? getProject(activeProjectId) : undefined
    if (!project) return
    const refusal = canvasImportRefusal(!!project.remote)
    if (refusal) {
      setError(refusal)
      return
    }
    const api = sessionForProject(project.id).api
    const picked = await api.dialog.selectFile()
    if (!picked) return
    setBusy(true)
    try {
      const base64 = await api.fs.readBinary(picked)
      if (!base64) {
        setError('Could not read that file.')
        return
      }
      const name = picked.replace(/\\/g, '/').split('/').pop() || 'icon.png'
      const saved = await api.files.saveCanvasImage(project.id, name, base64)
      if (!saved) {
        setError('Could not save the image. Check that this project folder is writable.')
        return
      }
      const stored = portableIconPath(saved, project.ssh ? undefined : project.cwd)
      const next = normalizeNodeIcon({ type: 'image', path: stored })
      if (!next) {
        setError('That file type cannot be used as an icon. Try PNG, JPEG, GIF, WEBP or SVG.')
        return
      }
      onDone(next)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="confirm-overlay" onClick={() => onDone(undefined)}>
      <div className="confirm node-icon-dialog" onClick={(event) => event.stopPropagation()}>
        <p className="confirm__msg">Icon for {title || 'this node'}</p>
        <div className="node-icon-dialog__grid">
          {PALETTE.map((entry) => (
            <Button variant="outlined" size="small" vocabularyMode="factual" key={entry} type="button" aria-label={`Use ${entry} as the session icon`} className={`node-icon-dialog__swatch${icon?.type === 'emoji' && icon.value === entry ? ' is-current' : ''}`} onClick={() => onDone({ type: 'emoji', value: entry })}>
              {entry}
            </Button>
          ))}
        </div>
        <div className="node-icon-dialog__row">
          <Input vocabularyMode="factual" ref={inputRef} className="confirm__input node-icon-dialog__input" value={typed} placeholder="Or type any emoji or character" spellCheck={false} onChange={(event) => setTyped(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); commitTyped(typed) }
            else if (event.key === 'Escape') { event.preventDefault(); onDone(undefined) }
          }} />
          <Button variant="outlined" size="small" vocabularyMode="factual" className="confirm__btn" disabled={busy} onClick={() => void chooseImage()}>{busy ? 'Copying…' : 'Choose image…'}</Button>
        </div>
        {error && <p className="node-icon-dialog__error">{error}</p>}
        <div className="confirm__actions">
          <Button variant="outlined" size="small" vocabularyMode="factual" className="confirm__btn" disabled={!icon} onClick={() => onDone(null)}>Remove icon</Button>
          <Button variant="outlined" size="small" vocabularyMode="factual" className="confirm__btn" onClick={() => onDone(undefined)}>Cancel</Button>
          <Button variant="filled" size="small" vocabularyMode="factual" type="button" className="confirm__btn primary" onClick={() => commitTyped(typed)}>Use</Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
