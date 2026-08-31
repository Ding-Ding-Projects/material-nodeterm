import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '../state/settings'
import { resolveAppDisplayName } from '@shared/appIdentity'
import { resolveLogoPreset } from './appearance/BrandMark'
import { CompactTopBarMenu, type CompactTopBarMenuItem } from './CompactTopBarMenu'

export type TopAppBarMode = 'wide' | 'compact' | 'narrow'

export interface TopAppBarCompactSlots {
  /** The active project switcher, with its existing controlled callbacks. */
  project: ReactNode
  /** The existing command-palette action. It is rendered icon-first by compact CSS. */
  commandPalette: ReactNode
  /** The existing notification action, including its live unread count. */
  notifications: ReactNode
  /** AWS, Multiverse, Portals, collaborators, phone pairing, dictation, and Help actions. */
  menuItems: readonly CompactTopBarMenuItem[]
}

/** Width thresholds are CSS pixels, matching the responsive contract and easy to unit-test. */
export function topAppBarModeForWidth(width: number): TopAppBarMode {
  if (width < 720) return 'narrow'
  if (width < 1280) return 'compact'
  return 'wide'
}

export interface TopAppBarProps {
  /**
   * Everything to the right of the brand tile: the project switcher, the docked search bar, the
   * presence facepile, and the icon-button cluster. Composed by the caller (`Canvas.tsx`) rather
   * than threaded through as a dozen individual props — those pieces already own their state and
   * handlers there, and this bar is purely the chrome shell around them.
   */
  children?: ReactNode
  /** Optional building blocks for the one mounted compact/narrow control set. */
  compactSlots?: TopAppBarCompactSlots
}

/**
 * The 64px Material 3 top app bar that replaces the old 44px `.tabbar`. Flat (`--md-surface-
 * container`, no border/shadow), the window's drag region (see the `-webkit-app-region` rules in
 * `styles.md3.css`), and the one place the brand mark renders.
 *
 * Native traffic lights (mac) / caption-button overlay (Windows) still live outside React — this
 * only reserves the room for them via CSS padding, exactly as `.tabbar` did.
 */
export function TopAppBar({ children, compactSlots }: TopAppBarProps) {
  const displayName = useSettings((s) => resolveAppDisplayName(s.settings.appDisplayName))
  const appLogo = useSettings((s) => s.settings.appLogo)
  const barRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<TopAppBarMode>(() => topAppBarModeForWidth(typeof window === 'undefined' ? 1280 : window.innerWidth))

  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const update = (): void => setMode(topAppBarModeForWidth(bar.getBoundingClientRect().width))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={barRef} className="md3-app-bar" data-easter-surface="title-bar" data-app-bar-mode={mode}>
      <div className="md3-app-bar__brand">
        <span className="md3-app-bar__brand-mark" aria-hidden="true">
          {appLogo.selection === 'custom' && appLogo.customImage ? (
            <img
              src={appLogo.customImage.dataUrl}
              width={22}
              height={22}
              alt=""
              style={{ borderRadius: 6, objectFit: 'contain' }}
            />
          ) : (
            resolveLogoPreset(appLogo.selection).render(22)
          )}
        </span>
        <span className="md3-app-bar__brand-name" data-appearance-id="app:tabbar-brand">
          {displayName}
        </span>
      </div>
      {compactSlots && mode !== 'wide' ? (
        <div className="md3-app-bar__compact" data-app-bar-mode={mode}>
          <div className="md3-app-bar__compact-project">{compactSlots.project}</div>
          <div className="md3-app-bar__compact-action md3-app-bar__compact-action--palette">{compactSlots.commandPalette}</div>
          <div className="md3-app-bar__compact-action">{compactSlots.notifications}</div>
          <CompactTopBarMenu items={compactSlots.menuItems} />
        </div>
      ) : (
        <div className="md3-app-bar__wide">{children}</div>
      )}
    </div>
  )
}
