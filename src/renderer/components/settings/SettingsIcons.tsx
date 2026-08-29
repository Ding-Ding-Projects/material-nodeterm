import type { SettingsSectionId } from './nav'
import { parseProjectSectionId } from './project-settings-targets'

/** The closed part of `SettingsSectionId` — everything except the dynamic `project-${string}`
 *  ids, which don't get their own icon (see the fallback in `SectionIcon`). */
type StaticSettingsSectionId = Exclude<SettingsSectionId, `project-${string}`>

/** One small line glyph per settings section, used in the sidebar nav.
 *  16×16, currentColor stroke — color is driven by the parent (active = accent). */
const PATHS: Record<StaticSettingsSectionId, React.JSX.Element> = {
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M4.8 6.2 6.6 8l-1.8 1.8M8.4 10h2.8" />
    </>
  ),
  shell: <path d="M3 4.5 6 8l-3 3.5M8 11.5h5" />,
  // A screen with the notch bitten out of its top edge.
  notch: (
    <>
      <path d="M2 5V4.5A1.5 1.5 0 0 1 3.5 3h2v1.2a1 1 0 0 0 1 1h2.6a1 1 0 0 0 1-1V3h2.4A1.5 1.5 0 0 1 14 4.5V11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11V5Z" />
      <path d="M5.5 9.2h1.2M9.3 9.2h1.2" />
    </>
  ),
  behavior: (
    <>
      <path d="M2.5 5.5h6M10.5 5.5h3M2.5 10.5h3M7.5 10.5h6" />
      <circle cx="9.3" cy="5.5" r="1.4" />
      <circle cx="6.3" cy="10.5" r="1.4" />
    </>
  ),
  // Stacked file parts + a manifest line, for the split-into-parts storage section.
  'workspace-storage': (
    <>
      <rect x="2.5" y="2.5" width="6" height="4.5" rx="1" />
      <rect x="9.5" y="2.5" width="4" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4" height="4.5" rx="1" />
      <rect x="8.5" y="9" width="5" height="4.5" rx="1" />
    </>
  ),
  appearance: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor" stroke="none" />
    </>
  ),
  phone: (
    <>
      <rect x="4.5" y="2" width="7" height="12" rx="1.6" />
      <path d="M7 12h2" />
    </>
  ),
  speech: (
    <>
      <rect x="6" y="2.2" width="4" height="7" rx="2" />
      <path d="M4 8.2a4 4 0 0 0 8 0M8 12.2v1.6M6.2 13.8h3.6" />
    </>
  ),
  // A keycap — the obvious glyph for configurable keyboard shortcuts.
  // A spotlight: one circle brought forward, the surrounds still drawn rather than removed —
  // the glyph says what Focus mode does, and what it deliberately does not do.
  'adhd-modes': (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6" />
    </>
  ),
  // A keyboard: the outline, two key rows, and a wide space bar.
  shortcuts: (
    <>
      <rect x="1.5" y="4" width="13" height="8" rx="1.8" />
      <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M4 9.6h8" />
    </>
  ),
  agents: (
    <path d="M8 2.3 9.4 5.9 13 7.3 9.4 8.7 8 12.3 6.6 8.7 3 7.3 6.6 5.9z" />
  ),
  'claude-skills': (
    <>
      <path d="M3 3.2h8.2a1.8 1.8 0 0 1 1.8 1.8v7.8H4.8A1.8 1.8 0 0 1 3 11V3.2Z" />
      <path d="M5.2 6h5.2M5.2 8.4h3.8M5.2 10.8h2.5" />
    </>
  ),
  usage: (
    <>
      <path d="M2.5 12.5a5.5 5.5 0 1 1 11 0" />
      <path d="M8 12.5 10.8 8" />
    </>
  ),
  accounts: (
    <>
      <circle cx="8" cy="5.5" r="2.6" />
      <path d="M3.4 13c0-2.5 2.1-4 4.6-4s4.6 1.5 4.6 4" />
    </>
  ),
  'provider-accounts': (
    <>
      <circle cx="5" cy="5" r="2.2" />
      <circle cx="11" cy="11" r="2.2" />
      <path d="m6.6 6.6 2.8 2.8M9.5 4.8h3M11 3.3v3" />
    </>
  ),
  'custom-agents': (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M8 5.5v5M5.5 8h5" />
    </>
  ),
  'model-gateway': (
    <>
      <circle cx="4" cy="8" r="1.6" />
      <circle cx="12" cy="4" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M5.6 7.4 10.4 4.6M5.6 8.6l4.8 2.8" />
    </>
  ),
  notifications: (
    <>
      <path d="M4.8 7a3.2 3.2 0 0 1 6.4 0c0 3 1.1 3.9 1.1 3.9H3.7S4.8 10 4.8 7Z" />
      <path d="M6.7 12.8a1.4 1.4 0 0 0 2.6 0" />
    </>
  ),
  commit: (
    <>
      <circle cx="8" cy="8" r="2.4" />
      <path d="M2.6 8h3M10.4 8h3" />
    </>
  ),
  tmux: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <path d="M8 3v10" />
    </>
  ),
  'github-issues': (
    <>
      <path d="M8 2.2a5.8 5.8 0 0 0-1.8 11.3c.3.1.4-.1.4-.3v-1.1c-1.7.4-2.1-.7-2.1-.7-.3-.8-.8-1-1-1.1-.7-.4.1-.4.1-.4.8.1 1.2.8 1.2.8.7 1.2 1.8.8 2.2.6.1-.5.3-.8.5-1-1.4-.2-2.8-.7-2.8-3a2.4 2.4 0 0 1 .6-1.6 2.2 2.2 0 0 1 .1-1.6s.5-.2 1.7.6a5.7 5.7 0 0 1 3.1 0c1.2-.8 1.7-.6 1.7-.6a2.2 2.2 0 0 1 .1 1.6 2.4 2.4 0 0 1 .6 1.6c0 2.3-1.4 2.8-2.8 3 .2.2.4.6.4 1.2v1.7c0 .2.1.4.4.3A5.8 5.8 0 0 0 8 2.2Z" />
    </>
  ),
  license: (
    <>
      <circle cx="5.6" cy="5.6" r="2.6" />
      <path d="M7.4 7.4 13 13M10.8 10.8l1.4-1.4M9.4 9.4l1.2-1.2" />
    </>
  ),
  presence: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="2" />
      <circle cx="6" cy="6.6" r="1.5" />
      <path d="M3.8 11c.2-1.3 1.2-2 2.2-2s2 .7 2.2 2M9.6 6.5h2.4M9.6 9h2" />
    </>
  ),
  remote: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.9 1.7 1.9 9.3 0 11M8 2.5c-1.9 1.7-1.9 9.3 0 11" />
    </>
  ),
  'team-access': (
    <>
      <circle cx="6" cy="5.5" r="2.2" />
      <path d="M2.2 12.5c0-2.1 1.7-3.4 3.8-3.4s3.8 1.3 3.8 3.4" />
      <path d="M10.6 3.6a2.2 2.2 0 0 1 0 4.2M11.4 9.3c1.5.4 2.4 1.6 2.4 3.2" />
    </>
  ),
  ssh: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M4.6 6.2 6.4 8l-1.8 1.8M8 10h3" />
    </>
  ),
  updates: <path d="M8 2.6v7M5 6.6 8 9.6l3-3M3.6 12.6h8.8" />,
  privacy: <path d="M8 2.4 12.4 4.2V8c0 3-2 4.8-4.4 5.6C5.6 12.8 3.6 11 3.6 8V4.2Z" />,
  // A speech bubble with a globe grid inside it — "the language this app speaks".
  language: (
    <>
      <path d="M2.5 3.6h11v6.4H8.6L6 12.6v-2.6H2.5Z" />
      <path d="M4.6 6.8h6.8M6.4 3.6a5.4 5.4 0 0 0 0 6.4M9.6 3.6a5.4 5.4 0 0 1 0 6.4" />
    </>
  ),
  // A speaker with two emanating arcs — the narrator SPEAKING, distinct from `language`'s
  // bubble (which is about which language the UI is written in, not what is read aloud).
  narrator: (
    <>
      <path d="M3 6.2h2L7.6 4v8L5 9.8H3Z" />
      <path d="M10 6a2.6 2.6 0 0 1 0 4M11.8 4.2a5.2 5.2 0 0 1 0 7.6" />
    </>
  ),
  // A padlock with a smile in the shackle — it is a TOY lock, and the icon should not promise
  // security the feature explicitly disclaims.
  toylocks: (
    <>
      <rect x="3.4" y="7" width="9.2" height="6.2" rx="1.6" />
      <path d="M5.8 7V5.4a2.2 2.2 0 0 1 4.4 0V7" />
      <path d="M6.6 9.8a1.6 1.6 0 0 0 2.8 0" />
    </>
  ),
  // A shield with a 6-digit rhythm of dashes — a rotating code, not a stored password.
  authenticator: (
    <>
      <path d="M8 2.4 12.4 4.2V8c0 3-2 4.8-4.4 5.6C5.6 12.8 3.6 11 3.6 8V4.2Z" />
      <path d="M5.9 7.6h.9M7.5 7.6h1M9.2 7.6h.9M6.6 9.6h2.8" />
    </>
  ),
  // A life-ring — the help desk that exists to get you out, not to answer you.
  support: (
    <>
      <circle cx="8" cy="8" r="5.4" />
      <circle cx="8" cy="8" r="2.2" />
      <path d="M4.2 4.2 6.4 6.4M11.8 4.2 9.6 6.4M4.2 11.8 6.4 9.6M11.8 11.8 9.6 9.6" />
    </>
  ),
  // A clock with a counter-clockwise arrow — "go back to how it was", not "what time is it".
  history: (
    <>
      <path d="M2.8 7.4a5.4 5.4 0 1 0 1.7-3.6L2.6 5.6" />
      <path d="M2.4 2.8v3h3" />
      <path d="M8 5.2v3l2 1.2" />
    </>
  ),
  // A paint roller over a rectangle — editing how one ELEMENT looks, as opposed to `appearance`'s
  // whole-theme disc.
  'appearance-editor': (
    <>
      <rect x="2.4" y="2.8" width="7" height="3.4" rx="1" />
      <path d="M9.4 4.5h2.6a1 1 0 0 1 1 1v1.3a1 1 0 0 1-1 1H7.6" />
      <rect x="6.2" y="8.4" width="2.8" height="4.8" rx="1" />
    </>
  ),
  // A tag/label with a dot — the app's own NAME and mark, which the user may change.
  'app-identity': (
    <>
      <path d="M2.6 7.4V3.4a.8.8 0 0 1 .8-.8h4l6 6-4.8 4.8-6-6Z" />
      <circle cx="5.4" cy="5.4" r="1" />
    </>
  ),
  // A calendar page with a clock face on it — a rule is a DATE window plus a TIME window, and
  // either half alone would misdescribe it.
  schedule: (
    <>
      <path d="M2.6 4.4h10.8v8.2H2.6zM2.6 6.8h10.8M5.4 2.8v2M10.6 2.8v2" />
      <path d="M8 8.4v2l1.4.9" />
    </>
  ),
  planner: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5v3.8l2.4 1.4M4 2.8v2M12 2.8v2" />
    </>
  ),
  'school-mode': (
    <>
      <path d="M2.4 5.6 8 3l5.6 2.6L8 8.2 2.4 5.6Z" />
      <path d="M4.4 6.8v3c0 1 1.6 2 3.6 2s3.6-1 3.6-2v-3M13.6 5.6v4.4" />
    </>
  ),
  // A kite: a child's thing, and distinct at 16px from the mortarboard beside it — two icons that
  // read alike in a sidebar are two icons nobody can tell apart at a glance.
  'kids-mode': (
    <>
      <path d="M8 1.8 12.5 6 8 10.2 3.5 6 8 1.8Z" />
      <path d="M8 1.8v8.4M3.5 6h9" />
      <path d="M8 10.2c0 1.6-.8 2.4-1.6 3.2" />
    </>
  ),
  vocabulary: (
    <>
      <path d="M4 3h6.4L13 5.6V13H4z" />
      <path d="M10.4 3v2.6H13M6 8h4M6 10.4h4" />
    </>
  ),
  // A tiny bug (the debug section).
  debug: (
    <>
      <circle cx="8" cy="9" r="3.5" />
      <path d="M8 5.5V3.5M4.9 6.6 3.4 5.1M11.1 6.6l1.5-1.5M4.5 9H2.5M13.5 9h-2M4.9 11.4l-1.5 1.5M11.1 11.4l1.5 1.5" />
    </>
  ),
}

// A small folder glyph, used for project sections — those ids are dynamic (one per open
// project), so there's no per-project entry in `PATHS`.
const PROJECT_FALLBACK: React.JSX.Element = (
  <path d="M2.5 4.8A1.3 1.3 0 0 1 3.8 3.5h2.6l1.3 1.5h4.5a1.3 1.3 0 0 1 1.3 1.3v5A1.3 1.3 0 0 1 12.2 12.6H3.8a1.3 1.3 0 0 1-1.3-1.3Z" />
)

export function SectionIcon({ id }: { id: SettingsSectionId }): React.JSX.Element {
  const path = parseProjectSectionId(id) !== null ? PROJECT_FALLBACK : PATHS[id as StaticSettingsSectionId]
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}
