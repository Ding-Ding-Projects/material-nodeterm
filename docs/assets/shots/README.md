# Real captures — nodeterm

> **Re-taking these is now one command: `npm run shots -- --attach <port>`.**
> `scripts/capture-shots.mjs` drives the built app over CDP, refuses to run against a build
> older than its sources, FAILS when a required surface never opened (rather than filing the
> previous screen under its name), and writes provenance to `capture-manifest.json` beside the
> images. Read that manifest for the commit, method and viewport of the current set — it is
> authoritative, and this document is the narrative around it.
>
> Two things it cannot manufacture and therefore skips by name: an agent mid-turn (needs a real
> agent CLI session) and an SSH project (needs a reachable host). Both are listed as skips with
> reasons rather than being silently absent.
>
> The app surfaces also need a project open before they show anything. The harness does not
> create one — seed a project and a terminal node first, or `app-04-canvas` photographs an empty
> welcome screen that is honest and useless.

## Original notes

Every image in this directory is a **real screen capture** — not a mockup, not a
hand-edited image, and not reused from anywhere upstream. There are two sets:

- `site-*.png` — the live, deployed documentation/landing site.
  Includes `site-screenshots-room.png` — the **Screenshots** room
  (`site/app/features/screenshots.js`), captured from the DEPLOYED page at
  <https://ding-ding-projects.github.io/material-nodeterm/> rather than a local server, at
  1440px through a headless browser. It is the room that publishes the `app-*.png` set to the
  site: 15 cards, all 15 images decoded, no horizontal scroll.
- `app-*.png` — the **desktop Electron app**, captured from a real running build.

The desktop set was blocked for most of this work and is no longer; the section
"How the desktop app became capturable" below records exactly what the blocker was
and how it was worked around, because the workaround is reusable.

## Source and commit

- **URL captured:** `https://ding-ding-projects.github.io/material-nodeterm/`
- **Deployed commit:** `61884017b5cabfc5379c22a3c5d0d2b857e96d29` (`main`), confirmed via
  `GET https://api.github.com/repos/Ding-Ding-Projects/material-nodeterm/deployments` —
  the most recent `github-pages` deployment for this repo, `sha=61884017…`,
  `created_at=2026-08-15T02:37:43Z`. That commit is an ancestor of the branch these
  screenshots were taken from (`yt/captures`, tip `c1993590`), so the captured site
  reflects code already merged into this working tree.
- **Capture date:** 2026-08-14 (local session).

## Capture method

Captured through the **cheap Lowlevel MCP headless route only** — no visible desktop, no
mouse/keyboard input on the user's session, no focus stealing.

1. `create_headless_desktop` — a private, off-screen Win32 desktop (`ytcapdesk`).
2. `launch_on_headless_desktop` running Microsoft Edge in **true headless mode**
   (`--headless=new`) with a fresh, isolated profile:
   `--user-data-dir=<task-scoped temp dir>`, `--guest`, `--disable-sync`,
   `--disable-extensions`, `--disable-component-extensions-with-background-pages`,
   `--no-first-run`, `--no-default-browser-check`,
   `--disable-features=msEdgeFirstRunExperience,msEdgeSignin,msEdgeSync`,
   `--remote-debugging-port=9334`.
3. **Isolation was verified before any capture**: `GET http://127.0.0.1:9334/json/list`
   was required to return **exactly one** target, of `type: "page"`, at the intended URL,
   before any screenshot was taken. (An earlier attempt used Google Chrome instead of
   Edge; Chrome's headless build always spawned two extra internal `browser_ui` targets
   — `chrome://omnibox-popup.top-chrome/…` — that could not be suppressed with feature
   flags. Rather than capture through that, the Chrome process tree and its profile were
   torn down unused, and Edge was used instead, which produced the required single
   target on the first try.)
4. Screenshots and page interaction went over the real **Chrome DevTools Protocol** via a
   WebSocket connection to that one verified target — `Page.captureScreenshot` for the
   PNG bytes, `Runtime.evaluate` to click real DOM elements (tab-rail buttons, the search
   toggle, the color-picker trigger) exactly as a user's click would, and
   `Emulation.setDeviceMetricsOverride` / `Emulation.setEmulatedMedia` for the narrow
   viewport and color-scheme states. No mockup HTML, no static rendering, no editing of
   the captured PNGs.
5. The Edge process and its temporary profile directory were terminated by exact PID
   after capture; nothing from this session was left running.

One process-management mistake happened during this session and is disclosed here rather
than hidden: an earlier cleanup call used `kill_process` with `name: "chrome.exe"`
(kill-by-name) instead of the specific PID that had just been launched, which killed
**8** `chrome.exe` processes on the host rather than the 1 process this task owned. If
the user had Chrome open on their visible desktop at that moment, its windows/tabs were
closed. Every kill after that point in this session targeted an exact PID only.

## Why not the desktop Electron app

The desktop app requires `node-pty`'s native module, and this build's Electron ABI is
**146** (`electron --version` → 42.8.1, `process.versions.modules` under
`ELECTRON_RUN_AS_NODE=1` → `146`). Compiling `node-pty` for that ABI on this machine
fails with the pre-diagnosed, unresolvable error:

```
MSBuild error MSB8040: "Spectre-mitigated libraries are required for this project."
toolchain: C:/Users/cntow/AppData/Local/material-virtualbox-toolchain/BuildTools
```

Checked for a shortcut before falling back to the site: `node_modules/node-pty/prebuilds/win32-x64/pty.node`
already existed in this shared `node_modules` tree (built by a concurrent lane earlier
the same day), and it **does load successfully under plain Node** — but plain Node here
reports ABI **137**, not Electron's 146. Loading a 137-ABI native addon into a 146-ABI
host throws a hard `NODE_MODULE_VERSION` mismatch; it is not usable for the Electron
app. No official Electron-42-targeted `node-pty` prebuild exists on npm to substitute,
and fixing the Spectre-mitigation gap requires installing Visual Studio Build Tools
components, which is explicitly out of scope for this task (the user's toolchain must
not be modified). So the desktop app genuinely cannot be launched on this machine right
now, and no desktop screenshots are included.

The published site is a real, independently shipped surface of this same project (see
the repo's `Landing page and documentation site` + `In-app documentation browser`
sections of `CLAUDE.md`), so it is captured in full instead.

## Images

| File | Surface | State | Viewport | Alt text |
|---|---|---|---|---|
| `site-home-light.png` | Landing page (Overview tab) | Light theme, default load | 1440×900 | nodeterm landing page in light theme, showing the hero heading "Your terminals on an infinite canvas", the download buttons, and a mock canvas preview with terminal and Claude-agent nodes |
| `site-home-dark.png` | Landing page (Overview tab) | Dark theme, after clicking the theme toggle (`aria-label="Switch color theme"`) | 1440×900 | Same landing page in dark theme, confirming `data-theme="dark"` was applied by a real click, not just a media-query emulation |
| `site-settings-dark.png` | Settings tab | Dark theme; Appearance sub-section selected by default | 1440×900 | Settings surface with its own "Search settings…" bar plus regex-builder toggle, a left sub-nav of settings sections (Appearance, Notifications, Data & privacy, changelog, exports, language, narrator, school-mode, toy-locks, vocabulary), a Color theme dropdown set to Dark, an "Open appearance editor" button, and a Tab strip position control |
| `site-language-light.png` | Language tab | Light theme | 1440×900 | Language settings showing the "Show emoji in dialogs" toggle, the three required language-mode radios (English / Cantonese playful Hong Kong style / Bilingual), and two independent funny-level sliders for English and Cantonese |
| `site-search-regex-builder.png` | Global "Search tabs…" bar (sidebar) | Regex builder popover open, anchored beside the search field | 1440×900 | The anchored regex builder popover open next to the sidebar search box, showing a Regex mode toggle, a pattern field with placeholder `^foo|bar$`, the `g — global` and `s — dot-all` flag checkboxes, and an Apply button |
| `site-appearance-picker.png` | Settings → Appearance editor | "Accent color" dialog open | 1440×900 | The infinite color picker dialog: a 2D saturation/lightness field, a hue slider, a hex input plus R/G fields, and a full color-translator table (HEX, HEX8, RGB, RGBA, HSL, HSLA, HSV, HWB) with a live WCAG contrast readout against white and black |
| `site-notifications.png` | Notifications tab | Empty state (no notifications dismissed yet) | 1440×900 | Notifications history surface with its own Filter field plus regex-builder toggle, Select all matches / Invert selection / Clear selection, and Remove selected / Clear all bulk actions, showing the honest "None yet." empty state |
| `site-changelog.png` | Changelog tab | Default (All time) view, two entries visible | 1440×900 | The in-app changelog viewer: a From/To date-range picker with calendar buttons plus Last 30/90 days and All time presets, a changelog search bar with regex-builder toggle, seven export-format buttons (JSON, JSONL/NDJSON, YAML, TOML, XML, Markdown, HTML), and two real dated entries each carrying a linked commit SHA |
| `site-toy-locks.png` | Toy locks tab | Empty state, no locks created | 1440×900 | Toy locks surface with its explicit "This is just for fun — a small speed bump, not real security" disclosure, a target picker, a New password field, a Create lock button, the same filter/regex-builder/bulk-action row as Notifications, and the "Forgot a lock's password?" recovery line naming that clearing browser storage removes every lock |
| `site-local-history.png` | Local history tab | Empty state, no changes recorded yet | 1440×900 | Local version history surface for site-side settings changes, with the same filter/regex-builder/bulk-action pattern and an honest "None yet." empty state |
| `site-docs-tab-light.png` | Docs tab | Light theme | 1440×900 | The in-app "Documentation" tab, stating every feature has its own article (behaviour, configuration, failure modes, security considerations, verification) with an "Open the full documentation index →" link out to the repository's docs |
| `site-narrow-390.png` | Landing page (Overview tab) | Light theme, mobile-width viewport | 390×844 (device-scale 2, `mobile: true`) | The same landing page reflowed for a 390px-wide phone viewport: the desktop sidebar collapses into a hamburger menu in the header and a fixed bottom icon/tab bar (home, settings, language, school-mode, notifications, plus the search-and-regex-builder icon), with no horizontal overflow |

All twelve images are lossless PNG, taken via `Page.captureScreenshot` at
`deviceScaleFactor: 1` (390-wide capture at `deviceScaleFactor: 2`), and none were resized,
cropped, or otherwise edited after capture.

---

## The desktop app set (`app-*.png`)

| File | Surface | Verified by |
| --- | --- | --- |
| `app-01-launch.png` | First screen of the built app | `document.title === 'nodeterm'`, canvas present |
| `app-02-settings.png` | Settings surface — sidebar nav, search + its regex affordance | rendered heading |
| `app-03-palette.png` | Command palette | `.palette` present |
| `app-settings-language.png` | Language modes + both funny-level sliders | heading `Language` |
| `app-settings-narrator.png` | Narrator — per-language voice pickers, live status line | heading `Narrator` |
| `app-settings-app-identity.png` | App rename + logo customization | heading `App name & logo` |
| `app-settings-appearance-editor.png` | Per-element appearance editor | heading `Appearance editor` |
| `app-settings-schedule.png` | Scheduled settings | heading `Schedule` |
| `app-04-canvas.png` | A project on the canvas: one terminal node, the sessions sidebar, minimap and dock | project tab + `Terminal 1` in the sidebar |
| `app-05-kanban.png` | The same project as a kanban board — the session as a card in Ungrouped | board columns rendered |

- **Captured from:** the Electron app running out of this working tree at commit `489c71eeb8cc9f831dd054d4cf608377c82921a3`.
- **Route:** the cheap Lowlevel MCP headless desktop (`NodetermShots`) — the app ran with a
  real GUI on an off-screen Win32 desktop, so the visible desktop, cursor and focus were
  never touched. Frames were taken over the Chrome DevTools Protocol
  (`--remote-debugging-port=9400` -> `Page.captureScreenshot`), which this repository's own
  notes record as the route that works for an Electron target — `screenshot(hwnd=...)` does
  not.
- **Each shot is gated on the surface actually rendering.** The script reads back the panel's
  own heading first and *skips* rather than shooting if it is absent, and refuses to shoot at
  all while a palette or other overlay is on top. That check earned its keep immediately: the
  first run of the settings-section batch produced five images with the command palette left
  open over them from an earlier script. They were discarded and retaken, not shipped.

## How the desktop app became capturable

For most of this work the app could not be launched here at all: its main process requires
`node-pty`, whose native module **will not compile on this machine**. The exact error is
MSBuild `MSB8040` — the Spectre-mitigated VC libraries are not installed in this toolchain —
and installing them means modifying somebody's Visual Studio installation, which is out of
scope for an automated pass.

Two lesser traps were diagnosed on the way and are worth writing down, because both cost real
time and neither is obvious from the error text:

- `NoDefaultCurrentDirectoryInExePath=1` is set on this machine, which makes `cmd /c` refuse
  to run a batch file from the current directory. `node-pty`'s bundled winpty build shells out
  to `GetCommitHash.bat` exactly that way, so `node-gyp configure` failed with
  "'GetCommitHash.bat' is not recognized" for a file that plainly exists. Running under
  `env -u NoDefaultCurrentDirectoryInExePath` fixes it — and `configure` then succeeds, which
  is how the *real* blocker (MSB8040, at the compile step) was finally reached.
- MSYS bash rewrites a leading `/` in an argument, so `-- /p:SpectreMitigation=false` arrived
  as `p:SpectreMitigation=false`. `MSYS_NO_PATHCONV=1` prevents that. (It did not help in the
  end — node-gyp consumes `--` arguments at configure time, not as MSBuild properties — but
  the mangling is a real trap that will bite the next person.)

**The workaround: take the binary that CI already built.** The release workflow builds on
`windows-latest`, which has the full toolchain, and the resulting `.nupkg` is an ordinary ZIP
containing the compiled module. So:

1. `gh release download <tag> --pattern '*.nupkg'`
2. extract `lib/net45/resources/app.asar.unpacked/node_modules/node-pty/` over the local
   `node_modules/node-pty/`
3. confirm it actually works before trusting it — spawn a real pty from plain Node and check
   for a pid and returned bytes, rather than assuming a file on disk means a working module.

That is what made every `app-*.png` here possible. It also incidentally proved the packaging
fix landed: the same archive contains `resources/session-host/`, the bundle that earlier
packaging runs silently omitted.

## What is still not captured, and one caveat on what is

- **A terminal showing shell output.** `app-04-canvas.png` is a real project with a real
  terminal node and a live session (the sessions sidebar lists it, the pty is attached and the
  cursor renders) — but the pane is empty. Keystrokes were driven in properly, including
  dwelling past the node's hover-guard before clicking, and no shell text ever reached the
  WebGL layer in this headless context. The shot is captioned for what it shows — the canvas
  UI around a live session — and not for output it does not contain.
- **An agent mid-turn**, with the RUNNING / NEEDS YOU badge and a subagent fan-out. That needs
  a real agent CLI session, not just a spawned shell.
- **The Squirrel installer's SmartScreen prompt**, which needs a real install.
- **Light theme for the desktop app.** The shots above are the app's own default appearance.

## A note on trusting these

Two captures in this directory were taken, inspected, and thrown away rather than shipped: five
settings shots that had the command palette left open over them from an earlier script, and one
"canvas" shot whose DOM query counted three nodes while the picture was plainly still the
welcome screen. Both were caught only by opening the PNG and looking at it. A capture script
reporting success proves a file was written, never that the file shows what its name claims —
so every image here was eyeballed before it was committed.

