// site/app/shared/games.js
//
// Pure game logic for the Playroom's three games: memory pairs, dumpling
// maths, and whack-a-block. Kept free of any DOM/state-store coupling so
// it is independently testable in principle; app/features/playroom.js
// wires it to the shared store and the renderer.

import { DISHES } from './data.js'

const MEM_FACES = ['🖥', '🤖', '🥟', '🚪', '🎨', '🔔', '🧩', '⏰']

export function dealMemory() {
  const deck = MEM_FACES.concat(MEM_FACES)
    .map((f, i) => ({ i, f }))
    .sort(() => Math.random() - 0.5)
  return { memDeck: deck, memUp: [], memDone: [], memMoves: 0, memBusy: false }
}

export function newQuiz() {
  const n = 2 + Math.floor(Math.random() * 6)
  const m = 1 + Math.floor(Math.random() * 5)
  const plus = Math.random() < 0.6
  const answer = plus ? n + m : Math.max(n, m) - Math.min(n, m)
  const opts = new Set([answer])
  while (opts.size < 4) opts.add(Math.max(0, answer + (Math.floor(Math.random() * 7) - 3)))
  return {
    quizN: n,
    quizM: m,
    quizPlus: plus,
    quizAnswer: answer,
    quizOpts: Array.from(opts).sort(() => Math.random() - 0.5),
    quizPicked: null,
    quizDish: DISHES[Math.floor(Math.random() * DISHES.length)].en,
  }
}

export function whackReset() {
  return { whackScore: 0, whackLeft: 20, whackAt: Math.floor(Math.random() * 9), whackRun: true }
}
export function whackNextHole() {
  return Math.floor(Math.random() * 9)
}
