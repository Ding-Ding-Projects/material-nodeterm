import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'

const here = dirname(fileURLToPath(import.meta.url))
const workflows = join(here, '..', '.github', 'workflows')

function bashExecutable() {
  if (process.platform !== 'win32') return 'bash'
  const candidates = [
    process.env.NODETERM_GIT_BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe'
  ].filter(Boolean)
  const executable = candidates.find(
    (candidate) => existsSync(candidate) && /\\Git\\(?:bin|usr)\\bash\.exe$/i.test(candidate)
  )
  if (!executable) throw new Error('Git Bash is required for workflow shell syntax checks on Windows')
  return executable
}

/**
 * Every `run:` block that bash will execute must at least PARSE — in EVERY workflow.
 *
 * This exists because it did not. On 2026-08-18 the release step "Verify draft and publish once"
 * carried an `if ...; then` whose body was empty before its `elif` — a syntax error in POSIX
 * shell. Nothing local caught it: the YAML is valid, the file type-checks nothing, and actionlint
 * on Windows hangs when its shellcheck integration is enabled. So the first thing that noticed was
 * a failed release, and it failed once per push to main, stranding a draft release each time.
 *
 * `scripts/check-release-workflow.mjs` already parses release.yml as part of its semantic
 * contract, and that is the right home for anything release-SPECIFIC. This file is deliberately
 * the BREADTH pass instead: ci.yml, pages.yml and security.yml had no shell check of any kind,
 * and the defect above was not release-shaped — it was bash-shaped, so any workflow could have
 * carried it.
 *
 * It also substitutes `${{ ... }}` before parsing, which the release checker does not need to:
 * a GitHub expression is replaced before bash ever sees the script, so an expression containing
 * a quote or a parenthesis would otherwise be reported as a syntax error that cannot happen on a
 * runner.
 *
 * A parse check is cheap and total. It cannot judge whether the script is CORRECT — only that the
 * shell can read it — which is exactly the class of defect that otherwise costs a whole packaging
 * build to discover. The semantic half stays with the release checker, and on this same edit the
 * two guards caught different halves of one mistake.
 */
function shellScripts() {
  const found = []
  for (const file of readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))) {
    const doc = yaml.load(readFileSync(join(workflows, file), 'utf8'))
    const defaultShell = doc?.defaults?.run?.shell
    for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
      const jobShell = job?.defaults?.run?.shell ?? defaultShell
      for (const [index, step] of (job?.steps ?? []).entries()) {
        if (typeof step?.run !== 'string') continue
        const shell = step.shell ?? jobShell
        // Only bash-family steps. A pwsh or cmd step is a different grammar entirely, and
        // handing it to `bash -n` would invent failures rather than find them.
        if (shell && !/^(bash|sh)\b/.test(shell)) continue
        found.push({
          where: `${file} :: ${jobName} :: step ${index}${step.name ? ` (${step.name})` : ''}`,
          script: step.run
        })
      }
    }
  }
  return found
}

// `${{ ... }}` is a GitHub expression, not shell. It is substituted before bash ever sees the
// script, so for a parse check it becomes an ordinary word. Anything else would make the checker
// report failures that cannot happen on a runner.
const stripExpressions = (script) => script.replace(/\$\{\{[\s\S]*?\}\}/g, 'GH_EXPR')

describe('workflow shell steps parse', () => {
  const scripts = shellScripts()
  const bash = bashExecutable()

  it('finds the bash steps at all', () => {
    // A checker that silently found nothing would pass forever while checking nothing — the
    // exact failure this repository has written down more than once.
    expect(scripts.length).toBeGreaterThan(5)
  })

  it.each(scripts.map((s) => [s.where, s.script]))('%s', (_where, script) => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-syntax-'))
    const path = join(dir, 'step.sh')
    try {
      writeFileSync(path, stripExpressions(script))
      execFileSync(bash, ['-n', path], { encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      throw new Error(`shell syntax error:\n${err.stderr || err.message}`)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})
