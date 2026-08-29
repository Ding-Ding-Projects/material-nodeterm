#!/usr/bin/env node
/**
 * Synchronize the public shared-instruction block in AGENTS.md and CLAUDE.md.
 *
 * The private vocabulary dictionary deliberately does not live in this public
 * repository. The caller must first produce ordinary public Markdown through
 * the canonical private exporter, review remaining machine-specific prose, and
 * then pass the sanitized body on standard input. This script owns only the
 * public block boundary, exact target parity, and public-detail validation.
 *
 * Usage:
 *   node scripts/sync-agent-instruction-mirror.mjs --check
 *   <sanitized.md node scripts/sync-agent-instruction-mirror.mjs --write
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { renameAtomicSync } from './lib/rename-atomic.mjs'

export const MANAGED_BEGIN = '<!-- codingmachineedge/agent-global-memory-public:begin -->'
export const MANAGED_END = '<!-- codingmachineedge/agent-global-memory-public:end -->'
export const MANAGED_FILES = Object.freeze(['AGENTS.md', 'CLAUDE.md'])

export const REQUIRED_PUBLIC_SECTIONS = Object.freeze([
  '## Sanitized shared instruction mirror',
  '### Scope and precedence',
  '### Repository and session discipline',
  '### Git and GitHub delivery',
  '### Security and sensitive input',
  '### Verification and evidence',
  '### Documentation and public surfaces',
  '### Continuous integration and releases',
  '### User-facing language and accessibility',
  '### Interface behavior and customization',
  '### Navigation, search, and productivity',
  '### Local data, exports, and history',
  '### Build and dependency management',
  '### Working methods and recurring failure modes',
  '### Publication boundary',
])

const PUBLIC_DETAIL_PATTERNS = Object.freeze([
  {
    reason: 'IP address literal',
    matcher: /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu,
    allowed: (value) => value === '0.0.0.0' || value.startsWith('127.'),
  },
  {
    reason: 'Windows user-profile path',
    matcher: /[A-Za-z]:\\Users\\[^\\\s"'`<>|)\]]+/gu,
    allowed: (value) => /%[A-Za-z_]+%$/u.test(value),
  },
  {
    reason: 'POSIX home directory naming a user',
    matcher: /(?:\/home|\/Users)\/[A-Za-z][A-Za-z0-9._-]*/gu,
    allowed: (value) => /\/(?:you|user|username|yourname|example)$/iu.test(value),
  },
  {
    reason: 'literal SSH target',
    matcher: /\bssh\s+(?:-\w+\s+)*[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/gu,
    allowed: () => false,
  },
  {
    reason: 'credential-shaped value',
    matcher: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/gu,
    allowed: () => false,
  },
])

const normalizeNewlines = (value) => value.replace(/\r\n|\r/gu, '\n')

export function extractManagedBody(text, file = '<text>') {
  const normalized = normalizeNewlines(text)
  const beginCount = normalized.split(MANAGED_BEGIN).length - 1
  const endCount = normalized.split(MANAGED_END).length - 1
  if (beginCount !== 1 || endCount !== 1) {
    throw new Error(`${file} must contain exactly one complete managed instruction block`)
  }
  const begin = normalized.indexOf(MANAGED_BEGIN)
  const end = normalized.indexOf(MANAGED_END)
  if (end < begin) throw new Error(`${file} has reversed managed instruction markers`)
  const body = normalized.slice(begin + MANAGED_BEGIN.length, end).replace(/^\n|\n$/gu, '')
  return body
}

export function validateManagedBody(body) {
  const normalized = normalizeNewlines(body).trim()
  const problems = []
  if (!normalized) problems.push('managed instruction body is empty')
  if (normalized.includes(MANAGED_BEGIN) || normalized.includes(MANAGED_END)) {
    problems.push('managed instruction body contains nested markers')
  }
  for (const section of REQUIRED_PUBLIC_SECTIONS) {
    if (!normalized.includes(section)) problems.push(`required public section is missing: ${section}`)
  }
  const lines = normalized.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    for (const { reason, matcher, allowed } of PUBLIC_DETAIL_PATTERNS) {
      matcher.lastIndex = 0
      let match
      while ((match = matcher.exec(lines[index])) !== null) {
        if (!allowed(match[0])) problems.push(`${reason} at managed line ${index + 1}: ${match[0]}`)
      }
    }
  }
  return problems
}

export async function loadCanonicalVocabularyValidator(repoRoot) {
  const roots = [
    process.env.AGENT_GLOBAL_MEMORY_ROOT,
    path.resolve(repoRoot, '..', 'agent-global-memory'),
    path.join(homedir(), 'Documents', 'GitHub', 'agent-global-memory'),
  ].filter(Boolean)
  for (const root of [...new Set(roots.map((candidate) => path.resolve(candidate)))]) {
    const modulePath = path.join(root, 'scripts', 'private-vocabulary-markdown.mjs')
    if (!existsSync(modulePath)) continue
    const module = await import(pathToFileURL(modulePath).href)
    if (typeof module.findPrivateVocabularyLeak !== 'function') continue
    return {
      root,
      validate: (body) => module.findPrivateVocabularyLeak(body),
    }
  }
  return null
}

export function checkManagedInstructionMirror(repoRoot) {
  const problems = []
  const bodies = new Map()
  for (const file of MANAGED_FILES) {
    const absolute = path.join(repoRoot, file)
    if (!existsSync(absolute)) {
      problems.push(`${file} does not exist`)
      continue
    }
    try {
      const body = extractManagedBody(readFileSync(absolute, 'utf8'), file)
      bodies.set(file, body)
      problems.push(...validateManagedBody(body).map((problem) => `${file}: ${problem}`))
    } catch (error) {
      problems.push(error.message)
    }
  }
  if (bodies.size === MANAGED_FILES.length) {
    const [first, ...rest] = [...bodies.entries()]
    for (const [file, body] of rest) {
      if (body !== first[1]) problems.push(`${file} managed body differs from ${first[0]}`)
    }
  }
  return { problems, bodies }
}

export function replaceManagedBody(text, body) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const normalizedBody = normalizeNewlines(body).trim().replaceAll('\n', newline)
  const block = `${MANAGED_BEGIN}${newline}${normalizedBody}${newline}${MANAGED_END}`
  const normalized = normalizeNewlines(text)
  const beginCount = normalized.split(MANAGED_BEGIN).length - 1
  const endCount = normalized.split(MANAGED_END).length - 1
  if (beginCount === 0 && endCount === 0) return `${text.replace(/\s*$/u, '')}${newline}${newline}${block}${newline}`
  if (beginCount !== 1 || endCount !== 1) throw new Error('target contains incomplete or duplicate managed markers')
  const begin = text.indexOf(MANAGED_BEGIN)
  const end = text.indexOf(MANAGED_END)
  if (end < begin) throw new Error('target contains reversed managed markers')
  return `${text.slice(0, begin)}${block}${text.slice(end + MANAGED_END.length)}`
}

export function writeManagedInstructionMirror(repoRoot, body, options = {}) {
  const bodyProblems = validateManagedBody(body)
  if (bodyProblems.length > 0) throw new Error(bodyProblems.join('\n'))
  if (typeof options.privateVocabularyValidator !== 'function') {
    throw new Error('A canonical private-vocabulary validator is required before writing the public mirror')
  }
  const vocabularyLeaks = options.privateVocabularyValidator(body)
  if (vocabularyLeaks.length > 0) {
    throw new Error(`Managed instruction body contains private vocabulary: ${vocabularyLeaks.join(', ')}`)
  }

  const originals = new Map()
  const replacements = new Map()
  for (const file of MANAGED_FILES) {
    const absolute = path.join(repoRoot, file)
    const original = readFileSync(absolute, 'utf8')
    originals.set(file, original)
    replacements.set(file, replaceManagedBody(original, body))
  }

  const staged = []
  try {
    for (const [file, replacement] of replacements) {
      const absolute = path.join(repoRoot, file)
      const temporary = `${absolute}.instruction-mirror-${process.pid}-${Date.now()}-${randomUUID()}.tmp`
      writeFileSync(temporary, replacement, 'utf8')
      staged.push({ file, absolute, temporary })
    }
    const publishRename = options.publishRename ?? renameAtomicSync
    for (const entry of staged) publishRename(entry.temporary, entry.absolute)
  } catch (error) {
    for (const entry of staged) {
      if (existsSync(entry.temporary)) unlinkSync(entry.temporary)
    }
    for (const [file, original] of originals) {
      const absolute = path.join(repoRoot, file)
      if (readFileSync(absolute, 'utf8') === original) continue
      const temporary = `${absolute}.instruction-mirror-rollback-${process.pid}-${Date.now()}-${randomUUID()}.tmp`
      writeFileSync(temporary, original, 'utf8')
      renameAtomicSync(temporary, absolute)
    }
    throw error
  }
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.join(here, '..')
  const canonical = await loadCanonicalVocabularyValidator(repoRoot)
  if (process.argv.includes('--check')) {
    const { problems } = checkManagedInstructionMirror(repoRoot)
    if (canonical) {
      const { bodies } = checkManagedInstructionMirror(repoRoot)
      for (const [file, body] of bodies) {
        const leaks = canonical.validate(body)
        if (leaks.length > 0) problems.push(`${file}: private vocabulary: ${leaks.join(', ')}`)
      }
    }
    if (problems.length > 0) {
      console.error(`sync-agent-instruction-mirror: FAILED (${problems.length} problem(s))`)
      for (const problem of problems) console.error(`  ${problem}`)
      process.exitCode = 1
      return
    }
    console.log('sync-agent-instruction-mirror: OK, AGENTS.md and CLAUDE.md contain one identical sanitized managed block.')
    if (!canonical) {
      console.warn('sync-agent-instruction-mirror: SKIP, canonical private-vocabulary source is unavailable; structural and public-detail checks passed, but vocabulary currentness was not verified.')
    }
    return
  }
  if (!process.argv.includes('--write')) {
    throw new Error('Usage: node scripts/sync-agent-instruction-mirror.mjs --check | --write < sanitized.md')
  }
  if (!canonical) {
    throw new Error('Cannot write the public mirror without the canonical private-vocabulary validator. Set AGENT_GLOBAL_MEMORY_ROOT or place the canonical checkout beside this repository.')
  }
  const body = readFileSync(0, 'utf8')
  writeManagedInstructionMirror(repoRoot, body, { privateVocabularyValidator: canonical.validate })
  const { problems } = checkManagedInstructionMirror(repoRoot)
  if (problems.length > 0) throw new Error(problems.join('\n'))
  console.log('sync-agent-instruction-mirror: updated AGENTS.md and CLAUDE.md with one identical sanitized managed block.')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) await main()
