/**
 * Maps a porcelain git status letter (M/A/D/R/U/…) to the CSS class that paints its MD3 tag
 * badge (Source Control's staged/changes rows, and the git-history commit-files list share the
 * exact same letters and colour language). Colours themselves live in styles.md3.css as
 * `var(--md-*)` container/on-container role pairs — never a literal hex here, so this stays a
 * pure name→name lookup rather than something the theming guard has to special-case.
 */
const GIT_STATUS_BADGE_CLASS: Record<string, string> = {
  M: 'md3-status--m',
  A: 'md3-status--a',
  D: 'md3-status--d',
  R: 'md3-status--r',
  U: 'md3-status--u'
}

export function gitStatusBadgeClass(status: string): string {
  return GIT_STATUS_BADGE_CLASS[status] ?? 'md3-status--default'
}
