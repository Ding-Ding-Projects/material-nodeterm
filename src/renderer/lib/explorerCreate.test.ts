import { describe, expect, it } from 'vitest'
import { ancestorDirs, createTargetDir, newEntryPath, parentDir } from './explorerCreate'

describe('createTargetDir', () => {
  it('a dir targets itself, a file targets its parent', () => {
    expect(createTargetDir('/repo/src', true)).toBe('/repo/src')
    expect(createTargetDir('/repo/src/a.ts', false)).toBe('/repo/src')
  })
})

describe('parentDir', () => {
  it('strips the last segment', () => {
    expect(parentDir('/repo/src/a.ts')).toBe('/repo/src')
    expect(parentDir('/repo')).toBe('/')
  })
})

describe('newEntryPath', () => {
  it('joins simple and nested names', () => {
    expect(newEntryPath('/repo/src', 'notes.md')).toBe('/repo/src/notes.md')
    expect(newEntryPath('/repo/src/', 'a/b.ts')).toBe('/repo/src/a/b.ts')
  })
  it('rejects empty, absolute, traversal and trailing-slash names', () => {
    expect(newEntryPath('/repo', '')).toBeNull()
    expect(newEntryPath('/repo', '  ')).toBeNull()
    expect(newEntryPath('/repo', '/etc/passwd')).toBeNull()
    expect(newEntryPath('/repo', '../evil')).toBeNull()
    expect(newEntryPath('/repo', 'a/../../evil')).toBeNull()
    expect(newEntryPath('/repo', 'a/')).toBeNull()
  })
})

describe('ancestorDirs', () => {
  it('lists the intermediate dirs a nested name creates', () => {
    expect(ancestorDirs('/repo', 'a/b/c.ts')).toEqual(['/repo/a', '/repo/a/b'])
    expect(ancestorDirs('/repo', 'c.ts')).toEqual([])
  })
})

describe('a name typed with backslashes cannot escape the base dir', () => {
  // The check split on '/' alone, so only the POSIX spelling was refused. Every Windows form went
  // through: `..\evil.txt` produced `C:/proj/..\evil.txt`, which Windows resolves to `C:/evil.txt`
  // — a file created outside the project by the guard written to prevent it. That the POSIX case
  // was correctly rejected is what made the check look like it worked.
  const BASE = 'C:/proj'

  it.each([
    [String.raw`..\evil.txt`, 'parent traversal'],
    [String.raw`..\..\Windows\evil`, 'deep traversal'],
    [String.raw`sub\..\..\evil`, 'traversal in the middle'],
    [String.raw`C:\Windows\evil`, 'drive-qualified absolute'],
    [String.raw`\\server\share\evil`, 'UNC'],
    [String.raw`\evil`, 'backslash-absolute'],
    // '\\', not String.raw — a raw template literal cannot END with a backslash: it escapes the
    // closing backtick, swallows the rest of the file, and the parse error surfaces a dozen lines
    // later somewhere innocent.
    ['sub\\', 'trailing backslash']
  ])('refuses %s (%s)', (name) => {
    expect(newEntryPath(BASE, name)).toBeNull()
  })

  it('still refuses the POSIX spellings it always did', () => {
    expect(newEntryPath(BASE, '../evil')).toBeNull()
    expect(newEntryPath(BASE, '/evil')).toBeNull()
    expect(newEntryPath(BASE, 'sub/')).toBeNull()
    expect(newEntryPath(BASE, '  ')).toBeNull()
  })

  it('treats a backslash as a separator, so a nested Windows name works naturally', () => {
    expect(newEntryPath(BASE, String.raw`sub\file.ts`)).toBe('C:/proj/sub/file.ts')
    expect(newEntryPath(BASE, 'sub/file.ts')).toBe('C:/proj/sub/file.ts')
  })

  it('ancestorDirs segments the same way, or the parents are never created', () => {
    expect(ancestorDirs(BASE, String.raw`a\b\c.ts`)).toEqual(['C:/proj/a', 'C:/proj/a/b'])
    expect(ancestorDirs(BASE, 'a/b/c.ts')).toEqual(['C:/proj/a', 'C:/proj/a/b'])
  })

  it('a refused name leaves no stray directories behind', () => {
    // ancestorDirs used to happily segment a name newEntryPath would reject.
    expect(ancestorDirs(BASE, String.raw`..\..\evil\x.ts`)).toEqual([])
  })

  it('an ordinary dotfile is untouched', () => {
    expect(newEntryPath(BASE, '.gitignore')).toBe('C:/proj/.gitignore')
    expect(newEntryPath(BASE, '.config/app.json')).toBe('C:/proj/.config/app.json')
  })
})
