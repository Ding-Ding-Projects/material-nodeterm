# Easter eggs

The Windows desktop app includes a catalog of local, harmless interface surprises. Each entry has
a stable id, a named surface, a bounded keyboard trigger, English and Cantonese copy, ten funny
levels, and a clear dismissal path. The cabinet is available from the keyboard with
`Ctrl+Alt+Shift+E`, or by focusing its controls after it is opened. The cabinet's search is local
and only matches the title, surface, and stable id.

## Safety contract

Easter eggs render a non-blocking status card only. They do not write project files, alter nodes,
execute commands, launch programs, call a network service, inspect credentials, change safety
settings, or gate startup and accessibility. Discovery state contains only stable ids in private
browser storage. Resetting the cabinet removes those ids and does not touch project state.

School mode suppresses the entire cabinet and every egg, including its names, trigger hints,
storage record, and accessible status. Reduced motion receives a static treatment. The status
card has a labelled dismissal control and a polite live region, while keyboard and touch users can
use the same cabinet buttons.

## Catalog coverage

The hand-written catalog lives in `src/shared/easter-eggs.ts`. It currently covers 60 entries
across canvas, nodes, title bar, settings, command palette, notifications, documentation,
changelog, search, project switching, source control, media, schedules, hosting, accounts,
converter, local model management, authenticator, support, and status. Every row records its
English and Cantonese seed copy, ten-level voice expansion, School-mode suppression,
accessibility behavior, reduced-motion behavior, local persistence policy, and reset path.

The trigger route is intentionally bounded: the user opens the cabinet, presses **Arm an egg code**,
and types the row's short code within three seconds. Marked desktop surfaces also accept an
explicit Alt-click to reveal the next undiscovered row for that surface. Selecting **Try this egg**
is the equivalent touch and assistive-technology route. A found egg announces its title and
localized copy, then remains available until the user explicitly dismisses it.

## Suggested articles

- [Language modes](../../language-modes.md)
- [Material Design 3 appearance](./material-3-migration-status.md)
- [ADHD modes](../../adhd-modes.md)
- [Notifications](../../notifications.md)
