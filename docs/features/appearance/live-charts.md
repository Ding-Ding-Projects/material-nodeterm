# Live charts

Charts whose data changes while they are on screen use one component,
`src/renderer/components/LiveChart.tsx`, drawn in the Liveline style: a smoothly easing line, a
fill gradient from the series colour, a quiet dotted grid, a value badge, a pulsing dot on the
newest point, and a crosshair you can scrub.

The first chart is **RAM in use** at the top of the session memory panel (the RAM pill at the
bottom left of the canvas). It plots the share of RAM in use on the machine the active project
runs on, from the readings the pill already takes.

## Honest states

| State | When | What you see |
| --- | --- | --- |
| Live | A local project, last reading within two poll intervals (60 s) | Line in the primary colour, pulsing dot, badge with the newest value |
| Paused | An SSH project. Its host is read on demand only, never polled | Line and values, no pulse, caption "Read on demand on this host — not live." |
| Stale | No new local reading for more than 60 s | Line and values, no pulse, caption "No new reading for a while." |
| Loading | No reading yet and one is in flight | No line, caption "Measuring…" |
| Unavailable | No reading, or a relay tab whose sessions are on another machine | No line, caption "No RAM readings yet." |

Nothing is drawn that the source did not send. A reading with no usable total adds no point, so a
failed read shows as a gap in time rather than as 0% or 100%. History is kept per machine: switching
to a project on another machine starts the chart empty.

## Scrubbing

Move the pointer over the plot, or focus it and use the arrow keys (Home and End jump to the ends,
Escape returns to the newest point). The badge and caption show the scrubbed time and value, and
the caption is announced to screen readers. The plot's accessible name always carries the current
value and state.

## Motion

The line and the newest point glide to each new reading on the default spring. Under the
operating system's reduced-motion setting, the app's own Reduce motion switch or Low stimulation,
the line snaps instead and the dot stops pulsing; every value stays readable.

## Limits

The chart keeps the newest 60 readings (half an hour at the 30-second local poll). It does not
persist across restarts.

## Verification

`src/renderer/components/LiveChart.test.tsx` covers the live, stale, paused, loading and
unavailable states, keyboard scrubbing, the path and range helpers, and the RAM history rules.
