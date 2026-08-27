import { useEffect, useMemo, useRef, useState } from 'react'
import { AnchoredPopover } from '../ui/AnchoredPopover'
import { Dialog } from '../ui/md3/Dialog'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import {
  activatePortableDoor,
  createPortableDoorConstruction,
  DOOR_PART_IDS,
  type DoorMaterial,
  type DoorPartId,
  type PortableDoorConstructionV3,
  type PortableDoorPartV3
} from '@shared/door-construction'

export interface DoorConstructionDialogProps {
  open: boolean
  onClose: () => void
  /** Parent canvas is a safe project identifier, never a machine path or runtime handle. */
  canvasId: string
  targetCanvasId: string
  doorId: string
  pairedDoorId: string
  initialLabel?: string
  onConstruct: (construction: PortableDoorConstructionV3) => void
}

interface PartChoice {
  material: DoorMaterial
  title: string
  description: string
}

const PART_CHOICES: Record<Exclude<DoorPartId, 'activation-core'>, readonly PartChoice[]> = {
  frame: [
    { material: 'stone', title: 'Stone frame', description: 'A sturdy frame that marks the doorway.' },
    { material: 'wood', title: 'Wood frame', description: 'A warm frame with a simple grain.' },
    { material: 'metal', title: 'Metal frame', description: 'A clean frame for a technical doorway.' }
  ],
  hinges: [
    { material: 'metal', title: 'Metal hinges', description: 'A pair of visible hinges for the swing.' },
    { material: 'stone', title: 'Stone pivots', description: 'Heavy pivots for a grounded door.' }
  ],
  panel: [
    { material: 'wood', title: 'Wood panel', description: 'A solid panel that fills the frame.' },
    { material: 'metal', title: 'Metal panel', description: 'A durable panel with a crisp finish.' },
    { material: 'glass', title: 'Glass panel', description: 'A transparent panel that keeps the room visible.' }
  ],
  handle: [
    { material: 'metal', title: 'Metal handle', description: 'A tactile handle for deliberate activation.' },
    { material: 'wood', title: 'Wood handle', description: 'A compact handle matching a timber door.' }
  ]
}

const DEFAULT_PARTS: Record<Exclude<DoorPartId, 'activation-core'>, PortableDoorPartV3> = {
  frame: { id: 'frame', label: 'Door frame', material: 'stone', geometry: { x: 0, y: 0, width: 360, height: 520 }, enabled: true },
  hinges: { id: 'hinges', label: 'Hinges', material: 'metal', geometry: { x: 20, y: 80, width: 48, height: 360 }, enabled: true },
  panel: { id: 'panel', label: 'Door panel', material: 'wood', geometry: { x: 56, y: 16, width: 280, height: 488 }, enabled: true },
  handle: { id: 'handle', label: 'Handle', material: 'metal', geometry: { x: 280, y: 244, width: 48, height: 48 }, enabled: true }
}

function partLabel(id: DoorPartId, ts: ReturnType<typeof useLocalizedVocabularyText>): string {
  return id === 'activation-core'
    ? ts('doorConstruction.part.activationCore', 'Activation core')
    : ts(`doorConstruction.part.${id}`, DEFAULT_PARTS[id].label)
}

function choiceText(
  part: Exclude<DoorPartId, 'activation-core'>,
  choice: PartChoice,
  field: 'title' | 'description',
  ts: ReturnType<typeof useLocalizedVocabularyText>
): string {
  return ts(`doorConstruction.choice.${part}.${choice.material}.${field}`, choice[field])
}

interface PartPickerProps {
  part: Exclude<DoorPartId, 'activation-core'>
  selected: PortableDoorPartV3
  onChoose: (choice: PartChoice) => void
  ts: ReturnType<typeof useLocalizedVocabularyText>
}

function PartPicker({ part, selected, onChoose, ts }: PartPickerProps): React.JSX.Element {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const search = useRegexSearchField()
  const [open, setOpen] = useState(false)
  const choices = PART_CHOICES[part]
  const visible = useMemo(() => choices.filter((choice) => search.test(`${choiceText(part, choice, 'title', ts)} ${choice.material} ${choiceText(part, choice, 'description', ts)}`)), [choices, part, search, ts])
  const selectedChoice = choices.find((choice) => choice.material === selected.material) ?? choices[0]

  return (
    <div className="door-construction__picker">
      <span className="door-construction__picker-label">{partLabel(part, ts)}</span>
      <button
        ref={anchorRef}
        type="button"
        className="door-construction__picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value)
          window.setTimeout(() => inputRef.current?.focus(), 0)
        }}
      >
        <span>{choiceText(part, selectedChoice, 'title', ts)}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <AnchoredPopover
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        width={360}
        className="door-construction__picker-popover"
        zIndex={110}
      >
        <div className="door-construction__picker-heading">
          <strong>{partLabel(part, ts)}</strong>
          <span>{ts('doorConstruction.picker.hint', 'Choose a real part, then continue to the next step.')}</span>
        </div>
        <div className="door-construction__search">
          <label htmlFor={`door-${part}-search`}>{ts('doorConstruction.search.label', 'Search available parts')}</label>
          <div className="door-construction__search-row">
            <input
              ref={inputRef}
              id={`door-${part}-search`}
              type="search"
              value={search.value}
              placeholder={ts('doorConstruction.search.placeholder', 'Name or material')}
              onChange={(event) => search.setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  if (search.active) {
                    event.preventDefault()
                    search.reset()
                  } else setOpen(false)
                }
              }}
            />
            <AnchoredRegexBuilder
              search={search}
              fieldRef={inputRef}
              label={ts('doorConstruction.search.regex', 'Open regex builder for this part search')}
              zIndex={114}
            />
          </div>
          <span role="status">{search.error ?? ts('doorConstruction.search.count', '{count} parts shown', { count: String(visible.length) })}</span>
        </div>
        <div className="door-construction__picker-list" role="listbox" aria-label={partLabel(part, ts)}>
          {visible.length === 0 ? (
            <p role="status">{ts('doorConstruction.search.empty', 'No parts match this search.')}</p>
          ) : visible.map((choice) => (
            <button
              key={choice.material}
              type="button"
              role="option"
              aria-selected={choice.material === selected.material}
              className={choice.material === selected.material ? 'is-selected' : ''}
              onClick={() => { onChoose(choice); setOpen(false) }}
            >
              <strong>{choiceText(part, choice, 'title', ts)}</strong>
              <span>{choiceText(part, choice, 'description', ts)}</span>
              <small>{choice.material}</small>
            </button>
          ))}
        </div>
      </AnchoredPopover>
    </div>
  )
}

/** Guided, keyboard-operable construction of one portable door side. */
export function DoorConstructionDialog({ open, onClose, canvasId, targetCanvasId, doorId, pairedDoorId, initialLabel, onConstruct }: DoorConstructionDialogProps): React.JSX.Element {
  const ts = useLocalizedVocabularyText()
  const [label, setLabel] = useState('New Multiverse door')
  const [parts, setParts] = useState(DEFAULT_PARTS)
  const [armed, setArmed] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel(initialLabel?.trim() || 'New Multiverse door')
    setParts(DEFAULT_PARTS)
    setArmed(false)
    setMessage(null)
  }, [initialLabel, open])

  const construction = useMemo(() => createPortableDoorConstruction({
    doorId,
    canvasId,
    targetCanvasId,
    pairedDoorId,
    label,
    ...parts,
    activationCore: { id: 'activation-core', label: 'Activation core', mode: 'door-only', armed }
  }), [armed, canvasId, doorId, label, pairedDoorId, parts, targetCanvasId])
  const missing = useMemo(() => {
    const list = DOOR_PART_IDS.filter((id): id is DoorPartId => id === 'activation-core'
      ? !armed
      : !parts[id as Exclude<DoorPartId, 'activation-core'>].enabled)
    return list
  }, [armed, parts])
  const readyForArming = missing.length === 1 && missing[0] === 'activation-core'
  const disabledReason = !label.trim()
    ? ts('doorConstruction.nameRequired', 'Give the door a name before continuing.')
    : missing.length > 0
      ? ts('doorConstruction.missingParts', 'Configure {parts} before activating the door.', { parts: missing.join(', ') })
      : null

  const choose = (partId: Exclude<DoorPartId, 'activation-core'>, choice: PartChoice): void => {
    setParts((current) => ({
      ...current,
      [partId]: { ...current[partId], material: choice.material, enabled: true }
    }))
    setMessage(null)
  }

  const arm = (): void => {
    if (!readyForArming) return
    setArmed(true)
    setMessage(ts('doorConstruction.armed', 'Activation core armed. Review the construction, then activate the door.'))
  }

  const submit = (): void => {
    const result = activatePortableDoor(construction)
    if (!result.activated) {
      setMessage(result.reason)
      return
    }
    onConstruct(result.construction)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={ts('doorConstruction.title', 'Construct a Multiverse door')}
      className="door-construction-dialog"
      closeOnScrimClick={false}
    >
      <p className="door-construction__intro">
        {ts('doorConstruction.description', 'Build the frame, hinges, panel, handle, and activation core. Only safe door intent travels with the project; local credentials and runtime state stay on this computer.')}
      </p>
      <p className="door-construction__route" role="note">
        {ts('doorConstruction.route', 'Route: {from} → {to}', { from: canvasId, to: targetCanvasId })}
      </p>
      <label className="door-construction__field">
        <span>{ts('doorConstruction.name', 'Door name')}</span>
        <input value={label} maxLength={512} onChange={(event) => { setLabel(event.target.value); setMessage(null) }} />
      </label>
      <section className="door-construction__parts" aria-label={ts('doorConstruction.parts', 'Door parts')}>
        {(Object.keys(DEFAULT_PARTS) as Array<Exclude<DoorPartId, 'activation-core'>>).map((partId) => (
          <PartPicker
            key={partId}
            part={partId}
            selected={parts[partId]}
            ts={ts}
            onChoose={(choice) => choose(partId, choice)}
          />
        ))}
        <div className="door-construction__core" role="status" aria-live="polite">
          <strong>{partLabel('activation-core', ts)}</strong>
          <span>{armed ? ts('doorConstruction.core.armed', 'Armed and ready for activation.') : ts('doorConstruction.core.waiting', 'Waiting until the other four parts are configured.')}</span>
          <button type="button" disabled={!readyForArming} title={!readyForArming ? disabledReason ?? ts('doorConstruction.core.disabled', 'Configure the four physical parts first.') : undefined} onClick={arm}>
            {ts('doorConstruction.arm', 'Arm activation core')}
          </button>
        </div>
      </section>
      {disabledReason && <p className="door-construction__status" role="status">{disabledReason}</p>}
      {message && <p className="door-construction__message" role="status">{message}</p>}
      <div className="door-construction__actions">
        <button type="button" onClick={onClose}>{ts('doorConstruction.cancel', 'Cancel')}</button>
        <button type="button" disabled={!!disabledReason} title={disabledReason ?? undefined} onClick={submit}>{ts('doorConstruction.activate', 'Activate door')}</button>
      </div>
    </Dialog>
  )
}

export default DoorConstructionDialog
