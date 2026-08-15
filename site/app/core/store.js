// site/app/core/store.js
//
// The whole app is one state object plus one render function — the same
// shape the imported design used (a single React-style component whose
// renderVals() computed everything from `state`). Vanilla-JS version of
// the same idea: setState(patch) mutates `state`, persists the durable
// slice to localStorage, and schedules a re-render. See app/core/dom.js
// for the focus-preserving re-render wrapper.

const STORAGE_KEY = 'nodeterm-playground.v1'

const PERSISTED_KEYS = [
  'theme', 'lang', 'funnyEn', 'funnyYue', 'emoji', 'bigText', 'sound', 'accent', 'nick', 'logo', 'preset',
  'locks', 'notes', 'history', 'auth', 'school', 'schoolPin', 'narrate', 'voice', 'rate', 'vocab',
  'schedOn', 'schedTime', 'schedTheme', 'bestMem', 'bestQuiz', 'bestWhack',
]

function nowIso() {
  return new Date().toISOString()
}

function defaultNotes() {
  return [
    { id: 'n1', title: 'Welcome aboard', body: 'Everything you change here is saved in this browser only. Nothing is ever sent anywhere.', when: nowIso(), tag: 'hello' },
    { id: 'n2', title: 'Try a right-click', body: 'Almost anything on this page has its own menu — and every menu has its own little search box.', when: nowIso(), tag: 'tip' },
    { id: 'n3', title: 'Every search has a .* button', body: 'Press it to build a pattern out of coloured blocks instead of typing one from memory.', when: nowIso(), tag: 'tip' },
  ]
}
function defaultHistory() {
  return [{ id: 'h0', title: 'First visit', body: 'Default settings created.', when: nowIso(), tag: 'start' }]
}

export function createStore() {
  const state = {
    view: 'hall', // 'hall' | 'room'
    opening: null, knock: null,
    sec: 'home',
    qGlobal: '', qNav: '', qSec: '',
    rxOn: {}, rxPat: {}, rxFlags: {},
    rxOpen: false, rxTarget: null, rxSample: 'har gow 4 pieces\nsiu mai 3 pieces\ndan tat 2 pieces',
    menuOpen: false, menuX: 0, menuY: 0, menuKind: '', menuLabel: '', menuQuery: '', menuExtra: null,
    paletteOpen: false, paletteQuery: '',
    picked: {}, cart: {},
    notes: defaultNotes(), history: defaultHistory(), toasts: [], auth: [], codes: {},
    dateFrom: '', dateTo: '',
    addA: '', addB: '',
    convFrom: 'json', convTo: 'yaml', convIn: '[{"dish":"har gow","pieces":4},{"dish":"dan tat","pieces":2}]', convOut: '',
    convNote: 'Pick a shape and press Convert.', convBad: false,
    dataset: 'settings', lossPending: null, lossNote: 'Green shapes carry everything. Orange shapes lose something, and will tell you what.', lossBad: false,
    confirm: null, confirmTyped: '',
    unlockVals: {}, unlocked: {}, locks: {},
    theme: 'day', lang: 'en', funnyEn: 2, funnyYue: 3, emoji: true, bigText: false, sound: false,
    accent: '#ffd93d', nick: '', logo: '', preset: 'playground',
    school: false, schoolPin: '',
    narrate: false, voice: '', rate: 3,
    vocab: '',
    schedOn: false, schedTime: '19:00', schedTheme: 'night',
    voices: [], dishIdx: 0,
    memDeck: [], memUp: [], memDone: [], memMoves: 0, memBusy: false,
    quizN: 3, quizM: 2, quizPlus: true, quizAnswer: 5, quizOpts: [5, 4, 6, 7], quizPicked: null, quizScore: 0, quizDish: 'Har gow',
    whackScore: 0, whackLeft: 0, whackAt: -1, whackRun: false,
    bestMem: 0, bestQuiz: 0, bestWhack: 0,
  }

  let saved = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch (_err) {
    saved = {}
  }
  PERSISTED_KEYS.forEach((k) => {
    if (saved[k] !== undefined) state[k] = saved[k]
  })
  if (!state.notes || !state.notes.length) state.notes = defaultNotes()
  if (!state.history || !state.history.length) state.history = defaultHistory()
  if (!state.auth) state.auth = []

  const listeners = []
  let renderScheduled = false

  function persist() {
    const blob = {}
    PERSISTED_KEYS.forEach((k) => (blob[k] = state[k]))
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blob))
    } catch (_err) {
      /* storage unavailable (private mode, quota) — state still works for this visit */
    }
  }

  function scheduleRender() {
    if (renderScheduled) return
    renderScheduled = true
    Promise.resolve().then(() => {
      renderScheduled = false
      listeners.forEach((fn) => fn(state))
    })
  }

  function setState(patch, opts) {
    const p = typeof patch === 'function' ? patch(state) : patch
    Object.assign(state, p)
    if (opts?.persist !== false && Object.keys(p).some((k) => PERSISTED_KEYS.includes(k))) persist()
    scheduleRender()
  }

  return {
    state,
    setState,
    subscribe(fn) {
      listeners.push(fn)
    },
    persist,
  }
}

// A generic plain-text-or-regex matcher factory, shared by every search
// surface (the big search, the room-filter, every room's own search, every
// context menu filter, the command palette). `key` selects which of
// state.rxOn/rxPat/rxFlags this particular field owns.
export function makeMatcher(state, key, query) {
  const q = (query || '').trim()
  if (!q) return () => true
  if (state.rxOn[key]) {
    try {
      const flags = (state.rxFlags[key] || 'i').replace(/[^gimsuy]/g, '') || 'i'
      const re = new RegExp(q.slice(0, 200), flags)
      return (t) => {
        try {
          // `g` and `y` make RegExp.test() advance lastIndex. A search predicate must be pure:
          // asking about the same row twice cannot alternate true/false because another row ran
          // first. Reset for every candidate while preserving the flags the user explicitly chose.
          re.lastIndex = 0
          return re.test(String(t))
        } catch (_err) {
          return true
        }
      }
    } catch (_err) {
      return () => true
    }
  }
  const low = q.toLowerCase()
  return (t) => String(t).toLowerCase().includes(low)
}
