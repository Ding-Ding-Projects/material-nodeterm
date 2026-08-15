// Pure path logic for the Explorer — "New File…" / "New Folder…" and reveal — kept out of the
// components so name validation and expansion targets are unit-testable. Names come from a user
// prompt; paths are `/`-separated (remote SSH paths included).
//
// One wrinkle the reveal helper below has to live with: on Windows the tree's ROOT is a native
// path (`C:\Users\me\proj`) while every level under it is composed as `${parent}/${name}`, so a
// real node path is legitimately MIXED — `C:\Users\me\proj/src/a.ts`. Windows accepts that for
// filesystem calls, so the tree works; but anything comparing or splitting those paths has to
// expect both separators.

/** The directory a create targets: the clicked dir itself, or the clicked file's parent. */
export function createTargetDir(path: string, isDir: boolean): string {
  return isDir ? path : parentDir(path)
}

export function parentDir(p: string): string {
  const i = p.replace(/\/+$/, '').lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/**
 * Validate a user-entered name and return it as `/`-separated segments, or null if it is unsafe.
 *
 * The paths this module deals in are `/`-separated by convention, but the NAME is typed by a
 * person — and on Windows a person types `sub\file.ts`, or `..\evil.txt`. The original check
 * split on '/' alone, so every backslash form sailed through: `..\evil.txt` was accepted and
 * produced `C:/proj/..\evil.txt`, which Windows resolves to `C:/evil.txt` — a file created
 * OUTSIDE the project, by the guard that exists to prevent exactly that. The POSIX spelling was
 * correctly refused the whole time, which is what made it look like the check worked.
 *
 * Backslash is now a real separator rather than an ordinary character, so `sub\file.ts` does the
 * natural thing instead of creating one oddly-named file.
 *
 * A leading drive letter is refused too. On Windows a colon cannot appear in a filename at all,
 * so nothing legitimate is lost; on POSIX a file literally named `C:foo` is legal but is far more
 * likely to be someone pasting a Windows path than naming a file that way on purpose.
 */
function safeSegments(name: string): string[] | null {
  const t = name.trim()
  if (!t) return null
  // Which of these actually carry weight was measured by reverting each one and watching the
  // tests, rather than assumed — four checks that all look essential is how a redundant one gets
  // treated as load-bearing and a load-bearing one gets "simplified" away.
  //
  //   split on BOTH separators   LOAD-BEARING — 5 tests fail without it
  //   drive-letter refusal       LOAD-BEARING — `C:\Windows\evil` has no empty segment and no
  //                              `..`, so nothing else catches it
  //   leading-separator refusal  redundant: `\evil` and `\\server\share` split to an EMPTY first
  //                              segment, which the check below already rejects
  //   trailing-separator refusal redundant: `sub\` splits to a trailing empty segment, likewise
  //
  // The two redundant ones are kept deliberately. This is a traversal guard, the cost is two
  // regex tests, and each states an intent that the empty-segment rule only implies.
  if (/^[\\/]/.test(t)) return null
  if (/^[A-Za-z]:/.test(t)) return null
  if (/[\\/]$/.test(t)) return null
  const segs = t.split(/[\\/]/)
  if (segs.some((seg) => !seg || seg === '..')) return null
  return segs
}

/**
 * Join a user-entered name onto a base dir. Multi-segment relative names (`a/b.ts`, and on
 * Windows `a\b.ts`) are allowed — intermediate dirs are the caller's job (see `ancestorDirs`).
 * Returns null for anything unsafe or senseless: empty, absolute, `..` traversal, trailing
 * separator.
 */
export function newEntryPath(baseDir: string, name: string): string | null {
  const segs = safeSegments(name)
  if (!segs) return null
  return `${baseDir.replace(/\/+$/, '')}/${segs.join('/')}`
}

/** Absolute paths of the intermediate dirs a nested name passes through (shallowest first).
 *
 *  Uses the same segmentation as `newEntryPath`, or a name written with backslashes would create
 *  the file while silently skipping the parent directories it needs. Returns nothing for a name
 *  that would be refused, so a rejected name cannot leave stray dirs behind either. */
export function ancestorDirs(baseDir: string, name: string): string[] {
  const segs = safeSegments(name)?.slice(0, -1) ?? []
  const out: string[] = []
  let acc = baseDir.replace(/\/+$/, '')
  for (const s of segs) {
    acc = `${acc}/${s}`
    out.push(acc)
  }
  return out
}

/** What a reveal should expand and select, or null when the path is not inside `cwd`. */
export interface RevealTargets {
  /** Ancestor directories to force-open, shallowest first, in the tree's own path convention. */
  dirs: string[]
  /** The node path to select — must match how the tree composes rows, or nothing highlights. */
  selected: string
}

/**
 * Resolve a reveal request into the directories to expand and the row to select.
 *
 * Every comparison here is separator-agnostic, because the inputs disagree by design: `cwd` is
 * native (so `C:\Users\me\proj` on Windows), a path arriving from the filesystem or a dialog is
 * native too, and a path arriving from a tree row is mixed. The previous version compared
 * `revealPath.startsWith(base + '/')`, which is false for every backslash path — so on Windows
 * `rel` became the WHOLE absolute path, its traversal guard (`rel.split('/')`) saw a single
 * segment and found no `..`, and the effect went on to build `C:\proj/C:\proj\src\a.ts`, expand
 * zero directories and select a row that does not exist. Reveal did nothing, silently.
 *
 * Output uses the tree's convention — native base, `/` for everything below — because these
 * strings are matched against row keys, not handed to the filesystem.
 */
export function revealTargets(cwd: string, revealPath: string): RevealTargets | null {
  const base = cwd.replace(/[\\/]+$/, '')
  const slash = (p: string): string => p.replace(/\\/g, '/')
  const nBase = slash(base)
  const nPath = slash(revealPath)

  // Case-insensitive only where the filesystem is: a Windows drive letter arriving as `c:` from
  // one source and `C:` from another must still match, and NTFS would treat them as one path.
  const insensitive = /^[A-Za-z]:/.test(nBase)
  const eq = (a: string, b: string): boolean =>
    insensitive ? a.toLowerCase() === b.toLowerCase() : a === b

  const prefix = nBase + '/'
  const rel = eq(nPath.slice(0, prefix.length), prefix) ? nPath.slice(prefix.length) : nPath

  // Reject anything that is not inside cwd. `rel` is still absolute when the prefix did not
  // match, which is exactly the case the old check missed on Windows.
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) return null
  const parts = rel.split('/')
  if (parts.some((p) => !p || p === '..')) return null

  const dirs: string[] = []
  let acc = base
  for (const part of parts.slice(0, -1)) {
    acc = `${acc}/${part}`
    dirs.push(acc)
  }
  return { dirs, selected: `${base}/${rel}` }
}
