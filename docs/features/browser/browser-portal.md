# Browser Portal

Browser Portal is the canvas browser node with guided, isolated session profiles and an explicit
ownership model for its embedded page. It is a real browser surface, not a shell command runner and
not a promise that every Chromium or browser extension capability is available.

## Behaviour

The node starts with a truthful blank state or a validated HTTP(S) URL. Its address field accepts a
URL or a search phrase, and the new-tab surface offers the same anchored regex builder as other
search fields. Navigation is owned by the visible node. An agent may drive a node only while its
separate control lease is active; an agent owner never becomes the owner of ordinary user navigation.

Target-blank requests stay inside the owning node as temporary browser tabs or temporary popup nodes.
Temporary popup nodes are live and interactive, but are not written into the shared project until the
user chooses **Keep**. Closing a temporary popup leaves no project record. Closing the last tab in a
regular node resets that node to one blank tab rather than deleting the node itself.

## Profiles and guided creation

The profile picker is anchored to the browser header. It lists the project profiles, the shared
default session, and a local search field with its own anchored full regex builder. New profiles use a
generated safe identifier, a bounded validated display name, and a deterministic display colour.
Renaming validates the same name contract. A profile name is project intent, so it is safe to share in
`.nodeterm/project.json`; cookies, local storage, cache, extension directories, process handles, and
other session data are not.

Two nodes using the same profile share that profile's local browser session. Different profiles use
different persistent Electron partitions. A node keeps its selected profile identifier even if the
name is later removed, so an accidental name removal cannot silently merge the node into the default
session.

## Reset and close semantics

**Reset profile** is a separate destructive action behind the app's two-key confirmation surface. It
clears the selected partition's cookies, site storage, cache, and loaded unpacked extensions while
leaving the profile name and project tab list intact. The reset route validates that the partition is
one this application owns before it reaches Electron. A reset failure leaves the profile untouched
and returns the exact failure to the caller.

Removing a profile removes only its portable project name. Existing nodes retain their isolated
partition until the user deliberately resets it. This distinction avoids claiming local data was
deleted when only a project label changed.

## Portability

The transferable project projection carries the node identity, title, URL, tab labels, tab order,
active tab, and selected profile identifier. It never carries cookies, local storage, cache,
extension paths, process state, web contents identifiers, debugger handles, machine paths, or
provider sessions. Import only reconstructs safe intent. It does not navigate, download, launch a
process, install an extension, or mutate a provider.

On another desktop, a missing local profile session is shown as an unconfigured local session. The
user can select an existing local profile or create a new one. There is no silent session migration
and no claim that a login travelled with the project file.

## Failure modes and unsupported boundaries

- A malformed or empty profile name stays in the editor with an inline next-step message.
- An unsafe or foreign partition is rejected before session reset; it never falls back to the shared
  default session.
- A page-load error remains attached to the browser surface and does not masquerade as an empty
  project or a missing profile.
- Switching profiles remounts the browser surface with the new partition. Electron only honours the
  partition at webview attachment, so mutating a live webview in place is not supported.
- Server Edition can preserve the safe URL and tab intent, but it cannot clear an Electron partition.
  Its visitor browser storage is controlled by the browser and remains outside the project file.
- The mobile companion does not host an embedded Electron session. It must show the browser feature
  as unavailable or provide its own explicitly local browser route rather than implying profile
  parity.
- Electron supports unpacked extensions only and does not implement all Chrome extension APIs. The
  extension surface reports those limits instead of claiming Chrome Web Store parity.

## Security and privacy

Partition names are derived from project and profile identifiers through one conservative sanitizer.
IPC reset input is checked again at the main-process boundary. Local browser data is never sent over
the project sync path, included in an export, or copied into a portable archive. Agent control is
revoked when the guest is unregistered or the node closes, so a stale debugger lease cannot survive
the browser lifecycle.

The browser address route accepts only HTTP(S) and file URLs according to the shared URL policy;
unsupported schemes become searches rather than executable page navigation. No arbitrary shell
command, raw request editor, or credential field is part of Browser Portal.

## Verification boundary

This implementation lane did not run tests, type checking, linting, builds, packaging, installer
execution, runtime interaction, accessibility review, security review, or UI captures. Those checks
remain an independent verification lane. The source changes establish the guided controls, local
reset boundary, portable intent separation, and explicit unsupported states described above.

## Suggested articles

- [Browser node tabs](./browser-tabs.md) for tab persistence and active-webview behaviour.
- [Unpacked extensions and WebAuthn](./extensions-and-webauthn.md) for embedded Chromium limits.
- [Canvas and lifecycle](../canvas/canvas-and-lifecycle.md) for project content and local state.
- [Portable canvas projection](../projects/portable-canvas-projection.md) for schema 3 portability.
