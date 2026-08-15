# Real captures — nodeterm published site

Every image in this directory is a **real screen capture** of the live, deployed
nodeterm documentation/landing site — **not** a mockup, not a hand-edited image, and not
reused from anywhere upstream. None of the desktop Electron app's screens are represented
here; see "Why not the desktop app" below for the exact, measured reason.

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
