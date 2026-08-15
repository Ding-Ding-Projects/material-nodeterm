// site/app/core/menu.js
//
// A generic, anchored, keyboard-focusable filterable menu — used by the
// tab strip's context menu and its overflow ("More") list. Every
// right-click menu and dropdown on this site opens through this one
// function, including ones with only a handful of items: "it's short" is
// not an exemption from the search-field requirement.

export function openMenu({ x, y, anchor, items, ariaLabel = 'Menu' }) {
  const scrim = document.createElement('div')
  scrim.className = 'menu__scrim'

  const menu = document.createElement('div')
  menu.className = 'menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', ariaLabel)

  const filter = document.createElement('input')
  filter.type = 'text'
  filter.placeholder = 'Filter…'
  filter.className = 'menu__filter'
  filter.setAttribute('aria-label', `Filter ${ariaLabel.toLowerCase()}`)
  menu.appendChild(filter)

  const list = document.createElement('div')
  list.className = 'menu__list'
  menu.appendChild(list)

  function renderList(query) {
    list.innerHTML = ''
    const q = (query || '').toLowerCase()
    const visible = items.filter((it) => !q || it.label.toLowerCase().includes(q))
    if (!visible.length) {
      const empty = document.createElement('div')
      empty.className = 'menu__empty'
      empty.textContent = 'No matches.'
      list.appendChild(empty)
      return
    }
    visible.forEach((it) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'menu__item'
      btn.setAttribute('role', 'menuitem')
      btn.textContent = it.label
      btn.disabled = !!it.disabled
      if (!it.disabled) {
        btn.addEventListener('click', () => {
          close()
          it.onSelect && it.onSelect()
        })
      }
      list.appendChild(btn)
    })
  }
  filter.addEventListener('input', () => renderList(filter.value))
  renderList('')

  document.body.appendChild(scrim)
  document.body.appendChild(menu)
  position()
  filter.focus()

  function position() {
    menu.style.position = 'fixed'
    menu.style.maxHeight = '70vh'
    menu.style.overflowY = 'auto'
    const vw = window.innerWidth
    const width = Math.min(240, vw - 16)
    let left = Math.min(Math.max(8, x), vw - width - 8)
    menu.style.width = `${width}px`
    menu.style.left = `${left}px`
    menu.style.top = `${y}px`
    requestAnimationFrame(() => {
      const vh = window.innerHeight
      const h = menu.getBoundingClientRect().height
      let top = y
      if (top + h > vh - 8) top = Math.max(8, vh - h - 8)
      menu.style.top = `${top}px`
    })
  }

  function onKeydown(e) {
    if (e.key === 'Escape') close()
  }
  scrim.addEventListener('click', close)
  document.addEventListener('keydown', onKeydown, true)

  function close() {
    document.removeEventListener('keydown', onKeydown, true)
    scrim.remove()
    menu.remove()
    anchor && anchor.focus && anchor.focus()
  }

  return { close }
}
