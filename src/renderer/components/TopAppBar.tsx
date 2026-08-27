import type { ReactNode } from 'react'
import { useSettings } from '../state/settings'
import { resolveAppDisplayName } from '@shared/appIdentity'
import { resolveLogoPreset } from './appearance/BrandMark'

interface TopAppBarProps {
  /**
   * Everything to the right of the brand tile: the project switcher, the docked search bar, the
   * presence facepile, and the icon-button cluster. Composed by the caller (`Canvas.tsx`) rather
   * than threaded through as a dozen individual props — those pieces already own their state and
   * handlers there, and this bar is purely the chrome shell around them.
   */
  children?: ReactNode
}

/**
 * The 64px Material 3 top app bar that replaces the old 44px `.tabbar`. Flat (`--md-surface-
 * container`, no border/shadow), the window's drag region (see the `-webkit-app-region` rules in
 * `styles.md3.css`), and the one place the brand mark renders.
 *
 * Native traffic lights (mac) / caption-button overlay (Windows) still live outside React — this
 * only reserves the room for them via CSS padding, exactly as `.tabbar` did.
 */
export function TopAppBar({ children }: TopAppBarProps) {
  const displayName = useSettings((s) => resolveAppDisplayName(s.settings.appDisplayName))
  const appLogo = useSettings((s) => s.settings.appLogo)

  return (
    <div className="md3-app-bar" data-easter-surface="title-bar">
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
      {children}
    </div>
  )
}
