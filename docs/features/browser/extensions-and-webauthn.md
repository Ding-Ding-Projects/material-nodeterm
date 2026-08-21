# In-app browser: unpacked extensions + WebAuthn

The in-app browser node (`BrowserNode`/`BrowserSurface`) is a real Electron `<webview>` — i.e. real
Chromium, the same rendering engine as desktop Chrome. "Full Chromium" is therefore already true for
page rendering, JS, and most web platform APIs. This file establishes, from the pinned Electron
42.8.1's own shipped typings (`node_modules/electron/electron.d.ts`), exactly what extensions and
WebAuthn support means in practice, rather than assuming Chrome parity.

## Unpacked extensions

Electron exposes `session.extensions.{loadExtension,removeExtension,getAllExtensions}`
(`Session.extensions` in the pinned 42.8.1 typings). This app wires it per browser profile
(`src/main/browser-extensions.ts`, `browser-extensions-core.ts`, `browser-extensions-store.ts`) and
exposes it to the renderer as `window.nodeTerminal.browser.extensions` (`BrowserExtensionsApi` in
`shared/types.ts`), with a UI panel (`BrowserExtensionsPanel.tsx`) reachable from the browser
toolbar's extensions button.

**What is real, established from the pinned typings' own doc comments, not assumed:**

- **Unpacked directories only.** "This API does not support loading packed (.crx) extensions."
  There is no Chrome Web Store install flow. A user must already have the extension unpacked on
  disk (e.g. downloaded and extracted, or checked out from source).
- **No in-memory (non-persistent) session support.** Every partition this app hands to a `<webview>`
  is either the default persistent session or a `persist:browser-profile-…` partition (see
  `browserPartitionFor`), so this is satisfied by construction.
- **Electron forgets loaded extensions across restarts.** "loadExtension must be called on every
  boot of your app if you want the modifications to be applied." This app persists the chosen
  directory paths (`browser-extensions.json` under `userData`, machine-local — see the doc comment
  in `browser-extensions-core.ts` for why this is never git-shared project content) and replays them
  at `app.whenReady()` (`reloadPersistedBrowserExtensions`).
- **"Electron does not support the full range of Chrome extensions APIs."** — direct quote from the
  pinned typings. Electron implements a Manifest V2/V3-ish *subset* of `chrome.*`. An extension that
  leans on an API Electron has not implemented will partly or fully not work. This cannot be
  detected in advance; the app can only report whether `loadExtension` itself accepted the directory
  (`LoadExtensionResult`) — it cannot promise the extension will function like it does in real
  Chrome. The extensions panel states this plainly rather than implying Chrome Web Store parity.

**Where extensions load:** into the `<webview>`'s own Electron `session` (the browser profile's
partition). Server Edition and relay tabs run inside a real browser tab, not Electron — there is no
Chromium extension host process for the page to load an unpacked extension into there at all, so
every method rejects with `E_UNSUPPORTED` (`buildStubApi` in `renderer/bridge/stubs.ts`), and the
panel shows that refusal in place of a list rather than pretending the feature half-works.

## WebAuthn / passkeys

**Established from the pinned 42.8.1 `electron.d.ts` (not from general Electron knowledge, and not
run/verified in this task — see the hard rule against launching the app for this worktree):**

- **`app.configureWebAuthn(options)` is `@platform darwin` only.** Its whole job is enabling the
  macOS Touch ID / Secure Enclave platform authenticator: "Until this is called,
  `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` resolves to `false` and
  platform-authenticator requests are not serviced" — *on macOS*. There is no Windows or Linux
  equivalent of this call in the typings at all.
- **WebAuthn is not gated behind Electron's JS permission API.** `session.setPermissionRequestHandler`
  and `setPermissionCheckHandler`'s permission-type unions (grep the pinned typings) list
  `'clipboard-read' | 'geolocation' | 'media' | 'hid' | 'usb' | 'serial' | …` — there is no
  `'webauthn'` entry anywhere. That means WebAuthn requests are serviced by Chromium's native
  platform code directly, not intercepted by anything this app's session-level permission handlers
  could see or need to grant.
- **`app.on('select-webauthn-account', …)`** exists for the case where a platform authenticator
  resolves *multiple* discoverable credentials and the user must pick one. Its own doc comment says
  it fires "On macOS, [for] the Touch ID platform authenticator … once it has been configured with
  `app.configureWebAuthn`. **The event may also fire on other platforms when a roaming FIDO2
  authenticator returns multiple discoverable credentials.**" This confirms non-macOS WebAuthn is not
  unsupported — it is handled through a different path (roaming/external authenticators, and on
  Windows very likely Chromium's built-in native Windows Hello integration via the OS's own
  `webauthn.dll`, which Chrome-on-Windows uses without any app-level opt-in) rather than through the
  Electron-specific `configureWebAuthn` call that exists only to unlock the macOS Secure Enclave
  path.

**What this means for this app, on the pinned Windows target:**

- There is no Electron-side wiring this app is missing for WebAuthn on Windows — `configureWebAuthn`
  is a macOS-only unlock for Touch ID and has no Windows counterpart to call. A roaming FIDO2 key
  (a USB security key) or Windows Hello (if Chromium's native Windows implementation applies inside
  a `<webview>` the same way it does in a top-level `BrowserWindow`) are the expected paths, exactly
  as they would be in a webview-hosting Chromium browser generally.
- **This has not been empirically verified against the real running app** — this worktree's hard
  rules forbid launching Electron or driving it with capture tooling, and the finding above is
  therefore sourced entirely from reading the pinned `electron.d.ts` rather than from an actual
  passkey registration performed inside a `<webview>` on this machine. Whether a site's
  `navigator.credentials.create()`/`.get()` genuinely succeeds inside the `<webview>` guest (as
  opposed to a top-level `BrowserWindow`) is the one thing the typings cannot answer — Electron's
  public API surface does not distinguish `<webview>` guests from ordinary `WebContents` for
  WebAuthn purposes in its documentation, but guest views have historically had a narrower feature
  surface than top-level windows for other APIs (e.g. extensions above), so this is stated as an
  established fact about the API and an **open, unverified question** about the concrete `<webview>`
  behavior, not a verified guarantee.
- **No control was added for this**, because there is nothing to configure on Windows — the surface
  is "does the pinned Chromium's native WebAuthn implementation service a request made inside a
  `<webview>`", which is a fact about the installed Chromium build, not a switch this app can flip.
  Reopen this doc with a real device check (a live `<webview>` pointed at a WebAuthn test page such
  as `webauthn.io`, with a USB key or Windows Hello) before claiming passkey support works, rather
  than trusting this reading of the typings alone.
