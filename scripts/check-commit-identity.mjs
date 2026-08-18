#!/usr/bin/env node
/**
 * Refuse to push a commit whose author or committer address is a RESERVED, un-routable domain.
 *
 * Four commits reached `main` on 2026-08-17 authored and committed by `Smoke User
 * <smoke@example.invalid>` — a placeholder a harness left configured — carrying no
 * `Co-Authored-By` trailer. That is not cosmetic. The release line counter attributes a surviving
 * line to an agent when the author matches a known automation identity OR the body carries such a
 * trailer, and to a PERSON otherwise. So 104 insertions across 16 files are counted as
 * person-written in every future release, and `git blame` answers with an address that cannot
 * receive mail.
 *
 * DELIBERATELY NARROW. It matches only the domains RFC 2606 and RFC 6761 reserve so that they can
 * never resolve — `.invalid`, `.test`, `.example`, `.localhost`, and the `example.com/net/org`
 * documentation names. A real contributor's address cannot land in that set, which is what lets
 * this run on every push without ever having to guess whether a human is legitimate. It does NOT
 * enforce "one identity": this repository's history legitimately carries several real people, and
 * a check that demanded a single name would refuse their work.
 *
 * It also cannot repair what already shipped: those four commits are published, and rewriting them
 * means a force-push, which is a decision for whoever owns the branch and not for a hook.
 */
import { execFileSync } from 'node:child_process'
import { reservedAddress } from './reserved-identity.mjs'

const range = process.argv[2]
if (!range) {
  console.error('usage: check-commit-identity.mjs <rev-range>')
  process.exit(2)
}

let out = ''
try {
  out = execFileSync('git', ['log', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce', range], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  })
} catch {
  // An unreadable range is not evidence of a bad identity; say so rather than blocking a push on it.
  console.warn('commit identity: could not read the range, skipping')
  process.exit(0)
}

const bad = []
for (const line of out.split('\n')) {
  if (!line.trim()) continue
  const [sha, an, ae, cn, ce] = line.split('\u001f')
  if (reservedAddress(ae) || reservedAddress(ce)) bad.push({ sha, an, ae, cn, ce })
}

if (bad.length) {
  console.error('')
  console.error('  Refused: a commit carries a reserved, un-routable address.')
  console.error('')
  for (const c of bad) {
    console.error(`    ${c.sha.slice(0, 12)}  author ${c.an} <${c.ae}>  committer ${c.cn} <${c.ce}>`)
  }
  console.error('')
  console.error('  Those domains are reserved so they can never resolve, so this is a harness or')
  console.error('  placeholder identity rather than a person. Left alone it becomes the answer')
  console.error('  git blame gives, and the release line counter reads it as person-written work.')
  console.error('')
  console.error('  Fix the identity and amend, or rebase the range:')
  console.error('    git config user.name  "Claude Fable 5"')
  console.error('    git config user.email "noreply@anthropic.com"')
  console.error('    git commit --amend --reset-author --no-edit')
  console.error('')
  process.exit(1)
}
