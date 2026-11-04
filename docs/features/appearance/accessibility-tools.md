# Accessibility tools

The accessibility tools button sits at the bottom of the navigation rail, above Kids mode. It is
visible by default and opens a small menu anchored beside the rail.

## Behavior

| Control | What it changes | Stored as |
| --- | --- | --- |
| Text size − / + | The whole interface scale in 10% steps, from 50% to 200% | `uiScale` (shared with Settings → Appearance) |
| High contrast | Outlines and secondary text use the strongest outline and text roles | `a11yHighContrast` |
| Reduce motion | Every transition and animation settles at once; pressed controls stop scaling | `a11yReduceMotion` |
| Bold focus ring | A 4px focus ring with extra offset on every keyboard-focused element | `a11yBoldFocus` |
| Larger targets | Buttons, chips and list rows grow to at least 48px; icon buttons to 48 × 48px | `a11yLargerTargets` |
| Keyboard shortcuts | Closes the menu and opens the shortcuts panel | — |

Each mode is independent and off by default. Reduce motion composes with the operating system's
reduced-motion setting and with Low stimulation: any one of them is enough to stop motion, and
none of them turns the others off.

## Hiding the button

**Hide this button…** asks first, with **Cancel** focused. Confirming hides only the button; every
mode you turned on stays on. Bring it back with **Settings → Appearance → Accessibility tools
button**, or by resetting the Appearance section.

## Keyboard

The button is a normal focusable control. In the menu, Tab moves through the controls, Escape
closes the hide confirmation first and then the menu, and focus returns to the button.

## Configuration and failure modes

All five values live in `settings.json`. Only a literal `true` turns a mode on, and only a literal
`false` hides the button, so a hand-edited value of the wrong type leaves the button visible and the
mode off. The modes reach the page as `data-a11y-*` attributes on the document root; the rules
live at the end of `src/renderer/ui/md3/primitives.css`.

## Not yet included

- Reading the screen aloud. The menu has no read-aloud control yet; the narrator in Settings still
  announces agent events.

## Verification

`src/renderer/components/AccessibilityTools.test.tsx` covers the default visibility, each switch
writing only its own setting, text-size steps and bounds, the hide confirmation with Cancel focused,
that hiding keeps the modes, Escape and focus return, and the attribute mapping.
