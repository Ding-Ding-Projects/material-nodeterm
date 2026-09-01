// Tracks whether the Windows Ctrl zoom modifier is currently held, via a single set of
// capture-phase window listeners. Used by the terminal hover-guard so Ctrl+wheel zooming over
// a terminal doesn't dwell-focus (enter) the terminal — the canvas keeps zooming instead.
let held = false
let inited = false

function ensure(): void {
  if (inited) return
  inited = true
  const down = (e: KeyboardEvent) => {
    if (e.key === 'Control' || e.ctrlKey) held = true
  }
  const up = (e: KeyboardEvent) => {
    if (e.key === 'Control' || !e.ctrlKey) held = false
  }
  window.addEventListener('keydown', down, true)
  window.addEventListener('keyup', up, true)
  window.addEventListener('blur', () => (held = false))
}

/** True while Ctrl is currently pressed. */
export function isZoomModifierHeld(): boolean {
  ensure()
  return held
}
