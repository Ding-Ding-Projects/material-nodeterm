# Upstream v0.4.1 port, closeout prompt

Objective: port the canonical upstream (`eneskirca/nodeterm`, pin `9d5572e2`, `v0.4.1-12`) into this public fork (`Ding-Ding-Projects/material-nodeterm`) in themed tranches, every ported surface re-expressed on this fork's Material 3 primitives and tokens, no fork-only feature lost. Standing instruction from the maintainer: keep landing on `main`.

Landed and proven on the remote: tranche 0 (`21b5799b`, `69b4db92e`) and tranche 1 (`faa6a90b9`, `8ad74dd47`). Tranche 1 ported six upstream security commits (`1bf6fadb`, `60714074`, `fee5b244`, `23a7282b`, `9fa879d0`, the applicable part of `2d3e54cb`), skipped thirteen whose feature this fork lacks, and recorded four prerequisite chains as follow-up lanes in `docs/features/development/upstream-sync.md`. Verified on the merged tree under Node 24.19.0: typecheck zero errors; the focused suites 170 files / 2,434 tests green; every source check green except the known design-reference parity row. Not verified: the full suite on the merged tree, built-app interaction, packaged Windows captures.

In flight: tranche 2 on four lanes, `port/upstream-t2-watchlink`, `port/upstream-t2-github`, `port/upstream-t2-usage`, `port/upstream-t2-ssh`, each a linked worktree branched from `main` at `8ad74dd47`, each ported through the Material 3 adaptation checklist (primitives, tokens, audit rows, article, localized copy, personal vocabulary, changelog). Shared hot files are hand-edited per lane and reconciled at merge.

Lanes already integrated and safe to clean up after an ancestry proof: `port/upstream-v0.4.1-foundation`, `port/upstream-security-1`, `port/upstream-security-2`, `port/upstream-security-3` (all ancestors of the remote `main`). The maintainer's archive-before-delete rule cannot be met from the hosted container, so the deleting half of cleanup stops and reports its candidates.

Next safe steps: collect the four lane reports, review each diff, scan for private wording, run the gates on each lane tree, merge `--no-ff` into `main` one lane at a time, run the gates on the merged tree, push, prove with `git ls-remote`, comment on issue #225, tick the roadmap only when verified; then record the tranche waypoint as a real merge commit once the ported tree matches.

Blockers: the maintainer's status board is unreachable from the hosted container (live status lives on a separate page); GitHub Discussions and Projects need GraphQL, which this session's route refuses (REST issue comments instead).
