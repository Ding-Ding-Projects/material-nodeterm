import { describe, it, expect } from 'vitest'
import { basenameForPathSyntax, normalizePathTail } from './path-basename'

// Both dialects on every case: a recorded path outlives the machine that wrote it, so the helper
// must answer from the string's own syntax rather than from the OS running the test.
describe('basenameForPathSyntax', () => {
  it('takes the leaf from a POSIX path', () => {
    expect(basenameForPathSyntax('/home/u/Documents/GitHub/material-nodeterm')).toBe('material-nodeterm')
  })

  it('takes the leaf from a drive-absolute Deen No path', () => {
    // The defect this exists to stop: splitting on '/' alone returns the WHOLE string here.
    expect(basenameForPathSyntax('C:\\Users\\cntow\\Documents\\GitHub\\material-nodeterm')).toBe('material-nodeterm')
  })

  it('takes the leaf from a UNC path', () => {
    expect(basenameForPathSyntax('\\\\server\\share\\projects\\app')).toBe('app')
  })

  it('accepts forward slashes in a drive-absolute path', () => {
    expect(basenameForPathSyntax('C:/Users/cntow/GitHub/app')).toBe('app')
  })

  it('ignores a trailing separator in either dialect', () => {
    expect(basenameForPathSyntax('/home/u/app/')).toBe('app')
    expect(basenameForPathSyntax('C:\\Users\\u\\app\\')).toBe('app')
  })

  it('keeps an unqualified backslash as filename text, not structure', () => {
    // A POSIX filename may legally contain a backslash; guessing Windows structure truncates it.
    expect(basenameForPathSyntax('/home/u/od\\d name')).toBe('od\\d name')
  })

  it('has no leaf at a root', () => {
    expect(basenameForPathSyntax('/')).toBe('')
    expect(basenameForPathSyntax('C:\\')).toBe('')
  })
})

describe('normalizePathTail', () => {
  it('trims a trailing separator in both dialects so one folder is one key', () => {
    expect(normalizePathTail('/home/u/app/')).toBe('/home/u/app')
    expect(normalizePathTail('C:\\Users\\u\\app\\')).toBe('C:\\Users\\u\\app')
    expect(normalizePathTail('C:/Users/u/app/')).toBe('C:/Users/u/app')
  })

  it('leaves a root alone rather than trimming it away', () => {
    expect(normalizePathTail('/')).toBe('/')
    expect(normalizePathTail('C:\\')).toBe('C:\\')
  })

  it('is a no-op on an already-normalized path', () => {
    expect(normalizePathTail('C:\\Users\\u\\app')).toBe('C:\\Users\\u\\app')
  })
})
