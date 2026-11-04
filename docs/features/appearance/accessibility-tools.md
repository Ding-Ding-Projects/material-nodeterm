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
| Read aloud / Stop | Speaks the text you had selected, or the focused element's text, when you opened the menu; Stop ends it | — |
| Keyboard shortcuts | Closes the menu and opens the shortcuts panel | — |

Each mode is independent and off by default. Reduce motion composes with the operating system's
reduced-motion setting and with Low stimulation: any one of them is enough to stop motion, and
none of them turns the others off.

## Read aloud

Read aloud speaks through the app narrator (`src/renderer/lib/readAloud.ts`), using the voices,
rate and pitch from Settings → Narrator. It works whether or not narration of app events is
switched on, because you asked for it. What it reads is captured when you press the
accessibility button: your text selection if there is one, otherwise the text of whatever had
focus. It never reads the value of a password field and stops after 4,000 characters, at a word
end. Text with Chinese characters is read with the Cantonese voice when Cantonese is allowed;
School mode keeps it English, the same rule as all narration. With nothing to read, the menu says
what to do instead of staying silent, and when the system has no speech engine the button is
disabled with that reason.

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

- Continuous screen reading (following focus as it moves). Read aloud reads one selection or
  element per press; a full screen reader remains the operating system's job.

## Verification

`src/renderer/components/AccessibilityTools.test.tsx` covers the default visibility, each switch
writing only its own setting, text-size steps and bounds, the hide confirmation with Cancel focused,
that hiding keeps the modes, Escape and focus return, the attribute mapping, and Read aloud (the
captured text, Stop, the empty case and the unavailable case). `src/renderer/lib/readAloud.test.ts`
covers text selection, the password exclusion, the length cap and the language choice.
