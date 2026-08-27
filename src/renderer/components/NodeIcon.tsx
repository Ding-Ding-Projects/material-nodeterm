import type { NodeIcon } from '@shared/node-icon'
import { useNodeIconSrc } from '../lib/nodeIconImage'

export interface NodeIconViewProps {
  icon?: NodeIcon
  size?: number
  className?: string
  projectId?: string
}

export function NodeIconView({ icon, size = 14, className, projectId }: NodeIconViewProps): React.JSX.Element | null {
  const src = useNodeIconSrc(icon, projectId)
  if (!icon) return null
  const cls = `node-icon${className ? ` ${className}` : ''}`
  if (icon.type === 'emoji') {
    return (
      <span className={cls} style={{ width: size, height: size, fontSize: Math.round(size * 0.92) }} aria-hidden>
        {icon.value}
      </span>
    )
  }
  if (!src) return null
  return (
    <span className={cls} style={{ width: size, height: size }} aria-hidden>
      <img src={src} alt="" draggable={false} />
    </span>
  )
}
