import { useEffect } from 'react'
import { useI18n } from '@renderer/lib/i18n'
import { Localized } from '@renderer/ui/Localized'
import { useSettings } from '../state/settings'
import { resolveAppDisplayName } from '@shared/appIdentity'
import { resolveLogoPreset } from './appearance/BrandMark'

/**
 * Whether the start screen may be dismissed back to whatever is behind it. `hasOpenProjects` is
 * deliberately the ONLY input — a workspace holding only CLOSED projects still returns false,
 * i.e. no dismiss control. That is a considered choice, not an oversight (issue #128): dismissing
 * with zero open projects would reveal an empty canvas with no active tab, and this screen is the
 * ONLY place "Recently closed" is browsable and reopenable (see Canvas.tsx — no sidebar, palette
 * command, or tab-bar entry lists closed projects). Hiding the dismiss control there keeps the one
 * useful action — reopen a closed project — in view instead of one click behind a blank canvas.
 * Pure so Canvas.tsx's choice is unit-testable without pulling in the whole Canvas module.
 */
export function canDismissWelcomeScreen(hasOpenProjects: boolean): boolean {
  return hasOpenProjects
}

interface WelcomeScreenProps {
  onNewProject: () => void
  onOpenFolder: () => void
  onCloneRepo: () => void
  /** Open the "Connect over SSH…" flow to create a project hosted on a remote server. */
  onConnectSsh: () => void
  /** Closed projects that can be reopened (id + display name + folder). */
  closedProjects?: { id: string; name: string; cwd?: string }[]
  /** Reopen a closed project (restores its nodes + sessions). */
  onReopen?: (id: string) => void
  /**
   * Request permanent deletion of a closed project (ends its tmux sessions — irreversible).
   * The button element is handed along so the caller can anchor a destructive-confirmation
   * gate beside it rather than deleting on a single click.
   */
  onDeleteClosed?: (id: string, name: string, anchorEl: HTMLElement) => void
  /**
   * When provided, the screen is dismissable (opened on demand via "+", over existing projects):
   * a labeled "Back to your projects" button (the primary, always-visible way out — see
   * canDismissWelcomeScreen above), a small corner "×" for anyone who reaches for that instead,
   * plus Escape and click-outside as bonus shortcuts. Omitted for the permanent no-projects
   * screen, where there is genuinely nothing behind it to return to.
   */
  onClose?: () => void
  /**
   * Raise the screen above the kanban board overlay (z 25). Without this, opening "+" while a
   * project is in kanban view left the (z 5) welcome screen painted BEHIND the opaque board, so
   * nothing appeared. No effect on the canvas, where the welcome screen already sits on top.
   */
  overBoard?: boolean
}

/** Start screen with quick actions — shown when there are no projects, or on demand via "+". */
export function WelcomeScreen({
  onNewProject,
  onOpenFolder,
  onCloneRepo,
  onConnectSsh,
  closedProjects = [],
  onReopen,
  onDeleteClosed,
  onClose,
  overBoard
}: WelcomeScreenProps) {
  const { ts } = useI18n()
  const appLogo = useSettings((s) => s.settings.appLogo)
  const displayName = useSettings((s) => resolveAppDisplayName(s.settings.appDisplayName))
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={overBoard ? 'md3-welcome md3-welcome--over-board' : 'md3-welcome'}
      onClick={onClose ? (e) => e.target === e.currentTarget && onClose() : undefined}
    >
      {onClose && (
        <>
          {/* PRIMARY, obvious way out — a labeled button, not just Escape or click-outside (both
              are invisible affordances a distracted or worried user won't find). Reported in #128:
              a user who started a new project, changed their mind mid-picker, and could not find a
              way back to the 4 projects they still had — the only exit at the time was a faint
              corner "×" and the keyboard/click-outside paths nobody could see. This button, plus
              the reassurance line beside it, is the fix: always visible, always labeled, and says
              plainly that nothing here touches the other projects. */}
          <div className="md3-welcome__topbar">
            <button
              className="md3-welcome__back"
              onClick={onClose}
              title={ts('welcome.back', 'Back to your projects')}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 6l-6 6 6 6" />
              </svg>
              <span>{ts('welcome.back', 'Back to your projects')}</span>
            </button>
            <span className="md3-welcome__back-note">
              {ts('welcome.back.note', "They're untouched — nothing here changes them.")}
            </span>
          </div>
          {/* Secondary, conventional corner close — kept for anyone who already reaches for it by
              habit. The button above is the one this screen relies on being found. */}
          <button
            className="md3-welcome__close"
            onClick={onClose}
            title={ts('welcome.close', 'Close')}
            aria-label={ts('welcome.close', 'Close')}
          >
            ×
          </button>
        </>
      )}

      <div className="md3-welcome__hero">
        <div className="md3-welcome__brand">
          <span className="md3-welcome__brand-mark" aria-hidden="true">
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
          <span className="md3-welcome__brand-name">{displayName}</span>
        </div>

        <Localized
          id="welcome.tagline"
          fallback="A canvas of terminals. Start a project to begin."
          as="h1"
          className="md3-welcome__title"
          secondaryClassName="md3-welcome__title-secondary"
        />
        <Localized
          id="welcome.subtitle"
          fallback="Open a project to place shells, agents and notes on one canvas — every project is also a board of its live sessions."
          as="p"
          className="md3-welcome__subtitle"
          secondaryClassName="md3-welcome__subtitle-secondary"
        />

        <div className="md3-welcome__cards">
          <button className="md3-welcome__card md3-welcome__card--primary" onClick={onNewProject}>
            <svg
              className="md3-welcome__card-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <path d="M12 11v5M9.5 13.5h5" />
            </svg>
            <span className="md3-welcome__card-body">
              <span className="md3-welcome__card-title">{ts('welcome.card.newProject', 'New project')}</span>
              <span className="md3-welcome__card-desc">{ts('welcome.card.newProject.desc', 'An empty canvas')}</span>
            </span>
          </button>

          <button className="md3-welcome__card" onClick={onOpenFolder}>
            <svg
              className="md3-welcome__card-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span className="md3-welcome__card-body">
              <span className="md3-welcome__card-title">{ts('welcome.card.openFolder', 'Open folder…')}</span>
              <span className="md3-welcome__card-desc">{ts('welcome.card.openFolder.desc', 'Point at a repo')}</span>
            </span>
          </button>

          <button className="md3-welcome__card" onClick={onCloneRepo}>
            <svg
              className="md3-welcome__card-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3v10M8 9l4 4 4-4" />
              <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
            </svg>
            <span className="md3-welcome__card-body">
              <span className="md3-welcome__card-title">{ts('welcome.card.cloneRepo', 'Clone repo…')}</span>
              <span className="md3-welcome__card-desc">{ts('welcome.card.cloneRepo.desc', 'From GitHub or a URL')}</span>
            </span>
          </button>

          <button className="md3-welcome__card" onClick={onConnectSsh}>
            <svg
              className="md3-welcome__card-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M7 10l3 2-3 2M13 14h4" />
            </svg>
            <span className="md3-welcome__card-body">
              <span className="md3-welcome__card-title">{ts('welcome.card.connectSsh', 'Connect over SSH…')}</span>
              <span className="md3-welcome__card-desc">{ts('welcome.card.connectSsh.desc', 'Work on a remote host')}</span>
            </span>
          </button>
        </div>

        {closedProjects.length > 0 && (
          <div className="md3-welcome__recent">
            <div className="md3-welcome__recent-title">
              {ts('welcome.recent.title', 'Recently closed')}
            </div>
            <div className="md3-welcome__recent-list">
              {closedProjects.map((p) => (
                <div
                  key={p.id}
                  className="md3-welcome__recent-item"
                  role="button"
                  tabIndex={0}
                  title={p.cwd || p.name}
                  onClick={() => onReopen?.(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') onReopen?.(p.id)
                  }}
                >
                  <svg
                    className="md3-welcome__recent-icon"
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  <span className="md3-welcome__recent-name">{p.name}</span>
                  {p.cwd && <span className="md3-welcome__recent-path">{p.cwd}</span>}
                  <span className="md3-welcome__recent-spacer" />
                  {onDeleteClosed && (
                    <button
                      className="md3-welcome__recent-del"
                      title={ts('welcome.recent.deleteTitle', 'Delete permanently (ends its sessions)')}
                      // The accessible name NAMES THE PROJECT: a screen-reader user moving down a
                      // list of recent projects hears this button once per row, and an identical
                      // label on every one of them says nothing about which project it destroys.
                      aria-label={`${ts('welcome.recent.deleteAria', 'Delete permanently')} — ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteClosed(p.id, p.name, e.currentTarget)
                      }}
                    >
                      ×
                    </button>
                  )}
                  <svg
                    className="md3-welcome__recent-arrow"
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
