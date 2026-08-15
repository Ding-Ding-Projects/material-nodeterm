// site/app/shared/mountable.js
//
// site/app/core/registry.js (owned by a sibling lane) is still being built
// alongside this one, so the exact calling convention for a `render`/
// `control` factory — called with a container to mount into, or called with
// no arguments and expected to return an element — is not fully pinned down
// yet. Every feature module in this lane builds its UI through `asMountable`
// so it works either way without guessing wrong and rendering nothing.

/**
 * Wraps a zero-arg element builder so it can be called either as
 * fn(container) -> mounts into container, returns undefined
 * or as fn() -> returns the built element for the caller to place.
 */
export function asMountable(build) {
  return function mount(container) {
    let el
    try {
      el = build()
    } catch (err) {
      console.warn('[nodeterm-site] a feature panel failed to build', err)
      el = document.createElement('div')
      el.textContent = 'This panel could not be built.'
      el.className = 'site-panel-error'
    }
    if (container instanceof Node) {
      container.appendChild(el)
      return undefined
    }
    return el
  }
}
