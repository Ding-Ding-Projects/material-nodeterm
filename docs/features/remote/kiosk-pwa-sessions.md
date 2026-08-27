# Kiosk and PWA sessions

Kiosk and PWA sessions are browser-backed canvas nodes for opening one reviewed web target in a
focused surface. Kiosk mode opens a secure address with popups disabled. PWA mode opens a host-
detected installed web app when an installed-app inventory is available. Both modes use the same
portable intent and local profile boundary.

## Guided setup

Open the Node Catalog and choose **Kiosk session** or **PWA session**. The setup surface requires a
display name, a target, and an explicit permission selection. Kiosk mode accepts an HTTPS address,
or HTTP on localhost for development. PWA mode requires an installed app selected from the host's
inventory. The app list has plain-text search by default and an adjacent anchored full regex
builder. An empty inventory is shown as unavailable, rather than being replaced with sample apps.

The supported permission requests are notifications, camera, microphone, location, and read
clipboard. They are all denied unless selected in the session intent, and the current canvas
surface still denies the browser's permission event unless a later host confirmation path grants it.
This is intentional: a portable request is not an ambient permission grant.

## Portable and local state

The project projection stores only:

- schema version 1;
- kiosk or PWA mode;
- the validated target URL or installed-app id, name, and start URL;
- the user-chosen display name; and
- the requested permission names.

The projection never stores credentials, cookies, local storage, profile paths, process ids, window
handles, host-specific identifiers, browser cache, or permission grants. `src/shared/kiosk-pwa.ts`
validates the projection again before it is published. `KioskPwaNode` stores one opaque local profile
key in the browser profile and uses the existing project-scoped browser partition. If local storage
is unavailable, it reports that the profile is ephemeral instead of claiming persistence.

## Lifecycle and recovery

The lifecycle is explicit: idle, starting, running, stopping, stopped, unavailable, and error.
`src/core/kiosk-pwa.ts` owns the host-neutral lifecycle manager and requires an owner node id for
every read, stop, exit, recovery, and permission request. A failed host start becomes unavailable
with the host reason. Exit stops the owned session, while Retry recreates the host surface with the
same portable intent and local profile. An unowned or unknown session cannot be stopped by id.

The canvas surface refuses popups (`allowpopups=false`) and exposes Exit, Retry, and Close as real
keyboard-operable controls. Error and unavailable states name the next recovery action. No command,
executable, profile path, or credential is accepted by this flow.

## Security and unavailable states

URL validation rejects non-web schemes, embedded user information, control characters, and insecure
non-loopback HTTP. Installed-app ids are bounded and allowlisted by shape. The host adapter is the
only place that may create or destroy a native window. Permission events are denied by default.
Importing a project only reconstructs safe intent. It does not navigate, launch, download, deploy,
request permissions, or change a provider.

When installed-app discovery is unavailable, the PWA picker remains empty and says why. When a
secure target cannot be validated, the node stays unavailable and asks the user to recreate the
selection. These states do not fall back to a different URL or profile.

## Verification boundary

This ultra-speed implementation lane intentionally ran no tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
or UI captures. The source records the intended boundaries and the direct integration lane must
collect those separate results before treating the feature as verified.

## Related articles

- [Browser Portal](./browser-portal.md) for isolated browser profiles and lifecycle ownership.
- [Server Edition](./server-edition.md) for browser-hosted renderer limitations.
- [Unified Node Catalog](../canvas/node-catalog.md) for guided creation and availability reasons.
