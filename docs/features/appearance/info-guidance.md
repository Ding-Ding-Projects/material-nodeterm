# Info guidance on settings

Every Settings row that has help text shows a compact **info** button directly above its control.
Pressing it opens a small panel, anchored to that button, which explains that one setting and gives
three guided steps:

1. Change it with the control just below the button.
2. There is no Save button: the change is kept automatically.
3. To undo, restore an earlier version from Settings → Local history.

The button lives in one place, `src/renderer/components/settings/InfoGuide.tsx`, rendered by
`FieldRow`, so every settings section gets it without a per-section change. A row with no
description gets no button, because there would be nothing to explain.

## Keyboard and screen readers

- The button's accessible name is "About this setting: <setting name>", so it is never an
  anonymous "info" button.
- Enter or Space opens the panel and moves focus into it. Escape closes it and returns focus to
  the button. A press anywhere outside closes it without moving focus.
- The button reports `aria-expanded` and points at the open panel with `aria-controls`.

## Language and vocabulary

The setting's name and description come through the same personal-vocabulary boundary as the row
itself. The three steps are localized in English and Cantonese and are factual, so their wording
does not play at higher fun levels.

## Motion

The panel springs open from the button. Under the operating system's reduced-motion setting, the
app's own Reduce motion switch or Low stimulation it appears without animation.

## Limits

- Only Settings rows are covered so far. Controls elsewhere in the app (node headers, menus, the
  canvas) do not have an info button yet.
- The guidance never changes a value; it only explains.
- Runtime proof in the built app is pending; behaviour is covered by
  `src/renderer/components/settings/InfoGuide.test.tsx`.
