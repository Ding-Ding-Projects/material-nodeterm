# Browser features

The browser category covers the canvas browser node, its tab strip, isolated profiles, lifecycle
ownership, and the platform boundaries around embedded Chromium. Each article states what is shared
project intent and what remains local to the computer running the desktop application.

| Article | Scope |
| --- | --- |
| [Browser Portal](./browser-portal.md) | Isolated profiles, guided creation, navigation ownership, reset and close semantics. |
| [Browser node tabs](./browser-tabs.md) | Tab persistence, tab switching, and the active-webview limitation. |
| [Unpacked extensions and WebAuthn](./extensions-and-webauthn.md) | Electron extension limits and passkey boundaries. |

The browser node is a desktop Electron surface. Server Edition keeps browser URLs and tab intent in
the shared project model, but its browser session is the visitor's own browser storage. The mobile
companion has no embedded browser profile store and must present an explicit unsupported state.
