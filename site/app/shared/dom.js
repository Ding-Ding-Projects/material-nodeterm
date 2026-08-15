// site/app/shared/dom.js
//
// Tiny DOM helpers shared by every feature module. No framework, no build
// step — this site is plain ES modules loaded directly by the browser.

/**
 * Minimal hyperscript: h('button', {class:'x', onClick: fn}, ['text']).
 * Props starting with "on" + capital letter are wired as event listeners.
 * `class` may be a string. Children may be strings, Nodes, or nested arrays.
 */
export function h(tag, props, children) {
  const el = document.createElement(tag)
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue
      if (key === 'class') el.className = value
      else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value)
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value)
      } else if (key === 'html') {
        el.innerHTML = value
      } else if (typeof value === 'boolean') {
        if (value) el.setAttribute(key, '')
      } else {
        el.setAttribute(key, value)
      }
    }
  }
  appendChildren(el, children)
  return el
}

function appendChildren(el, children) {
  if (children == null) return
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    if (child == null || child === false) continue
    if (Array.isArray(child)) {
      appendChildren(el, child)
    } else if (child instanceof Node) {
      el.appendChild(child)
    } else {
      el.appendChild(document.createTextNode(String(child)))
    }
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild)
}

const injected = new Set()

/** Injects a <style> block once per id. Used so feature modules can ship
 * their own scoped CSS without ever touching site/styles.css, which is
 * owned by the shell lane. Everything here reads the M3 tokens already
 * defined on :root in styles.css (var(--md-*)) rather than inventing new
 * colors, so feature UI matches the rest of the page in both themes. */
export function injectStyleOnce(id, css) {
  if (injected.has(id)) return
  if (document.getElementById(id)) {
    injected.add(id)
    return
  }
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
  injected.add(id)
}

/** requestAnimationFrame-batched re-render helper: call schedule(fn) many
 * times per tick and fn runs once. */
export function batched(fn) {
  let queued = false
  return () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      fn()
    })
  }
}
