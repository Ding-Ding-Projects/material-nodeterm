// site/app/shared/lockGate.js
//
// The little gate any locked settings box (or hallway door) renders
// instead of its real content: a password field and an Open button. Pure
// function of state -> a decision object; app/core/dom.js turns that into
// markup and app/features/locks.js wires the input/button handlers.

import { isLocked } from './locks-state.js'

export function guardPanel(state, id) {
  const locked = isLocked(state.locks, state.unlocked, id)
  return {
    locked,
    open: !locked,
    hasLock: !!state.locks[id],
  }
}
