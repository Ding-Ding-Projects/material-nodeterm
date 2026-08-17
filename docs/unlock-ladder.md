# The unlock ladder

Too many wrong credentials from one TCP peer lock that peer's login path. Rather than leave someone
watching a countdown, the lockout screen offers a way to play out of it:

| Rung | What it asks | Fail |
| --- | --- | --- |
| **Dim sum** | One dish named in Chinese, four English names to pick from | 5 wrong dishes → maths |
| **Maths** | Ten easy sums, all of which must be right | 1 wrong sum → whack-a-mole |
| **Whack-a-mole** | Hit 8 of 14 moles in a 15-second round | lose → serve the clock |

Clear any rung and the wait is over. Lose the lot and you are exactly where you started — waiting —
and the ladder is not offered again for that lockout. It can only improve a locked-out afternoon.

**Where it lives.** `src/core/unlock-ladder.ts` is the whole state machine, Electron-free, so both
shells can drive it. The Server Edition serves it at `/auth/unlock/challenge` and
`/auth/unlock/verify`, and `lockedPage()` in `src/server/http.ts` draws it. Tests:
`src/core/unlock-ladder.test.ts` (the machine), `src/server/auth.test.ts` (shared account budgets and
lease deletion), and `src/server/unlock-ladder-routes.test.ts` (the boundary, over real HTTP).

## What it must never do

These are the whole safety of the feature. An implementation that keeps the games and drops any
one of them has built a second, much weaker password.

1. **It clears the WAITING, never the CREDENTIAL.** Winning signs nobody in, mints no session and
   sets no cookie — the user lands back on the ordinary password form and still has to know the
   password. `clearLockoutByLadder()` never changes the failure count, escalation streak,
   credentials, or sessions; it only ends the wait and advances stale-proof bookkeeping. The route
   test asserts no `Set-Cookie`.
2. **It never refunds the attempt budget.** Serving the clock returns five attempts, so the ladder
   returns five. The moment solving beats waiting, brute force gets cheaper — the one thing a
   lockout exists to prevent.
3. **It is budgeted, because a machine can play it.** Four choices is one-in-four, ten small sums
   are trivial to compute, and a mole schedule is arithmetic. So the ladder skips at most
   `LADDER_BUDGET` (3) waits per rolling hour, after which the clock is the only way through for
   everyone. **This cap is the real defence, not the difficulty of the games.**
4. **It never slows the escalation it skips.** The lockout itself now doubles per consecutive
   lockout (60 s → 2 m → 4 m …, capped at an hour — `nextLockoutMs`), and clearing the ladder
   leaves that streak untouched. Spend the whole budget and you still meet an exponential wall.
5. **Every answer is generated and graded server-side against a single-use nonce.** A ladder graded
   in the browser is a ladder skipped with one `fetch`. All sibling nonces are consumed *before*
   grading, so an old answer cannot cross a rung transition and no right answer can be replayed.
   Challenges expire after `LADDER_TTL_MS`.

Each locked TCP peer owns an independent climb: a reset, failure or correct answer on one peer cannot
consume another peer's nonce or change its rung. Those climbs share one `UnlockLadderBudget`, so
distributing failures does not multiply the three-clear rolling budget. The budget slot is claimed
again atomically when an answer is graded; challenges issued concurrently while one slot remained
cannot all clear it.

Live ladder nonces are capped at eight per peer and 256 for the account. A globally full ledger
refuses refreshes even from an existing holder until a nonce is consumed or expires, so no holder
can extend its lease before TTL; after expiry every peer competes afresh for capacity. Grading one
answer consumes every sibling nonce for that climb: an answer saved before a later rung or an
exhausted whack round can never clear afterward.

Two rules that are easy to miss and cost the whole rung when they are:

- **A timed game cannot be won faster than it lasts.** A whack-a-mole submission arriving before
  `WHACK_DURATION_MS` has actually elapsed is rejected — otherwise a script returns a perfect score
  the instant it receives the schedule and rung 3 costs nothing.
- **Each mole grades once.** A hit counts only against a mole genuinely visible, in that cell, at
  that moment, and each mole can be hit once. Without that, "hit the moles" degrades into "send
  enough taps"; the on-screen score is encouragement only and is regraded server-side.

## School mode

School mode requires every dim-sum capability to behave as though it is not installed, and rung 1
is a dim-sum question. So under School mode **the ladder starts at the maths** — the dim-sum rung is
*absent*, not skipped with a message, because a message naming the hidden thing is exactly what
School mode forbids. `firstRung()` is the single place that decides, and `issue('dimsum')` still
returns a maths challenge under the mode, so no caller can route around it.

The mode is read through a closure (`auth.setSchoolModeSource`) rather than sampled at boot: it is
a live, shared switch an already-running app must pick up without a restart.

## Surfaces

| Surface | State |
| --- | --- |
| **Server Edition** | Full. It is the only surface with password auth, so it is the only one that can lock anyone out. |
| **Desktop** | N/A — the Electron app has no password gate to be locked out of. |
| **Pages site** | N/A — its toy locks (`site/app/shared/locks-state.js`) have no lockout at all; a wrong password simply returns `false` with unlimited retries, so there is no wait to skip. If a lockout is ever added there, it owes the ladder. |
| **Mobile companion** | Follow-up in `nodeterm-ios`. It authenticates against a paired host rather than a password of its own. |

## The dim sum names

Rung 1 quizzes on `src/shared/dimsum-names.ts` — the same nine dishes the renderer's dim-sum
surprise draws. The names live in `src/shared` and the illustrations stay in
`src/renderer/lib/dimsum/catalog.ts`, which derives its catalog from them: the server has no Vite
asset pipeline and needs only the names, and a second hand-copied list of dishes is a list that
drifts. A dish added without an illustration is dropped from the renderer catalog rather than
rendering a broken image.

## Testing it by hand

Run the Server Edition, get the password wrong five times, and the lockout screen appears with
**Play your way out**. To reach the lower rungs quickly, answer the dim sum wrong five times, then
answer one sum wrong. To see the budget refuse, clear the ladder three times inside an hour.
