import type { ReactNode } from 'react'
import { FabMenu, type FabMenuProps } from './FabMenu'

export interface RailDestination {
  id: string
  icon: ReactNode
  label: string
  active: boolean
  /** Rendered as a small pill on the destination's icon (unread notifications, etc). */
  badge?: number
  onClick: (anchor: HTMLElement) => void
}

export interface NavRailProps extends FabMenuProps {
  destinations: RailDestination[]
  kidsLabel: string
  onOpenKids: () => void
}

/**
 * The 88px Material 3 nav rail that replaces the old bottom dock: a FAB that owns node creation
 * (see `FabMenu`) at the top, the primary destinations (Canvas / Board / Files / Tools / Alerts /
 * Settings), and Kids mode pinned to the bottom.
 *
 * Presentation-only — every destination's actual behavior (which drawer opens, what "active"
 * means) is decided by the caller (`Canvas.tsx`), which already owns every one of those open/close
 * states. This keeps the rail itself agnostic of Explorer/Source Control/Converter/Ollama/etc.
 */
export function NavRail({ destinations, kidsLabel, onOpenKids, ...fab }: NavRailProps) {
  return (
    <nav className="md3-nav-rail" aria-label="Primary navigation" data-canvas-chrome>
      <FabMenu {...fab} />
      <div className="md3-nav-rail__items">
        {destinations.map((d) => (
          <button
            key={d.id}
            className={`md3-rail-item${d.active ? ' is-active' : ''}`}
            title={d.label}
            aria-current={d.active || undefined}
            onClick={(e) => d.onClick(e.currentTarget)}
          >
            <span className="md3-rail-item__pill">
              {d.icon}
              {!!d.badge && (
                <span className="md3-rail-badge" aria-hidden>
                  {d.badge > 99 ? '99+' : d.badge}
                </span>
              )}
            </span>
            <span className="md3-rail-item__label">{d.label}</span>
          </button>
        ))}
      </div>
      <div className="md3-nav-rail__spacer" />
      <button className="md3-rail-item md3-rail-item--kids" title={kidsLabel} onClick={onOpenKids}>
        <span className="md3-rail-item__pill">
          <KidsIcon />
        </span>
        <span className="md3-rail-item__label">{kidsLabel}</span>
      </button>
    </nav>
  )
}

function KidsIcon() {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" />
    </svg>
  )
}
