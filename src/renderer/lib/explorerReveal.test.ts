// `revealTargets` — the path arithmetic behind "reveal this file in the Explorer".
//
// Its own file rather than appended to explorerCreate.test.ts: this is a different question (does
// reveal locate a row?) from that file's (is a typed name safe?), and the Windows cases below need
// a lot of setup prose that would bury the create tests.
//
// The convention these assertions encode is genuinely odd and worth stating once: on Windows the
// tree's ROOT is a native path (`C:\Users\me\proj`) while every level below it is composed by the
// component as `${parent}/${name}`. So a real node path is MIXED — `C:\Users\me\proj/src/a.ts` —
// and that is not a bug: Windows accepts mixed separators for filesystem calls, and these strings
// are matched against row keys rather than handed to the fs. `revealTargets` must therefore emit
// exactly that shape, or `expandMany` opens nothing and `setSelected` highlights nothing.

import { describe, expect, it } from 'vitest'
import { revealTargets } from './explorerCreate'

const WIN_CWD = String.raw`C:\Users\me\proj`

describe('revealTargets on POSIX paths', () => {
  it('expands each ancestor and selects the file', () => {
    expect(revealTargets('/home/me/proj', '/home/me/proj/src/ui/a.ts')).toEqual({
      dirs: ['/home/me/proj/src', '/home/me/proj/src/ui'],
      selected: '/home/me/proj/src/ui/a.ts'
    })
  })

  it('a file directly in cwd expands nothing', () => {
    expect(revealTargets('/home/me/proj', '/home/me/proj/a.ts')).toEqual({
      dirs: [],
      selected: '/home/me/proj/a.ts'
    })
  })

  it('tolerates a trailing separator on cwd', () => {
    expect(revealTargets('/home/me/proj/', '/home/me/proj/a.ts')?.selected).toBe(
      '/home/me/proj/a.ts'
    )
  })

  it('refuses a path outside cwd', () => {
    expect(revealTargets('/home/me/proj', '/etc/passwd')).toBeNull()
  })

  it('refuses traversal', () => {
    expect(revealTargets('/home/me/proj', '/home/me/proj/../../etc/passwd')).toBeNull()
  })

  it('is case-SENSITIVE on a POSIX root, where the filesystem is', () => {
    // /home/Me and /home/me are different directories on Linux; treating them as one would
    // reveal a row that does not belong to this project.
    expect(revealTargets('/home/me/proj', '/home/ME/proj/a.ts')).toBeNull()
  })
})

describe('revealTargets on Windows paths', () => {
  // Before this, reveal did nothing at all here — and nothing said so. `startsWith(base + '/')`
  // is false for a backslash path, so `rel` became the whole absolute path; the traversal guard
  // split it on '/' alone, saw one segment, found no '..' and let it through; and the effect then
  // built `C:\proj/C:\Users\me\proj\src\a.ts`, expanded zero directories and selected a row that
  // does not exist.
  it('handles a fully native path', () => {
    expect(revealTargets(WIN_CWD, String.raw`C:\Users\me\proj\src\ui\a.ts`)).toEqual({
      dirs: [String.raw`C:\Users\me\proj` + '/src', String.raw`C:\Users\me\proj` + '/src/ui'],
      selected: String.raw`C:\Users\me\proj` + '/src/ui/a.ts'
    })
  })

  it('handles the MIXED path a tree row actually carries', () => {
    // What the component composes: native root, '/' below it.
    expect(revealTargets(WIN_CWD, String.raw`C:\Users\me\proj` + '/src/a.ts')?.selected).toBe(
      String.raw`C:\Users\me\proj` + '/src/a.ts'
    )
  })

  it('emits the tree convention, never a fully native path', () => {
    // Emitting `C:\Users\me\proj\src` would expand nothing: no row is keyed that way.
    const t = revealTargets(WIN_CWD, String.raw`C:\Users\me\proj\src\a.ts`)
    expect(t?.dirs).toEqual([String.raw`C:\Users\me\proj` + '/src'])
    expect(t?.dirs[0].endsWith('/src')).toBe(true)
  })

  it('is case-INSENSITIVE on a drive root, where the filesystem is', () => {
    // A drive letter arrives as `c:` from one source and `C:` from another, and NTFS treats them
    // as the same path — so refusing the mismatch would silently drop a legitimate reveal.
    expect(revealTargets(WIN_CWD, String.raw`c:\users\me\proj\src\a.ts`)?.dirs).toEqual([
      String.raw`C:\Users\me\proj` + '/src'
    ])
  })

  it('refuses a path on the same drive but outside cwd', () => {
    expect(revealTargets(WIN_CWD, String.raw`C:\Windows\System32\config\SAM`)).toBeNull()
  })

  it('refuses a path on another drive', () => {
    expect(revealTargets(WIN_CWD, String.raw`D:\other\a.ts`)).toBeNull()
  })

  it('refuses backslash traversal', () => {
    // The exact shape the old guard missed: split on '/' found no '..' because there is no '/'.
    expect(revealTargets(WIN_CWD, String.raw`C:\Users\me\proj\..\..\evil.txt`)).toBeNull()
  })

  it('refuses a UNC path', () => {
    expect(revealTargets(WIN_CWD, String.raw`\\server\share\a.ts`)).toBeNull()
  })

  it('tolerates a trailing backslash on cwd', () => {
    expect(revealTargets(WIN_CWD + '\\', String.raw`C:\Users\me\proj\a.ts`)?.selected).toBe(
      String.raw`C:\Users\me\proj` + '/a.ts'
    )
  })
})
