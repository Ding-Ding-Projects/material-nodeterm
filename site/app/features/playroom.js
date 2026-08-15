// site/app/features/playroom.js
//
// The "Playroom" room: three small working games (memory pairs, dumpling
// maths, whack-a-block), each keeping score locally, with a best score
// persisted per game. Game rules are pure functions in
// app/shared/games.js; this module only wires them to the store and the
// renderer.

import { registerRoom } from '../core/engine.js'
import { dealMemory, newQuiz, whackReset, whackNextHole } from '../shared/games.js'
import { esc } from '../core/dom.js'

let whackTimer = null

export function registerPlayroom(store, deps, registerAction, registerBinding) {
  store.setState(dealMemory(), { persist: false })
  store.setState(newQuiz(), { persist: false })

  registerAction('mem-flip', (s, idxStr, el, h) => {
    const idx = Number(idxStr)
    const st = s.state
    if (st.memBusy || st.memUp.includes(idx) || st.memDone.includes(idx)) return
    const up = st.memUp.concat([idx])
    if (up.length < 2) {
      store.setState({ memUp: up }, { persist: false })
      return
    }
    const moves = st.memMoves + 1
    const a = st.memDeck[up[0]]
    const b = st.memDeck[up[1]]
    if (a.f === b.f) {
      const done = st.memDone.concat(up)
      store.setState({ memUp: [], memDone: done, memMoves: moves }, { persist: false })
      if (done.length === st.memDeck.length) {
        const best = !st.bestMem || moves < st.bestMem ? moves : st.bestMem
        h.save({ bestMem: best }, 'Finished memory pairs in ' + moves + ' turns')
        h.toast('🏆', 'All pairs found!', 'You did it in ' + moves + ' turns.' + (best === moves ? ' That is your best yet!' : ''))
      }
    } else {
      store.setState({ memUp: up, memMoves: moves, memBusy: true }, { persist: false })
      setTimeout(() => store.setState({ memUp: [], memBusy: false }, { persist: false }), 700)
    }
  })
  registerAction('mem-reset', () => store.setState(dealMemory(), { persist: false }))

  registerAction('quiz-pick', (s, idStr, el, h) => {
    const v = Number(idStr)
    const st = s.state
    if (st.quizPicked !== null) return
    if (v === st.quizAnswer) {
      const score = st.quizScore + 1
      const best = Math.max(score, st.bestQuiz || 0)
      store.setState({ quizPicked: v, quizScore: score }, { persist: false })
      h.save({ bestQuiz: best })
      setTimeout(() => store.setState(newQuiz(), { persist: false }), 900)
    } else {
      store.setState({ quizPicked: v, quizScore: 0 }, { persist: false })
    }
  })
  registerAction('quiz-next', () => store.setState(newQuiz(), { persist: false }))

  registerAction('whack-start', (s, id, el, h) => {
    if (whackTimer) {
      clearInterval(whackTimer)
      whackTimer = null
    }
    store.setState(whackReset(), { persist: false })
    whackTimer = setInterval(() => {
      const st = store.state
      if (st.whackLeft <= 1) {
        clearInterval(whackTimer)
        whackTimer = null
        const best = Math.max(st.whackScore, st.bestWhack || 0)
        h.save({ bestWhack: best }, 'Whack-a-block: ' + st.whackScore + ' hits')
        store.setState({ whackRun: false, whackLeft: 0, whackAt: -1 }, { persist: false })
        h.toast('⏱', 'Time!', 'You caught ' + st.whackScore + ' blocks.' + (best === st.whackScore && st.whackScore > 0 ? ' New best!' : ''))
        return
      }
      store.setState((s2) => ({ whackLeft: s2.whackLeft - 1, whackAt: whackNextHole() }), { persist: false })
    }, 900)
  })
  registerAction('whack-hit', (s, idxStr, el, h) => {
    const idx = Number(idxStr)
    const st = s.state
    if (!st.whackRun) {
      h.toast('👆', 'Press start first', 'The blocks only pop up while the timer runs.')
      return
    }
    if (idx !== st.whackAt) {
      store.setState({ whackScore: Math.max(0, st.whackScore - 1) }, { persist: false })
      return
    }
    store.setState({ whackScore: st.whackScore + 1, whackAt: whackNextHole() }, { persist: false })
  })

  registerAction('clear-scores', (s, id, el, h) =>
    h.askConfirm('Clear your best scores?', 'The three best scores go back to nothing. Your settings and messages are not touched.', 'scores', () => {
      h.save({ bestMem: 0, bestQuiz: 0, bestWhack: 0 }, 'Best scores cleared')
      h.toast('🏆', 'Cleared', 'Fresh start on all three games.')
    }),
  )

  registerRoom('play', { render: (storeArg) => renderPlayroom(storeArg.state) })
}

function renderPlayroom(s) {
  const memMsg = s.memDone.length === s.memDeck.length && s.memDeck.length ? '🎉 All pairs found! Press New game to shuffle again.' : 'Tap two cards. If they match they stay up.'
  const quizMsg = s.quizPicked === null ? 'How many dumplings are left on the plate?' : s.quizPicked === s.quizAnswer ? '✅ Correct! Here comes another.' : '❌ Not that one — the answer was ' + s.quizAnswer + '. Streak back to zero.'
  const quizDish = new Array(s.quizPlus ? s.quizN + s.quizM : s.quizN).fill('🥟').join('')
  const quizQuestion = s.quizPlus ? s.quizN + ' dumplings, then ' + s.quizM + ' more. How many?' : 'You had ' + Math.max(s.quizN, s.quizM) + ' and ate ' + Math.min(s.quizN, s.quizM) + '. How many left?'
  const whackMsg = s.whackRun ? '⏱ ' + s.whackLeft + ' seconds left — tap the block, not the empty holes!' : 'Twenty seconds. Every miss costs you one.'
  const bestLine = `Memory pairs: ${s.bestMem ? s.bestMem + ' turns' : 'not finished yet'} · Dumpling maths: ${s.bestQuiz || 0} in a row · Whack-a-block: ${s.bestWhack || 0} caught.`

  return `<div class="play-grid" style="animation:pop .2s ease">
    <section class="card play-card">
      <div class="play-card__head"><h3>🧠 Memory pairs</h3><span class="play-score" style="background:var(--yellow)">Turns: ${s.memMoves}${s.bestMem ? ' · best ' + s.bestMem : ''}</span></div>
      <p style="margin:6px 0 12px;font-size:13.5px;color:var(--ink2)">${esc(memMsg)}</p>
      <div class="mem-grid">
        ${s.memDeck
          .map((c, idx) => {
            const shown = s.memUp.includes(idx) || s.memDone.includes(idx)
            const cls = s.memDone.includes(idx) ? 'is-done' : shown ? 'is-up' : ''
            return `<button type="button" class="mem-card ${cls}" data-action="mem-flip" data-id="${idx}" aria-label="${shown ? 'Card showing ' + c.f : 'Face-down card'}">${shown ? c.f : '❓'}</button>`
          })
          .join('')}
      </div>
      <button type="button" class="btn" style="background:var(--green);margin-top:12px" data-action="mem-reset">🔄 New game</button>
    </section>

    <section class="card play-card">
      <div class="play-card__head"><h3>🥟 Dumpling maths</h3><span class="play-score" style="background:var(--pink)">Streak: ${s.quizScore}${s.bestQuiz ? ' · best ' + s.bestQuiz : ''}</span></div>
      <p style="margin:6px 0 10px;font-size:13.5px;color:var(--ink2)">${esc(quizMsg)}</p>
      <div class="quiz-box">${quizDish}</div>
      <div class="quiz-q">${esc(quizQuestion)}</div>
      <div class="quiz-opts">
        ${s.quizOpts
          .map((v) => {
            const cls = s.quizPicked === null ? '' : v === s.quizAnswer ? 'is-right' : s.quizPicked === v ? 'is-wrong' : ''
            return `<button type="button" class="quiz-opt ${cls}" data-action="quiz-pick" data-id="${v}">${v}</button>`
          })
          .join('')}
      </div>
      <button type="button" class="btn-plain" style="margin-top:12px;font-weight:800" data-action="quiz-next">Skip this one</button>
    </section>

    <section class="card play-card">
      <div class="play-card__head"><h3>⚡ Whack-a-block</h3><span class="play-score" style="background:var(--blue)">Caught: ${s.whackScore}${s.bestWhack ? ' · best ' + s.bestWhack : ''}</span></div>
      <p style="margin:6px 0 12px;font-size:13.5px;color:var(--ink2)">${esc(whackMsg)}</p>
      <div class="whack-grid">
        ${new Array(9)
          .fill(0)
          .map((_, i) => `<button type="button" class="whack-hole ${s.whackAt === i ? 'is-up' : ''}" data-action="whack-hit" data-id="${i}" aria-label="${s.whackAt === i ? 'A block popped up — tap it' : 'Empty hole'}">${s.whackAt === i ? '🟪' : ''}</button>`)
          .join('')}
      </div>
      <button type="button" class="btn" style="background:var(--orange);margin-top:12px" data-action="whack-start">${s.whackRun ? '⏱ ' + s.whackLeft + 's — playing…' : '▶ Start the timer'}</button>
    </section>

    <section class="card play-card best-panel">
      <h3 style="margin-bottom:6px;font-size:19px">🏆 Best scores</h3>
      <p style="margin:0 0 10px;font-size:13.5px;color:var(--ink2);line-height:1.6">${esc(bestLine)}</p>
      <button type="button" class="btn-plain" style="background:var(--red)" data-action="clear-scores">Clear my best scores</button>
    </section>
  </div>`
}
