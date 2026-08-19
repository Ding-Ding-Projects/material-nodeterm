// site/app/features/screenshots.js
//
// The "Screenshots" room: real captures of the built desktop app.
//
// Why this room exists at all. This site is a product tour of a desktop app most visitors have not
// installed, and until now it showed them no picture of it — the app captures lived only in
// docs/assets/shots/, which GitHub Pages never serves (.github/workflows/pages.yml uploads `site`
// and nothing else). A tour of an interface with no image of the interface is a leaflet.
//
// Every image here is a capture of the real built artifact, taken by scripts/capture-shots.mjs
// against out/ over CDP — never a mockup, never a design file, never a crop of the prototypes in
// design/. That same run writes both docs/assets/shots/ and site/assets/shots/, and
// scripts/check-site-shots.mjs asserts the two stay byte-identical, so the picture the site
// publishes cannot drift from the one the docs cite.
//
// The room renders its own gallery rather than using registerListRoom, because a list row's
// thumbnail is 44px and a 44px screenshot shows nothing. That trade comes with an obligation: the
// shell renders this room's search field and its regex builder for us (core/render.js line ~234,
// outside the kind branch), so a custom render that ignored the query would ship a search box that
// does nothing — the decorative-control defect this project forbids everywhere else. It filters.

import { registerRoom } from '../core/engine.js'
import { makeMatcher } from '../core/store.js'
import { esc, attr } from '../core/dom.js'

/**
 * One entry per required surface in scripts/capture-shots.mjs. Kept hand-written rather than
 * derived from a directory listing: a listing describes whatever happens to be on disk, so a
 * capture that silently stopped being taken would simply vanish from the page with nothing to
 * notice it. `alt` is the accessible description and doubles as searchable text.
 */
export const SHOTS = [
  {
    file: 'app-01-launch.png',
    title: 'At launch',
    alt: 'The nodeterm desktop app at launch: a 64px top app bar with the brand mark, project switcher and docked search, an 88px left nav rail, and the empty canvas with its dot grid.',
    note: 'The app bar and nav rail are the whole chrome — there is no project tab strip and no bottom dock.'
  },
  {
    file: 'app-04-canvas.png',
    title: 'The canvas',
    alt: 'The canvas with the sessions sidebar open listing a project, the zoom and lock controls bottom-left, and the minimap bottom-right.',
    note: 'Terminals are nodes on a pan/zoom canvas. The FAB on the rail owns node creation.'
  },
  {
    file: 'app-05-kanban.png',
    title: 'The board',
    alt: 'The same project rendered as a kanban board with Ungrouped, To Do, In Progress and Done columns.',
    note: 'Cards ARE the session nodes — the board is a second view of the canvas, not a separate list.'
  },
  {
    file: 'app-06-history.png',
    title: 'History',
    alt: 'The History screen inset behind the app bar and nav rail, with Session memory, Settings history and Changelog tabs, showing the session-memory panel.',
    note: 'Session memory, local settings history and the changelog viewer behind one rail destination.'
  },
  {
    file: 'app-03-palette.png',
    title: 'Command palette',
    alt: 'The command palette open over the app, listing create actions for terminals and each supported agent.',
    note: 'Ctrl+Shift+F. Every command, destination and setting, with a persisted size.'
  },
  {
    file: 'app-02-settings.png',
    title: 'Settings',
    alt: 'The settings surface with its sidebar navigation, a search field with the regex-builder affordance beside it, and per-agent controls.',
    note: 'Every settings surface carries its own search wired to the full regex builder.'
  },
  {
    file: 'app-settings-language.png',
    title: 'Language',
    alt: 'The Language settings section: an English, Cantonese and Bilingual segmented button, and two independent funny-level sliders.',
    note: 'Three language modes, and two sliders that change tone without changing what a message says.'
  },
  {
    file: 'app-settings-narrator.png',
    title: 'Narrator',
    alt: 'The Narrator settings section: a master toggle that is off by default, a narrated-language choice, and a separate voice picker per language.',
    note: 'Off by default, with a live line saying which voice will actually speak.'
  },
  {
    file: 'app-settings-appearance-editor.png',
    title: 'Appearance editor',
    alt: 'The appearance editor section, offering per-element typography, colour and shape controls.',
    note: 'Every rendered element is a customisation target, not a fixed set of themes.'
  },
  {
    file: 'app-settings-app-identity.png',
    title: 'App name and logo',
    alt: 'The App name and logo settings section, where the displayed application name and mark can be changed.',
    note: 'The display name only — the data directory, package id and update feed never move.'
  },
  {
    file: 'app-settings-schedule.png',
    title: 'Scheduled settings',
    alt: 'The Schedule settings section, where appearance and language values can be changed on a timetable.',
    note: 'Language, theme and appearance on a schedule, with the timezone stated.'
  },
  {
    file: 'app-kids-home.png',
    title: 'Kids mode — Home',
    alt: 'The Kids mode home screen: a robot avatar introducing itself as Beep, a Morning chip and sticker count, six large activity tiles including Talk to Beep, Type things and Draw, and a plain-language notice that Kids mode does not sandbox the terminal.',
    note: 'The notice is deliberate — Kids mode is friendly, not a sandbox, and says so on the screen a child uses.'
  },
  {
    file: 'app-kids-gate.png',
    title: 'Kids mode — the grown-up gate',
    alt: 'The grown-up gate: a four-digit PIN pad standing between the kid-facing home screen and the grown-up settings.',
    note: 'A speed bump for a child, not a security boundary; the recovery route is stated rather than hidden.'
  },
  {
    file: 'app-kids-parent.png',
    title: 'Kids mode — the grown-up screen',
    alt: 'The grown-up screen behind the gate: time today, daily limit, stickers and sessions, an activity log, and permission switches for the real terminal, how freely the agent may answer, reading screens aloud, a daily time limit and locking Kids mode on launch.',
    note: 'Each switch says what it actually changes, including that two of them are the same app-wide settings under another name.'
  },
  {
    file: 'app-settings-kids-mode.png',
    title: 'Kids mode',
    alt: 'The Kids mode settings section, showing the shared switch and its plain-language disclosure.',
    note: 'One shared switch across every app, and the disclosure is on screen rather than only in the source.'
  }
]

export function screenshotsRoomHtml(store) {
  // `store.state`, not `getState()` — core/render.js reads `store.state` and hands this function
  // that same store object. (engine.js does expose setState/getState elsewhere; the render path
  // does not, and a room that guesses wrong renders nothing while the search box still draws.)
  const s = store.state
  // The shell already drew this room's search field and its regex builder. Honour it or the field
  // is decoration — same matcher the list rooms use, so plain text stays the default and the regex
  // toggle behaves identically here.
  const match = makeMatcher(s, 'sec', s.qSec)
  const shown = SHOTS.filter((shot) => match(shot.title + ' ' + shot.alt + ' ' + shot.note))

  const cards = shown
    .map(
      (shot) => `
      <figure class="shot-card">
        <a class="shot-card__link" href="./assets/shots/${attr(shot.file)}" target="_blank" rel="noopener"
           aria-label="Open the full-size capture: ${attr(shot.title)}">
          <img class="shot-card__img" src="./assets/shots/${attr(shot.file)}" alt="${attr(shot.alt)}"
               loading="lazy" width="1600" height="1000" />
        </a>
        <figcaption class="shot-card__cap">
          <strong class="shot-card__title">${esc(shot.title)}</strong>
          <span class="shot-card__note">${esc(shot.note)}</span>
        </figcaption>
      </figure>`
    )
    .join('')

  const empty = `<p class="shot-empty">No screenshot matches that search.</p>`

  return `
    <section class="shots-room">
      <p class="shots-room__lede">
        Real captures of the built desktop app — taken from a running build over the DevTools
        protocol, never mocked up and never cropped from a design file. Select one to open it
        full size.
      </p>
      <div class="shot-grid">${shown.length ? cards : empty}</div>
      <p class="shots-room__foot">
        The same run that writes these also writes the copies the documentation cites, and a check
        asserts the two stay byte-identical — so a picture here cannot quietly drift from the
        interface it claims to show. Two further surfaces (an agent mid-turn, and an SSH project)
        need a live agent session and a reachable host, so they are honestly absent rather than
        faked.
      </p>
    </section>`
}

export function registerScreenshots(store, deps, registerAction, registerBinding) {
  registerRoom('shots', { render: screenshotsRoomHtml })
}
