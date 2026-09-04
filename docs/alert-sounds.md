# Custom alert sounds

The Notifications settings section supports one local sound for each alert event: a finished turn
and a session that needs attention. Each event can use the built-in retro effect or a user-selected
WAV, OGG, MP3, M4A, or WebM clip.

## Local validation and storage

The picker accepts only files whose bytes are read locally and whose declared media type is on the
allowlist. Files larger than 2 MB, empty files, unsupported types, malformed data URLs, and remote
URLs are rejected. A selected clip is stored as a bounded data URL in the app's existing settings
store. It is never uploaded, fetched from a URL, sent to telemetry, or included in an export or
public record. Replace and Reset are available for each event independently; Reset immediately
returns that event to its built-in effect.

## Playback and coexistence

The master Sound effects switch and volume apply to both built-in and custom clips. Quiet mode and
Reduced sound mode stop alert playback without hiding or deleting the notification. The spoken
narrator is a separate channel, so its queue and language selection continue when a sound clip is
paused. Playback is best-effort and never blocks agent status handling. Browser audio still needs a
user gesture, which enabling sound or using Preview supplies.

Preview buttons exercise the exact event mapping used by live alerts. The finished-turn and needs-
you mappings are persisted with settings and are restored on restart. Settings mutations continue
through the app's existing settings persistence and local-history transaction.

## Accessibility and search

Every picker has a keyboard-reachable labelled file control, an explicit empty state, and a visible
filename after validation. Error copy identifies the accepted formats and the 2 MB bound. The
Notifications settings search indexes sound, audio, custom, preview, volume, quiet, and reduced
sound terms. Plain-text search remains the default and uses the section's adjacent full regex
builder when regex mode is deliberately enabled. The controls follow the app's language, funny
level, contrast, focus, reduced-motion, and narrow-layout rules.

## Recovery

If a decoder rejects a selected clip, the prior valid mapping remains active and the error is shown
inline. Clearing a clip never affects the built-in effect or the other event. Deleting the app's
local settings data resets all custom clips and mappings together with the rest of the local profile.
