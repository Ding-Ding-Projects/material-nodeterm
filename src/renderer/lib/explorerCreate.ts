// Pure path logic for Explorer/canvas "New File…" / "New Folder…" — kept out of the
// components so name validation and expansion targets are unit-testable. Paths are
// `/`-separated absolutes (remote SSH paths included); names come from a user prompt.

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
