// No store may publish a file with a bare `fs.rename`.
//
// This exists because the defect it guards was invisible for the life of the project. Twenty-three
// files wrote temp-then-rename, which is correct on POSIX and silently lossy on Windows: the rename
// fails with EPERM whenever anything has the destination open, and the things that open a file we
// just wrote are Defender, the search indexer, OneDrive, and our own concurrent writers. See
// `fs-atomic.ts` for the full account.
//
// Nothing caught it. Every one of those files was reviewed, several were security-reviewed, and the
// only signal in the entire suite was one store's concurrency test — which had been failing on
// Windows for as long as the store existed and passing everywhere else. A reviewer reading any
// individual file sees a correct atomic write, because on the platform most of this was written on
// it IS one.
//
// So the rule is enforced by scan rather than by memory: a new store added next year gets the
// retry because this test refuses the alternative, not because its author had read this file.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOTS = ['core', 'main', 'server'].map((d) => join(__dirname, '..', d))

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      if (entry !== 'node_modules') sources(p, out)
    } else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(p)
    }
  }
  return out
}

/**
 * Files allowed to call `fs.rename` directly, each with the reason.
 *
 * Kept deliberately short. Every entry is a place the retry does not apply, not a place somebody
 * did not get round to — an exemption that means "later" belongs in an issue, not here.
 */
const ALLOWED = new Map<string, string>([
  ['core\\fs-atomic.ts', 'the helper itself; this is the one real rename']
])

describe('every store publishes through renameAtomic', () => {
  const files = ROOTS.flatMap((r) => sources(r))

  it('finds the source tree (a zero-file scan would pass silently)', () => {
    // The failure this whole file is about, one level up: a scan that matches nothing reports
    // clean. If a directory is renamed and this drops to nothing, it must go red, not quiet.
    expect(files.length).toBeGreaterThan(100)
  })

  // Every spelling of the call, because the first version of this test knew only `fs.rename(` and
  // went GREEN over eight real offenders — including `atomic-json-store.ts`, a file whose name is
  // the thing it was failing to do. A guard that matches one spelling of a hazard is worse than
  // none: it converts "nobody has checked" into "this has been checked", which is what stops the
  // next person looking.
  //
  //   fs.rename(…)            the namespace import
  //   renameSync(…)           the sync variant, on startup and hook-install paths
  //   rename(tmp, …)          destructured from 'node:fs/promises'
  //
  // `renameAtomic`/`renameAtomicSync` must not match, hence the trailing `\s*\(` and the
  // preceding-character guards.
  const NS_CALL = /(?<![A-Za-z0-9_$.])(fs|fsPromises|fsp)\.rename\s*\(/
  const BARE_CALL = /(?<![A-Za-z0-9_$.])rename\s*\(/
  const BARE_SYNC_CALL = /(?<![A-Za-z0-9_$.])renameSync\s*\(/

  /** Does this file import `name` from a filesystem module?
   *
   *  This qualifier is what makes the bare-name needles usable. Without it, `rename(` matches any
   *  method called `rename` — and this app has several perfectly innocent ones: the kids-mode and
   *  School-mode stores rename their own display name, the Ollama chat store renames a chat. The
   *  first version of this test flagged all three. A guard that cries wolf is a guard somebody
   *  deletes, so it may only fire on a name the file actually imported from `fs`. */
  function importsFromFs(text: string, name: string): boolean {
    const imports = text.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g)
    for (const [, members, mod] of imports) {
      if (!/^(node:)?fs(\/promises)?$/.test(mod)) continue
      if (new RegExp(`(^|[,{\\s])${name}(\\s*,|\\s*$|\\s)`).test(members.replace(/\n/g, ' ')))
        return true
    }
    return false
  }

  it('no bare rename, in ANY spelling, outside the helper', () => {
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      // Strip comments first: several files legitimately DISCUSS rename in the prose explaining
      // why they no longer call one, and flagging those teaches people to delete the explanation.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        // An import naming `rename`/`renameSync` is not a call, and the migrated files keep other
        // members from the same import.
        .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]/g, '')
      const rel = f.slice(f.indexOf('src') + 4)
      if ([...ALLOWED.keys()].some((k) => rel.endsWith(k))) continue
      const hits: string[] = []
      if (NS_CALL.test(code)) hits.push('fs.rename(')
      if (importsFromFs(text, 'renameSync') && BARE_SYNC_CALL.test(code)) hits.push('renameSync(')
      if (importsFromFs(text, 'rename') && BARE_CALL.test(code))
        hits.push('bare rename( — destructured from fs')
      if (hits.length) offenders.push(`${rel}  [${hits.join(', ')}]`)
    }
    expect(
      offenders,
      'these publish a file with a bare rename, which loses the write on Windows whenever the ' +
        'destination is momentarily open — use renameAtomic/renameAtomicSync from core/fs-atomic.ts'
    ).toEqual([])
  })

  it('the guard would actually catch each spelling', () => {
    // Proving the needles bite, on strings rather than by breaking real files.
    expect(NS_CALL.test('await fs.rename(a, b)')).toBe(true)
    expect(BARE_SYNC_CALL.test('renameSync(tmp, file)')).toBe(true)
    expect(BARE_CALL.test('await rename(tmp, this.file)')).toBe(true)
    // …and that the replacements do NOT trip it. `renameAtomic` contains `rename`, so this is the
    // assertion standing between the guard and flagging every file it just fixed.
    expect(NS_CALL.test('await renameAtomic(a, b)')).toBe(false)
    expect(BARE_SYNC_CALL.test('renameAtomicSync(tmp, file)')).toBe(false)
    expect(BARE_CALL.test('await renameAtomic(tmp, this.file)')).toBe(false)
    expect(BARE_CALL.test('await renameAtomicSync(tmp, f)')).toBe(false)
  })

  it('the fs-import qualifier separates a real rename from a method called rename', () => {
    // The false positives that made this necessary were all real: kids-mode, School-mode and the
    // Ollama chat store each expose a `rename()` of their own.
    const fsImport = "import { mkdir, rename, writeFile } from 'node:fs/promises'"
    expect(importsFromFs(fsImport, 'rename')).toBe(true)
    expect(importsFromFs("import { renameSync } from 'fs'", 'renameSync')).toBe(true)
    expect(importsFromFs("import { mkdir, writeFile } from 'node:fs/promises'", 'rename')).toBe(false)
    // Not from fs at all — a store's own method, or a helper of the same name.
    expect(importsFromFs("import { rename } from './my-store'", 'rename')).toBe(false)
    // Must not be satisfied by a longer member that merely contains the name.
    expect(importsFromFs("import { renameAtomic } from './fs-atomic'", 'rename')).toBe(false)
    expect(importsFromFs("import { renameSync } from 'fs'", 'rename')).toBe(false)
  })
})
