import { useRef, useState } from 'react'
import type { SessionIcon } from '@shared/session-icon'
import { SESSION_ICON_LIMITS, sanitizeSessionIcon } from '@shared/session-icon'
import { Dialog, Button } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { SessionIconGlyph } from './SessionIcon'

export function SessionIconMenu({ open, value, title, onPick, onClose }: {
  open: boolean
  value?: SessionIcon
  title: string
  onPick: (icon?: SessionIcon) => void
  onClose: () => void
}): React.JSX.Element {
  const [emoji, setEmoji] = useState(value?.type === 'emoji' ? value.emoji : '')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const chooseEmoji = (): void => {
    const next = sanitizeSessionIcon({ type: 'emoji', emoji: emoji.trim() })
    if (!next) { setError('Enter one short emoji mark.'); return }
    onPick(next); onClose()
  }
  const chooseImage = (file: File | undefined): void => {
    if (!file) return
    if (file.size > SESSION_ICON_LIMITS.maxImageBytes) { setError('Choose an image under 400 KB.'); return }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Choose a PNG, JPEG, or WebP image.'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : ''
      const image = new Image()
      image.onload = () => {
        const max = SESSION_ICON_LIMITS.maxDimension
        if (image.width < 1 || image.height < 1 || image.width > max || image.height > max) { setError('Choose an image no larger than 512 by 512 pixels.'); return }
        const next = sanitizeSessionIcon({ type: 'image', dataUrl: src, width: image.width, height: image.height })
        if (!next) { setError('That image could not be used safely.'); return }
        onPick(next); onClose()
      }
      image.onerror = () => setError('That image could not be decoded.')
      image.src = src
    }
    reader.onerror = () => setError('That image could not be read locally.')
    reader.readAsDataURL(file)
  }
  return <Dialog open={open} onClose={onClose} title={`Session icon for ${title}`} className="session-icon-menu">
    <div className="session-icon-menu__preview" aria-live="polite"><SessionIconGlyph icon={value} size={32} title={title} /><span>{title}</span></div>
    <label htmlFor="session-icon-emoji">Emoji</label>
    <div className="session-icon-menu__row">
      <Input id="session-icon-emoji" ref={inputRef} value={emoji} maxLength={16} placeholder="🚀" onChange={(e) => setEmoji(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') chooseEmoji() }} />
      <Button variant="tonal" onClick={chooseEmoji}>Use</Button>
    </div>
    <label htmlFor="session-icon-file">Local picture</label>
    <input id="session-icon-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => chooseImage(e.target.files?.[0])} />
    <p className="session-icon-menu__hint">Pictures stay on this machine. Remote URLs, animated images, and images over 400 KB are not accepted.</p>
    {error && <p role="alert" className="session-icon-menu__error">{error}</p>}
    <Button variant="text" onClick={() => { onPick(undefined); onClose() }}>Reset to colour</Button>
  </Dialog>
}
