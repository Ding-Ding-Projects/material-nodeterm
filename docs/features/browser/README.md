# Browser features

Browser-facing canvas nodes keep web content useful without confusing page state with project
content. Each article records the safe URL boundary, profile isolation, supported surfaces, and
the verification still required for any runtime claim.

## Articles

| Article | Scope |
| --- | --- |
| [Browser node tabs](./browser-tabs.md) | Multiple tabs, profile partitions, and persisted URL/title intent. |
| [Kiosk and PWA sessions](./kiosk-pwa-sessions.md) | Dedicated isolated sessions, full-screen and bounded presentation, and manifest discovery. |
| [Extensions and WebAuthn](./extensions-and-webauthn.md) | Unpacked extension loading and browser-session limits. |

## Suggested next step

Start with [Kiosk and PWA sessions](./kiosk-pwa-sessions.md) when a web destination needs its own
cookie jar and an explicit focus mode. Use [Browser node tabs](./browser-tabs.md) when the pages
should remain part of one ordinary browser profile.
