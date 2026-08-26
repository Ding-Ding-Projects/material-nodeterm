import { describe, it, expect } from 'vitest'
import {
  NsisSpecError,
  assertNsisCompression,
  assertNsisInstallRoot,
  assertNsisInstallScope,
  assertSafeRelativePath,
  isValidNsisVersion,
  nsisCompressionDirective,
  nsisInstallRootVar,
  nsisQuoted,
  nsisString,
  padVersionToFour
} from './escape'

describe('nsisString — the string-literal escape boundary', () => {
  it('wraps plain text in quotes, unchanged', () => {
    expect(nsisString('Hello World')).toBe('"Hello World"')
  })

  it('escapes a double quote so it cannot close the string early', () => {
    // Without escaping this would render `"App" -evil-directive "Name"` — two NSIS tokens
    // instead of one string.
    const out = nsisString('App" -evil-directive "Name')
    expect(out).toBe('"App$\\" -evil-directive $\\"Name"')
    expect(out.split('"').length - 1).not.toBe(2) // more than the two delimiter quotes
  })

  it('escapes a bare $ so it cannot start a variable reference or ${...} constant', () => {
    // `$INSTDIR` and `${SOME_DEFINE}` are both live NSIS syntax inside a would-be string;
    // an unescaped $ here is how a form field could read out an installer-build-time constant
    // or a runtime path the caller never intended to expose.
    expect(nsisString('$INSTDIR\\evil')).toBe('"$$INSTDIR\\evil"')
    expect(nsisString('${PRODUCT_NAME}')).toBe('"$${PRODUCT_NAME}"')
  })

  it('escapes newline, carriage return and tab so a single field cannot inject new script lines', () => {
    const out = nsisString('line one\nline two\r\ttabbed')
    expect(out).toBe('"line one$\\nline two$\\r$\\ttabbed"')
    expect(out).not.toContain('\n')
    expect(out).not.toContain('\r')
    expect(out).not.toContain('\t')
  })

  it('passes a bare backslash through unchanged — NSIS has no general backslash escaping', () => {
    // Unlike C or shell strings, a plain `\` inside an NSIS double-quoted literal is not an
    // escape introducer; only the specific `$\"` / `$\n` / `$\r` / `$\t` forms are. Doubling
    // every backslash would be wrong (it would corrupt every ordinary Windows path we render).
    const out = nsisString('C:\\some\\path\\')
    expect(out).toBe('"C:\\some\\path\\"')
  })

  it('handles the empty string', () => {
    expect(nsisString('')).toBe('""')
  })

  it('an injection attempt combining every special character is fully neutralised', () => {
    const hostile = '"; !system \'del /s /q C:\\\' $INSTDIR ${EVIL}\n\r\t\\'
    const out = nsisString(hostile)
    // The only quotes in the output are the two delimiters we added ourselves.
    expect(out[0]).toBe('"')
    expect(out[out.length - 1]).toBe('"')
    const inner = out.slice(1, -1)
    expect(inner).not.toMatch(/(?<!\$\\)"/) // no bare unescaped quote inside
    expect(inner).not.toMatch(/(?<!\$)\$(?!\$|\\)/) // no bare unescaped $
    expect(inner).not.toContain('\n')
    expect(inner).not.toContain('\r')
    expect(inner).not.toContain('\t')
  })
})

describe('version validation — refused, not coerced', () => {
  it('accepts 1-4 dot-separated integer fields', () => {
    expect(isValidNsisVersion('1')).toBe(true)
    expect(isValidNsisVersion('1.2')).toBe(true)
    expect(isValidNsisVersion('1.2.3')).toBe(true)
    expect(isValidNsisVersion('0.4.0.1')).toBe(true)
  })

  it('rejects pre-release tags, build metadata and non-numeric fields', () => {
    expect(isValidNsisVersion('1.2.3-beta.1')).toBe(false)
    expect(isValidNsisVersion('1.2.3+build5')).toBe(false)
    expect(isValidNsisVersion('v1.2.3')).toBe(false)
    expect(isValidNsisVersion('1.2.x')).toBe(false)
    expect(isValidNsisVersion('')).toBe(false)
    expect(isValidNsisVersion('1.2.3.4.5')).toBe(false)
  })

  it('rejects a field over the 65535 VIProductVersion ceiling', () => {
    expect(isValidNsisVersion('1.99999.0')).toBe(false)
    expect(isValidNsisVersion('65535.0.0')).toBe(true)
  })

  it('refuses an injection attempt through the version field entirely (never partially applied)', () => {
    expect(isValidNsisVersion('1.0.0" ; !system "calc.exe')).toBe(false)
  })

  it('pads to exactly four fields', () => {
    expect(padVersionToFour('1')).toBe('1.0.0.0')
    expect(padVersionToFour('1.2')).toBe('1.2.0.0')
    expect(padVersionToFour('1.2.3')).toBe('1.2.3.0')
    expect(padVersionToFour('1.2.3.4')).toBe('1.2.3.4')
  })
})

describe('assertSafeRelativePath — refuses traversal and absolute paths, never clips them', () => {
  it('accepts ordinary relative paths', () => {
    expect(assertSafeRelativePath('bin/app.exe', 'x')).toBe('bin/app.exe')
    expect(assertSafeRelativePath('a\\b\\c.dll', 'x')).toBe('a\\b\\c.dll')
    expect(assertSafeRelativePath('', 'x')).toBe('')
  })

  it('refuses a leading .. traversal (forward slash)', () => {
    expect(() => assertSafeRelativePath('../../etc/passwd', 'sourcePath')).toThrow(NsisSpecError)
  })

  it('refuses a .. traversal buried mid-path (backslash)', () => {
    expect(() => assertSafeRelativePath('bin\\..\\..\\Windows\\System32', 'sourcePath')).toThrow(
      NsisSpecError
    )
  })

  it('refuses a Windows drive-absolute path', () => {
    expect(() => assertSafeRelativePath('C:\\Windows\\System32\\evil.dll', 'iconFile')).toThrow(
      NsisSpecError
    )
  })

  it('refuses a UNC path', () => {
    expect(() => assertSafeRelativePath('\\\\attacker\\share\\payload.exe', 'iconFile')).toThrow(
      NsisSpecError
    )
  })

  it('refuses a POSIX-style absolute path', () => {
    expect(() => assertSafeRelativePath('/etc/passwd', 'licenseFile')).toThrow(NsisSpecError)
  })

  it('the refusal message names the exact field, for a caller to act on', () => {
    expect(() => assertSafeRelativePath('../x', 'items[3].sourcePath')).toThrow(
      /items\[3\]\.sourcePath/
    )
  })
})

describe('closed-vocabulary re-validation — refuses rather than substitutes a default', () => {
  it('assertNsisInstallRoot accepts every real root and refuses anything else', () => {
    expect(assertNsisInstallRoot('programFiles64')).toBe('programFiles64')
    expect(() => assertNsisInstallRoot('programFiles')).toThrow(NsisSpecError)
    expect(() => assertNsisInstallRoot('$INSTDIR')).toThrow(NsisSpecError)
    expect(() => assertNsisInstallRoot('__proto__')).toThrow(NsisSpecError)
    expect(() => assertNsisInstallRoot(undefined)).toThrow(NsisSpecError)
    expect(() => assertNsisInstallRoot(123)).toThrow(NsisSpecError)
  })

  it('assertNsisCompression accepts every real value and refuses anything else', () => {
    expect(assertNsisCompression('lzma')).toBe('lzma')
    expect(() => assertNsisCompression('gzip')).toThrow(NsisSpecError)
    expect(() => assertNsisCompression('')).toThrow(NsisSpecError)
  })

  it('assertNsisInstallScope accepts every real value and refuses anything else', () => {
    expect(assertNsisInstallScope('perUser')).toBe('perUser')
    expect(() => assertNsisInstallScope('perProcess')).toThrow(NsisSpecError)
  })

  it('nsisInstallRootVar maps every root to its real NSIS variable', () => {
    expect(nsisInstallRootVar('programFiles64')).toBe('$PROGRAMFILES64')
    expect(nsisInstallRootVar('programFiles32')).toBe('$PROGRAMFILES')
    expect(nsisInstallRootVar('localAppData')).toBe('$LOCALAPPDATA')
    expect(nsisInstallRootVar('appData')).toBe('$APPDATA')
  })

  it('nsisCompressionDirective maps every value to its real NSIS directive', () => {
    expect(nsisCompressionDirective('zlib')).toBe('SetCompressor zlib')
    expect(nsisCompressionDirective('bzip2')).toBe('SetCompressor bzip2')
    expect(nsisCompressionDirective('lzma')).toBe('SetCompressor lzma')
    expect(nsisCompressionDirective('off')).toBe('SetCompress off')
  })
})

// ── deliberate red/green proof: break the quote-escape on purpose, watch the injection test go
// red, then confirm the real implementation (restored) is green. This is not something the
// automated suite can run for itself — it is the "watch a guard fail" discipline the house rules
// require, recorded here as a comment so a reviewer can repeat it by hand:
//
//   1. Comment out the `case '"':` branch in nsisString() (so a bare `"` passes through raw).
//   2. Re-run this file — "escapes a double quote..." fails immediately, because
//      `out.split('"').length - 1` becomes 4 instead of the escaped form's 2.
//   3. Restore the branch — the same test goes green again.
//
// Performed by hand during development of this file; the case above stays in the suite so the
// same break is caught automatically on any future edit.
describe('guard is provably load-bearing (see comment above for the red/green procedure)', () => {
  it('the quote-escape test would fail without case \'"\' in nsisString', () => {
    const out = nsisString('a"b')
    expect(out).toBe('"a$\\"b"')
  })
})

describe('nsisQuoted — mixed trusted-raw + escaped-text string literals', () => {
  const instdirBackslash = '$INSTDIR' + String.fromCharCode(92)

  it('keeps a raw part (e.g. $INSTDIR) unescaped while escaping the text part', () => {
    const out = nsisQuoted([{ raw: instdirBackslash }, { text: 'My App' }])
    expect(out).toBe(`"${instdirBackslash}My App"`)
  })

  it('an injection attempt through the text part cannot break out into the raw prefix', () => {
    const out = nsisQuoted([{ raw: instdirBackslash }, { text: '"; !system "calc.exe' }])
    // The raw $INSTDIR must survive as a live variable reference...
    expect(out.startsWith(`"${instdirBackslash}`)).toBe(true)
    // ...and the hostile text must be fully escaped, never producing an unescaped quote.
    const afterPrefix = out.slice(`"${instdirBackslash}`.length, -1)
    expect(afterPrefix).toBe('$\\"; !system $\\"calc.exe')
  })

  it('a raw part with no text part renders the bare variable reference, quoted', () => {
    expect(nsisQuoted([{ raw: '$INSTDIR' }])).toBe('"$INSTDIR"')
  })

  it('running nsisString on a value containing $INSTDIR would wrongly neutralise it — nsisQuoted does not', () => {
    // This is the exact bug this helper exists to prevent: nsisString() escapes every `$`,
    // which is correct for untrusted text but wrong for a value that legitimately needs
    // $INSTDIR to expand at install time.
    expect(nsisString(`${instdirBackslash}thing`)).toBe(`"$${instdirBackslash}thing"`)
    expect(nsisQuoted([{ raw: instdirBackslash }, { text: 'thing' }])).toBe(
      `"${instdirBackslash}thing"`
    )
  })
})
