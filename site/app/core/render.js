// site/app/core/render.js
//
// The single render() function: state -> one big HTML string mounted into
// #app-root, mirroring the imported design's own "renderVals() feeds a
// template" shape. Interactivity is wired through delegated listeners in
// app/main.js reading `data-action` / `data-bind` / `data-menu*`
// attributes — nothing here attaches a listener directly.

import { esc, attr } from './dom.js'
import { makeMatcher } from './store.js'
import { getRoom, allSettingsCards, computeRx, fmtWhen } from './engine.js'
import { SECTIONS, FEATURES, DOCS, COVERAGE, REPO_URL, REPO_RELEASES, UPSTREAM_URL } from '../shared/data.js'
import { shapeVoice, shapeTitle, effLang } from '../shared/i18n.js'
import { guardPanel } from '../shared/lockGate.js'

function doorColor(i) {
  const colors = ['var(--red)', 'var(--orange)', 'var(--yellow)', 'var(--green)', 'var(--blue)', 'var(--purple)', 'var(--pink)']
  return colors[i % colors.length]
}
function badgeFor(state, id) {
  if (id === 'notes') return String(state.notes.length)
  if (id === 'history') return String(state.history.length)
  if (id === 'docs') return String(DOCS.length)
  if (id === 'auth') return String(state.auth.length)
  if (id === 'coverage') return String(COVERAGE.length)
  return ''
}
function searchBar({ id, value, placeholder, ariaLabel, rxKey, state, cls, autoIconSize }) {
  const on = !!state.rxOn[rxKey]
  return `<div class="searchbar ${cls || ''}" data-menu-kind="search" data-menu-label="${attr(ariaLabel)}">
    <span class="searchbar__icon" aria-hidden="true">🔎</span>
    <input type="search" data-bind="${id}" data-focus-id="${id}" value="${attr(value)}" placeholder="${attr(placeholder)}" aria-label="${attr(ariaLabel)}" />
    <button type="button" class="rx-btn ${on ? 'is-on' : ''}" data-action="open-rx" data-id="${rxKey}" data-arg="${attr(ariaLabel)}" title="Build a pattern for this search box" aria-label="Regex builder for ${attr(ariaLabel)}">.*</button>
  </div>`
}

// -------------------------------------------------------------- hall ----
function renderHall(store) {
  const s = store.state
  const nm = makeMatcher(s, 'nav', s.qNav)
  const gm = makeMatcher(s, 'global', s.qGlobal)
  const doors = SECTIONS.filter((x) => nm(x.label + ' ' + x.title + ' ' + x.sub) && gm(x.label + ' ' + x.title + ' ' + x.sub))
  const featuresFiltered = FEATURES.filter((f) => gm(f.title + ' ' + f.body))
  const statCards = [
    { icon: '🧩', value: String(FEATURES.length), note: 'things it can do' },
    { icon: '📚', value: String(DOCS.length), note: 'guide pages' },
    { icon: '✅', value: String(COVERAGE.length), note: 'promises on the checklist' },
    { icon: '📦', value: '10', note: 'shapes you can save as' },
  ]
  const mascot = s.school ? '🦉' : ['🐣', '🦕', '🐙', '🐝', '🦊'][s.dishIdx % 5]
  const greeting = (s.nick ? 'Hello, ' + esc(s.nick) + '!' : 'Hello!') + ' Pick a door.'

  return `<div class="hall" data-view="hall">
    <header class="hall__header" data-menu-kind="header" data-menu-label="the top bar">
      <a class="brand" href="./index.html" data-no-room>
        <span class="brand__mark" style="background-image:url('${attr(s.logo || './assets/mark.svg')}')"></span>
        <span class="brand__name">nodeterm school</span>
      </a>
      ${searchBar({ id: 'qGlobal', value: s.qGlobal, placeholder: 'Which room are you looking for?', ariaLabel: 'the whole school', rxKey: 'global', state: s, cls: 'header-search' })}
      <div class="header-actions">
        <button type="button" class="round-btn round-btn--jump" data-action="open-palette" data-menu-kind="generic" data-menu-label="this button" title="Magic jump box — Ctrl+Shift+F">✨ Jump</button>
        <button type="button" class="round-btn round-btn--theme" data-action="toggle-theme" data-menu-kind="generic" data-menu-label="this button" aria-label="Day or night">${s.theme === 'night' ? '🌙' : '☀️'}</button>
        <button type="button" class="round-btn round-btn--bell" data-action="go-room" data-id="notes" data-menu-kind="generic" data-menu-label="this button" aria-label="Message box">🔔${s.notes.length ? `<span class="bell-count">${s.notes.length}</span>` : ''}</button>
      </div>
    </header>

    <div class="hall__intro">
      <div class="hall__mascot" aria-hidden="true">${mascot}</div>
      <div style="flex:1 1 240px">
        <h1 class="hall__greeting">${greeting}</h1>
        <div class="pill" style="margin-top:4px">the whole home page is right here — the doors are extra rooms</div>
        <p style="margin:2px 0 0;font-size:15px;color:var(--ink2)">${esc(shapeVoice(s, 'Every door opens a different room. Some rooms you can lock with your own password, and every single one has a search box and a right-click menu.'))}</p>
      </div>
      ${searchBar({ id: 'qNav', value: s.qNav, placeholder: 'Filter the doors…', ariaLabel: 'the room list', rxKey: 'nav', state: s, cls: 'hall__nav-search' })}
    </div>

    <div class="doors" data-menu-kind="rail" data-menu-label="the room list">
      <div class="doors__grid">
        ${doors.length ? doors.map((x, i) => doorTile(s, x, i)).join('') : `<div class="empty" style="grid-column:1/-1">No door has that name. Try the <strong>.*</strong> button next to the filter! 🔎</div>`}
      </div>

      <div class="hall__sections">
        <div class="card card--lg hero-panel">
          <div class="hero-panel__blob" aria-hidden="true"></div>
          <div class="hero-panel__body">
            <div class="pill" style="background:var(--pink)">a playground for your computer</div>
            <h2>Your terminals are<br />blocks on a giant canvas.</h2>
            <p>Every terminal is a block you can drag around. Robot helpers get their own blocks too, and they raise a hand when they need you. Nothing disappears when you close the lid.</p>
            <div class="cta-row">
              <a class="btn" style="background:var(--green)" href="${REPO_RELEASES}" target="_blank" rel="noopener">⬇ Get nodeterm</a>
              <a class="btn" href="${REPO_URL}" target="_blank" rel="noopener">👀 Peek at the code</a>
              <span class="brew-pill">brew install --cask nodeterm</span>
            </div>
          </div>
        </div>

        <div class="stat-grid">
          ${statCards.map((c) => `<div class="card stat-card" data-menu-kind="stat" data-menu-label="${attr(c.note)}"><div class="stat-card__icon" aria-hidden="true">${c.icon}</div><div class="stat-card__value">${c.value}</div><div class="stat-card__note">${esc(c.note)}</div></div>`).join('')}
        </div>

        <div>
          <h3 style="margin-bottom:12px">What's inside the box? <span style="font-size:14px;font-weight:600;color:var(--ink2)">${featuresFiltered.length} of ${FEATURES.length} showing</span></h3>
          <div class="feature-grid feature-grid--home">
            ${featuresFiltered.length ? featuresFiltered.map((f) => featureCard(f)).join('') : `<div class="empty" style="grid-column:1/-1">Nothing matched that search. 🐛</div>`}
          </div>
        </div>

        <div>
          <h3 style="margin-bottom:12px">How it goes 🚀</h3>
          <div class="steps-grid">
            <div class="step-card" style="background:var(--yellow)"><div class="step-card__n">1</div><h4>Right-click the canvas</h4><p>Open a terminal, or a robot helper, wherever you want it. It becomes a block you can move.</p></div>
            <div class="step-card" style="background:var(--blue)"><div class="step-card__n">2</div><h4>Lay it out in space</h4><p>Group blocks, label them, zoom out to see everything at once. The map stays put across restarts.</p></div>
            <div class="step-card" style="background:var(--pink)"><div class="step-card__n">3</div><h4>Walk away, come back</h4><p>Close the lid, reboot the machine. Your terminals and your helpers are exactly where you left them.</p></div>
          </div>
        </div>

        <div class="surface-grid">
          <div class="surface-card"><div class="surface-card__icon" aria-hidden="true">🖥</div><h4>On your desk</h4><p>The app for macOS and Linux, with native window chrome and auto-update.</p></div>
          <div class="surface-card"><div class="surface-card__icon" aria-hidden="true">🌍</div><h4>In any browser</h4><p>Server Edition serves the same canvas from your own machine, so you can reach it anywhere.</p></div>
          <div class="surface-card"><div class="surface-card__icon" aria-hidden="true">📱</div><h4>In your pocket</h4><p>Scan one code and the same live session carries on in the iOS app.</p></div>
        </div>

        <div class="promo-panel">
          <div class="promo-panel__icon" aria-hidden="true">🎮</div>
          <div style="flex:1 1 240px">
            <h3>Playroom: three little games</h3>
            <p>Memory pairs, dumpling maths, and whack-a-block. All three keep score, and your best score is saved.</p>
          </div>
          <button type="button" class="btn" style="background:var(--yellow);height:56px;font-size:18px" data-action="enter-door" data-id="play">🎮 Open the playroom</button>
        </div>

        <div class="closer-panel">
          <h3>Stop hunting through tabs.</h3>
          <p>Free, open source, and it works offline. macOS 12+ and Linux x64.</p>
          <div class="cta-row" style="justify-content:center">
            <a class="btn" style="background:var(--card);height:56px;font-size:18px" href="${REPO_RELEASES}" target="_blank" rel="noopener">⬇ Download nodeterm</a>
            <button type="button" class="btn" style="background:var(--card);height:56px;font-family:var(--mono);font-size:14px" data-action="copy-brew">📋 brew install --cask nodeterm</button>
          </div>
        </div>
      </div>
    </div>

    <footer class="site-footer">
      <span>Everything you do stays in this browser. Nothing is sent anywhere.</span>
      <div class="spacer"></div>
      <span>Right-click any door for its own little menu 🖱</span>
    </footer>
  </div>`
}

function doorTile(state, x, i) {
  const locked = !!state.locks['room:' + x.id] && !state.unlocked['room:' + x.id]
  const badge = badgeFor(state, x.id)
  const opening = state.opening === x.id ? 'is-opening' : ''
  const knocking = state.knock === x.id ? 'is-knocking' : ''
  return `<div class="door-slot" data-menu-kind="room" data-menu-label="${attr(x.label)}" data-menu-extra="${attr(x.id)}">
    <button type="button" class="door-frame" data-action="enter-door" data-id="${x.id}" aria-label="${locked ? 'Locked door: ' : 'Open the door to '}${attr(x.label)}">
      <span class="door-frame__peek">${x.icon}</span>
      <span class="door-frame__door ${opening} ${knocking}" style="background:${doorColor(i)}">
        <span class="door-frame__plaque">${x.icon}</span>
        <span class="door-frame__knob"></span>
        ${locked ? '<span class="door-frame__lock">🔒</span>' : ''}
        ${badge ? `<span class="door-frame__badge">${badge}</span>` : ''}
      </span>
    </button>
    <div class="door-slot__label">${esc(x.label)}</div>
    <div class="door-slot__hint">${esc(x.kicker)}</div>
  </div>`
}
function featureCard(f) {
  return `<article class="card feature-card" data-menu-kind="card" data-menu-label="${attr(f.title)}">
    <div class="feature-card__icon" style="background:${f.color}">${f.icon}</div>
    <h4>${esc(f.title)}</h4>
    <p>${esc(f.body)}</p>
  </article>`
}

// -------------------------------------------------------------- room ----
function renderRoom(store) {
  const s = store.state
  const section = SECTIONS.find((x) => x.id === s.sec) || SECTIONS[0]
  const nm = makeMatcher(s, 'nav', s.qNav)
  const gm = makeMatcher(s, 'global', s.qGlobal)
  const navItems = SECTIONS.filter((x) => nm(x.label + ' ' + x.title + ' ' + x.sub) && gm(x.label + ' ' + x.title + ' ' + x.sub))
  const storageLine = `${s.notes.length} messages · ${s.history.length} log entries · ${s.auth.length} codes · ${Object.keys(s.locks).length} toy locks. All of it in this browser only.`

  return `<div class="room" data-view="room">
    <header class="room__header" data-menu-kind="header" data-menu-label="the top bar">
      <a class="brand" href="./index.html" data-no-room>
        <img class="brand__mark" src="./assets/mark.svg" alt="" width="34" height="34" style="padding:3px;background:var(--yellow)" />
        <span class="brand__name">nodeterm</span>
        <span class="brand__ver">v0.3.0</span>
      </a>
      ${searchBar({ id: 'qGlobal', value: s.qGlobal, placeholder: 'Search the whole playground…', ariaLabel: 'the big search', rxKey: 'global', state: s, cls: 'header-search' })}
      <div class="header-actions">
        <button type="button" class="round-btn round-btn--jump" data-action="open-palette" data-menu-kind="generic" data-menu-label="this button" title="Magic jump box — Ctrl+Shift+F">✨ Jump</button>
        <button type="button" class="round-btn round-btn--theme" data-action="toggle-theme" data-menu-kind="generic" data-menu-label="this button" aria-label="Switch between day and night">${s.theme === 'night' ? '🌙' : '☀️'}</button>
        <button type="button" class="round-btn round-btn--bell" data-action="go-room" data-id="notes" data-menu-kind="generic" data-menu-label="this button" aria-label="Open the message box">🔔${s.notes.length ? `<span class="bell-count">${s.notes.length}</span>` : ''}</button>
      </div>
    </header>

    <div class="room__body">
      <aside class="room-rail" data-menu-kind="rail" data-menu-label="the room list">
        <button type="button" class="room-rail__leave" data-action="leave-room">🚪 Back to the hallway</button>
        <button type="button" class="room-rail__lock" data-action="lock-room">${s.locks['room:' + s.sec] ? '🔓 Unlock this door for everyone' : '🔒 Lock this door behind me'}</button>
        ${searchBar({ id: 'qNav', value: s.qNav, placeholder: 'Find a room…', ariaLabel: 'the room list', rxKey: 'nav', state: s, cls: 'room-rail__search' })}
        <nav role="tablist" aria-label="Rooms">
          ${navItems.length
            ? navItems
                .map(
                  (x) => `<button type="button" role="tab" aria-selected="${s.sec === x.id}" aria-label="${attr(x.label)}${badgeFor(s, x.id) ? ', ' + badgeFor(s, x.id) + ' items' : ''}" class="nav-btn ${s.sec === x.id ? 'is-active' : ''}" data-action="go-room" data-id="${x.id}" data-menu-kind="room" data-menu-label="${attr(x.label)}" data-menu-extra="${attr(x.id)}" style="${s.sec === x.id ? 'background:' + s.accent : ''}">
              <span class="nav-btn__icon" aria-hidden="true">${x.icon}</span>
              <span class="nav-btn__label" aria-hidden="true">${esc(x.label)}</span>
              ${badgeFor(s, x.id) ? `<span class="chip" aria-hidden="true">${badgeFor(s, x.id)}</span>` : ''}
            </button>`,
                )
                .join('')
            : `<div class="empty" style="padding:14px">No room matches that. Try the <strong>.*</strong> button!</div>`}
        </nav>
        <div class="room-rail__storage">
          <div class="room-rail__storage-title">Your stuff lives here 🧸</div>
          <p>${esc(storageLine)}</p>
          <button type="button" class="room-rail__reset" data-action="reset-all">Start fresh</button>
        </div>
      </aside>

      <main class="room-main" data-menu-kind="generic" data-menu-label="${attr(shapeTitle(s, section.title))}">
        <div class="room-main__head">
          <div class="room-main__titlewrap">
            <div class="pill">${esc(section.kicker)}</div>
            <h1>${esc(shapeTitle(s, section.title))}</h1>
            <p class="room-main__sub">${esc(shapeVoice(s, section.sub))}</p>
          </div>
          ${searchBar({ id: 'qSec', value: s.qSec, placeholder: section.ph, ariaLabel: "this room's search", rxKey: 'sec', state: s, cls: 'room-main__search' })}
        </div>
        <div class="room-main__content" data-preserve-scroll="room">
          ${renderRoomContent(store, section)}
        </div>
      </main>
    </div>

    <footer class="site-footer room-footer">
      <span>BUSL-1.1 licensed · fork of <a href="${UPSTREAM_URL}" target="_blank" rel="noopener">eneskirca/nodeterm</a></span>
      <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
      <a href="${REPO_URL}/blob/main/CHANGELOG.md" target="_blank" rel="noopener">Changelog</a>
      <a href="${REPO_URL}/issues" target="_blank" rel="noopener">Help</a>
      <div class="spacer"></div>
      <span>“Claude” and “Claude Code” are trademarks of Anthropic. nodeterm is not affiliated with or endorsed by Anthropic.</span>
    </footer>
  </div>`
}

function renderRoomContent(store, section) {
  const s = store.state
  if (section.id === 'home') return renderHomeRoom(store)
  if (section.id === 'settings') return renderSettingsRoom(store)
  const room = getRoom(section.id)
  if (!room) return `<div class="empty">This room has not been built yet.</div>`
  if (room.kind === 'list') return renderListRoom(store, room)
  if (typeof room.render === 'function') return room.render(store)
  return `<div class="empty">This room has not been built yet.</div>`
}

function renderHomeRoom(store) {
  const s = store.state
  const sm = makeMatcher(s, 'sec', s.qSec)
  const gm = makeMatcher(s, 'global', s.qGlobal)
  const statCards = [
    { icon: '🧩', value: String(FEATURES.length), note: 'things it can do' },
    { icon: '📚', value: String(DOCS.length), note: 'guide pages' },
    { icon: '✅', value: String(COVERAGE.length), note: 'promises on the checklist' },
    { icon: '📦', value: '10', note: 'shapes you can save as' },
  ]
  const features = FEATURES.filter((f) => sm(f.title + ' ' + f.body) && gm(f.title + ' ' + f.body))
  return `<div style="animation:pop .2s ease">
    <section class="stat-grid" style="margin-bottom:18px">
      <div class="card card--lg" style="grid-column:1/-1;position:relative;overflow:hidden">
        <div class="hero-panel__blob" aria-hidden="true"></div>
        <div style="position:relative">
          <div class="pill" style="background:var(--pink)">a playground for your computer</div>
          <h2 style="font-size:clamp(30px,5.4vw,52px);line-height:1.03;margin:10px 0 8px">Your terminals are<br />blocks on a giant canvas.</h2>
          <p style="margin:0 0 16px;max-width:600px;font-size:16px;color:var(--ink2)">Every terminal is a block you can drag around. Robot helpers get their own blocks too, and they raise a hand when they need you. Nothing disappears when you close the lid.</p>
          <div class="cta-row">
            <a class="btn" style="background:var(--green)" href="${REPO_RELEASES}" target="_blank" rel="noopener">⬇ Get nodeterm</a>
            <a class="btn" href="${REPO_URL}" target="_blank" rel="noopener">👀 Peek at the code</a>
          </div>
        </div>
      </div>
      ${statCards.map((c) => `<div class="card stat-card" data-menu-kind="stat" data-menu-label="${attr(c.note)}"><div class="stat-card__icon" aria-hidden="true">${c.icon}</div><div class="stat-card__value">${c.value}</div><div class="stat-card__note">${esc(c.note)}</div></div>`).join('')}
    </section>
    <section>
      <h3 style="margin-bottom:10px">What's inside the box? <span style="font-size:14px;font-weight:600;color:var(--ink2)">${features.length} of ${FEATURES.length} showing</span></h3>
      <div class="feature-grid">
        ${features.length ? features.map((f) => featureCard(f)).join('') : `<div class="empty" style="grid-column:1/-1">Nothing matched that search. 🐛</div>`}
      </div>
    </section>
  </div>`
}

function rowItem(state, row) {
  const picked = !!state.picked[row.id]
  const name = row.title + (picked ? ', picked' : '') + (row.tag ? ', ' + row.tag : '') + (row.body ? '. ' + row.body : '')
  return `<button type="button" class="row-item" aria-pressed="${picked}" aria-label="${attr(name)}" data-action="toggle-pick" data-id="${attr(row.id)}" data-menu-kind="row" data-menu-label="${attr(row.title)}" data-menu-extra='${attr(JSON.stringify({ id: row.id, title: row.title, body: row.body, url: row.url || '' }))}'>
    <span class="row-item__check ${picked ? 'is-picked' : ''}" aria-hidden="true">${picked ? '✔' : ''}</span>
    ${row.img ? `<img src="${attr(row.img)}" alt="" width="44" height="44" aria-hidden="true" style="flex:0 0 auto;border:3px solid var(--line);border-radius:12px;background:var(--paper2)" />` : ''}
    <span class="row-item__body" aria-hidden="true">
      <span class="row-item__title">
        <span class="row-item__title-text">${esc(row.title)}</span>
        ${row.tag ? `<span class="chip" style="background:${state.accent}">${esc(row.tag)}</span>` : ''}
        ${row.meta ? `<span class="row-item__meta">${esc(row.meta)}</span>` : ''}
      </span>
      <span class="row-item__text">${esc(row.body)}</span>
    </span>
    ${row.right ? `<span class="row-item__right" aria-hidden="true">${esc(row.right)}</span>` : ''}
  </button>`
}

function renderListRoom(store, room) {
  const s = store.state
  const rawRows = room.getRows(s)
  const gm = makeMatcher(s, 'global', s.qGlobal)
  const sm = makeMatcher(s, 'sec', s.qSec)
  const rows = rawRows.filter((r) => sm(r.title + ' ' + r.body + ' ' + (r.tag || '')) && gm(r.title + ' ' + r.body))
  const pickedIds = Object.keys(s.picked).filter((k) => rawRows.some((r) => r.id === k))
  const allPicked = rawRows.length > 0 && pickedIds.length === rawRows.length
  const panelActions = room.panelActions ? room.panelActions(store) : []

  return `<div style="animation:pop .2s ease">
    <div class="list-toolbar">
      <button type="button" class="btn-plain" data-action="select-all">${allPicked ? 'Unpick all ' + rawRows.length : 'Pick all ' + rawRows.length}</button>
      <button type="button" class="btn-plain" data-action="invert-picks">Flip picks</button>
      <button type="button" class="btn-plain" style="background:var(--red);opacity:${pickedIds.length ? 1 : 0.45};cursor:${pickedIds.length ? 'pointer' : 'not-allowed'}" data-action="bulk-remove">${pickedIds.length ? '🗑 Throw away ' + pickedIds.length : '🗑 Throw away'}</button>
      ${panelActions.map((a, i) => `<button type="button" class="btn-plain" style="background:var(--yellow)" data-action="panel-action" data-id="${i}">${esc(a.label)}</button>`).join('')}
      <div class="spacer"></div>
      <span class="list-meta">${rawRows.length} shown · ${pickedIds.length} picked</span>
    </div>
    ${
      room.hasDateFilter
        ? `<div class="date-filter">
      <span style="font-weight:700">📅 Between</span>
      <input type="date" data-bind="dateFrom" value="${attr(s.dateFrom)}" aria-label="From date" />
      <span style="font-weight:700">and</span>
      <input type="date" data-bind="dateTo" value="${attr(s.dateTo)}" aria-label="To date" />
      <button type="button" class="btn-plain" data-action="date-range" data-id="30">30 days</button>
      <button type="button" class="btn-plain" data-action="date-range" data-id="90">90 days</button>
      <button type="button" class="btn-plain" data-action="date-range" data-id="all">Everything</button>
    </div>`
        : ''
    }
    ${room.addRow ? room.addRow(store) : ''}
    <div class="rows">
      ${rows.length ? rows.map((r) => rowItem(s, r)).join('') : `<div class="empty">${esc(room.emptyText || 'Nothing here.')}</div>`}
    </div>
    <p class="list-footnote">${esc(room.footnote ? room.footnote(s) : 'Click a row to pick it. Right-click for its own menu. Anything that throws something away asks you to type a word first.')}</p>
  </div>`
}

// -------------------------------------------------------------- settings ----
function ctlHtml(cardId, ctl) {
  const label = `<label>${esc(ctl.label)}</label>`
  if (ctl.isSelect) {
    return `<div class="ctl-row">${label}<select data-bind-select="${attr(ctl.action)}" data-id="${attr(cardId)}" aria-label="${attr(ctl.label)}">${(ctl.options || []).map((o) => `<option value="${attr(o.id)}" ${o.id === ctl.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`
  }
  if (ctl.isRange) {
    return `<div class="ctl-row">${label}<div class="ctl-range"><input type="range" min="${ctl.min}" max="${ctl.max}" step="1" value="${ctl.value}" data-bind-range="${attr(ctl.action)}" data-id="${attr(cardId)}" data-focus-id="ctl-${attr(cardId)}-${attr(ctl.action)}" aria-label="${attr(ctl.label)}" aria-valuetext="${ctl.value}" /><span class="ctl-range__val" aria-hidden="true">${ctl.value}</span></div></div>`
  }
  if (ctl.isToggle) {
    return `<div class="ctl-row">${label}<button type="button" class="toggle ${ctl.on ? 'is-on' : ''}" role="switch" aria-checked="${ctl.on}" data-action="${attr(ctl.action)}" data-id="${attr(cardId)}">${esc(ctl.toggleLabel)}</button></div>`
  }
  if (ctl.isText) {
    return `<div class="ctl-row">${label}<input data-bind-text="${attr(ctl.action)}" data-id="${attr(cardId)}" data-focus-id="ctl-${attr(cardId)}-${attr(ctl.action)}" type="${ctl.type || 'text'}" value="${attr(ctl.value)}" placeholder="${attr(ctl.placeholder || '')}" aria-label="${attr(ctl.label)}" /></div>`
  }
  if (ctl.isColor) {
    return `<div class="ctl-row">${label}<div class="swatch-row">${(ctl.swatches || []).map((sw) => `<button type="button" class="swatch ${sw.picked ? 'is-picked' : ''}" style="background:${sw.hex}" title="${attr(sw.name)}" aria-label="${attr(sw.name)}" data-action="pick-accent" data-id="${attr(sw.hex)}"></button>`).join('')}</div></div>`
  }
  if (ctl.isButton) {
    return `<div class="ctl-row">${label}<button type="button" class="btn-set" data-action="${attr(ctl.action)}" data-id="${attr(cardId)}">${esc(ctl.toggleLabel)}</button></div>`
  }
  return ''
}

function renderSettingsRoom(store) {
  const s = store.state
  const sm = makeMatcher(s, 'sec', s.qSec)
  const gm = makeMatcher(s, 'global', s.qGlobal)
  const cards = allSettingsCards().filter((c) => sm(c.title + ' ' + c.desc) && gm(c.title + ' ' + c.desc))
  return `<div class="settings-grid" style="animation:pop .2s ease">
    ${cards.map((c) => settingsCardHtml(store, c)).join('')}
  </div>`
}
function settingsCardHtml(store, c) {
  const s = store.state
  const gate = guardPanel(s, c.id)
  const controls = typeof c.controls === 'function' ? c.controls(s) : []
  return `<section class="card" data-menu-kind="setting" data-menu-label="${attr(c.title)}" data-menu-extra="${attr(c.id)}">
    <div class="settings-card__head">
      <span aria-hidden="true" style="font-size:24px">${c.icon}</span>
      <h3>${esc(c.title)}</h3>
      <button type="button" class="settings-card__lock" data-action="toggle-lock" data-id="${attr(c.id)}" title="Put a toy lock on this box">${gate.hasLock ? (gate.locked ? '🔒' : '🔓') : '➕'}</button>
    </div>
    <p class="settings-card__desc">${esc(c.desc)}</p>
    ${
      gate.locked
        ? `<div class="lock-gate">
        <span style="font-weight:700;font-size:13px">🔒 This box has its own password.</span>
        <input type="password" data-bind-unlock="${attr(c.id)}" value="${attr(s.unlockVals[c.id] || '')}" aria-label="Unlock password" />
        <button type="button" class="btn-plain" style="background:var(--green)" data-action="unlock-panel" data-id="${attr(c.id)}">Open</button>
      </div>`
        : `<div style="display:flex;flex-direction:column;gap:12px">
        ${controls.map((ctl) => ctlHtml(c.id, ctl)).join('')}
        <p class="settings-card__note">${esc(typeof c.note === 'function' ? c.note(s) : c.note)}</p>
      </div>`
    }
  </section>`
}

// -------------------------------------------------------------- overlays ----
function renderMenu(store) {
  const s = store.state
  if (!s.menuOpen) return ''
  const mm = makeMatcher(s, 'menu', s.menuQuery)
  const items = (store.menuItemsCache || []).filter((m) => mm(m.label + ' ' + (m.hint || '')))
  return `<div class="menu-scrim" data-action="close-menu"></div>
  <div class="menu-panel" role="menu" style="left:${s.menuX}px;top:${s.menuY}px" data-stop-menu-close="1">
    <div class="menu-panel__title">Menu for ${esc(s.menuLabel || 'this')}</div>
    <div class="menu-panel__search">
      <span aria-hidden="true" style="padding:0 4px 0 10px">🔍</span>
      <input data-bind="menuQuery" data-focus-id="menuQuery" value="${attr(s.menuQuery)}" placeholder="Filter this menu…" aria-label="Filter this right-click menu" />
      <button type="button" class="rx-btn ${s.rxOn.menu ? 'is-on' : ''}" style="height:34px" data-action="open-rx" data-id="menu" data-arg="this menu filter" title="Regex builder for this menu filter" aria-label="Regex builder for this menu filter">.*</button>
    </div>
    <div class="menu-panel__list">
      ${items.length ? items.map((m, i) => `<button type="button" role="menuitem" class="menu-item" data-action="run-menu-item" data-id="${i}"><span class="menu-item__icon" aria-hidden="true">${m.icon}</span><span class="menu-item__label">${esc(m.label)}</span><span class="menu-item__hint">${esc(m.hint || '')}</span></button>`).join('') : `<div style="padding:14px;text-align:center;color:var(--faint);font-size:12px">Nothing in this menu matches.</div>`}
    </div>
  </div>`
}

function renderRx(store) {
  const s = store.state
  if (!s.rxOpen) return ''
  const rx = computeRx(s)
  const { RX_TOKENS } = store.dataTables
  return `<div class="dialog-scrim" data-action="close-rx">
    <div class="rx-dialog" role="dialog" aria-label="Regex builder" data-stop-menu-close="1">
      <div class="rx-dialog__head">
        <span aria-hidden="true" style="font-size:22px">🧩</span>
        <strong style="font-family:var(--fun);font-size:19px">Pattern builder</strong>
        <span class="rx-dialog__badge">${esc(s.rxTarget ? s.rxTarget.name : '')}</span>
        <div class="spacer"></div>
        <button type="button" class="rx-btn ${s.rxOn[rx.key] ? 'is-on' : ''}" style="height:40px" data-action="rx-toggle-mode">${s.rxOn[rx.key] ? 'Pattern mode ON' : 'Plain words'}</button>
        <button type="button" class="btn-plain" style="min-width:44px;padding:0" data-action="close-rx" aria-label="Close the pattern builder">✕</button>
      </div>
      <label>Your pattern <span style="color:var(--faint);font-weight:600">(up to 200 letters)</span></label>
      <div class="rx-fields">
        <input data-bind-rx="pattern" data-focus-id="rxPattern" spellcheck="false" aria-label="Pattern" value="${attr(rx.pattern)}" />
        <input data-bind-rx="flags" data-focus-id="rxFlags" aria-label="Flags" value="${attr(rx.flags)}" />
      </div>
      <div class="rx-tokens">
        ${RX_TOKENS.map((t, i) => `<button type="button" class="rx-token" style="background:${t[2]}" title="${attr(t[3])}" data-action="rx-insert" data-id="${i}">${esc(t[0])}</button>`).join('')}
      </div>
      <label>Try it on some words</label>
      <textarea class="rx-sample" data-bind="rxSample" spellcheck="false" aria-label="Sample text">${esc(s.rxSample)}</textarea>
      <div class="note-box ${rx.bad ? 'is-bad' : rx.groups.length ? 'is-ok' : ''}">${esc(rx.result)}</div>
      ${
        rx.groups.length
          ? `<div class="rx-groups"><div style="font-weight:700;margin-bottom:2px">Things it caught</div>${rx.groups.map((g) => `<div class="rx-group-row"><span class="n">${g.n}</span><span class="v">${esc(g.v)}</span></div>`).join('')}</div>`
          : ''
      }
      <div class="rx-actions">
        <button type="button" class="btn" style="background:var(--green)" data-action="rx-apply">Use this pattern</button>
        <button type="button" class="btn-plain" data-action="rx-plain">Back to plain words</button>
      </div>
      <p class="rx-footnote">The pattern and the sample are both length-capped and every test is wrapped, so a broken pattern tells you instead of freezing. That makes runaway patterns unlikely, not impossible — a real guarantee needs a worker with a stop-watch, which a page like this doesn't have.</p>
    </div>
  </div>`
}

function renderPalette(store) {
  const s = store.state
  if (!s.paletteOpen) return ''
  const mm = makeMatcher(s, 'palette', s.paletteQuery)
  const items = (store.paletteItemsCache || []).filter((p) => mm(p.label + ' ' + p.hint)).slice(0, 50)
  return `<div class="dialog-scrim" data-action="close-palette">
    <div class="palette-dialog" role="dialog" aria-label="Magic jump box" data-stop-menu-close="1">
      <div class="palette-dialog__search">
        <span aria-hidden="true" style="padding:0 12px;font-size:22px">✨</span>
        <input data-bind="paletteQuery" data-focus-id="paletteQuery" value="${attr(s.paletteQuery)}" placeholder="Where do you want to go?" aria-label="Magic jump box search" data-palette-input="1" />
        <button type="button" class="rx-btn is-on" style="height:40px" data-action="open-rx" data-id="palette" data-arg="the jump box" title="Regex builder for the jump box">.*</button>
      </div>
      <div class="palette-dialog__list">
        ${items.length ? items.map((p, i) => `<button type="button" class="palette-item" data-action="run-palette-item" data-id="${i}"><span class="palette-item__icon" aria-hidden="true">${p.icon}</span><span class="palette-item__label">${esc(p.label)}</span><span class="palette-item__hint">${esc(p.hint)}</span></button>`).join('') : `<div style="padding:26px;text-align:center;color:var(--faint)">Nothing found — try fewer letters, or the <strong>.*</strong> button.</div>`}
      </div>
    </div>
  </div>`
}

function renderConfirm(store) {
  const s = store.state
  if (!s.confirm) return ''
  const pickedIds = Object.keys(s.picked)
  const ready = s.confirmTyped.trim().toLowerCase() === s.confirm.word.toLowerCase()
  return `<div class="dialog-scrim is-center">
    <div class="confirm-dialog" role="alertdialog" aria-label="Are you sure?" data-stop-menu-close="1">
      <h3>🛑 ${esc(s.confirm.title)}</h3>
      <p>${esc(s.confirm.body)}</p>
      <pre class="confirm-preview">${esc(store.confirmPreviewCache || '')}</pre>
      <label>Type <strong class="confirm-word">${esc(s.confirm.word)}</strong> to unlock the button</label>
      <input data-bind="confirmTyped" data-focus-id="confirmTyped" value="${attr(s.confirmTyped)}" aria-label="Confirmation word" />
      <div class="confirm-actions">
        <button type="button" class="btn-plain" data-action="confirm-cancel">Keep it</button>
        <button type="button" class="confirm-run ${ready ? 'is-ready' : ''}" data-action="confirm-run">${ready ? 'Yes, do it' : 'Type “' + esc(s.confirm.word) + '” first'}</button>
      </div>
    </div>
  </div>`
}

function renderToasts(store) {
  const s = store.state
  if (!s.toasts.length) return ''
  return `<div class="toast-stack">
    ${s.toasts
      .map(
        (t) => `<div role="status" class="toast">
      <div class="toast__row">
        <span class="toast__icon" aria-hidden="true">${t.icon}</span>
        <div style="flex:1;min-width:0">
          <div class="toast__title">${esc(t.title)}</div>
          <div class="toast__body">${esc(t.body)}</div>
          ${t.sub ? `<div class="toast__sub">${esc(t.sub)}</div>` : ''}
        </div>
        <button type="button" class="toast__close" data-action="dismiss-toast" data-id="${attr(t.id)}" aria-label="Close this message">✕</button>
      </div>
    </div>`,
      )
      .join('')}
  </div>`
}

export function render(store) {
  const s = store.state
  const body = s.view === 'hall' ? renderHall(store) : renderRoom(store)
  return body + renderMenu(store) + renderRx(store) + renderPalette(store) + renderConfirm(store) + renderToasts(store)
}
