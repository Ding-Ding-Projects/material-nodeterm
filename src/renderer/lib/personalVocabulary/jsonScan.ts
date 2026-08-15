/**
 * A small, bounded, hand-written JSON scanner used ONLY to validate an untrusted
 * personal-vocabulary upload before anything derived from it is displayed or cached.
 *
 * `JSON.parse` is deliberately NOT enough on its own: it silently keeps only the LAST of a
 * duplicate object key (the spec here requires REJECTING a file with duplicate keys), and it has
 * no built-in nesting-depth limit (a pathologically nested `{"a":{"a":{"a":...` payload is a
 * cheap way to blow the stack or the event loop on `JSON.stringify`/deep-clone code downstream).
 * This scanner is a real recursive-descent JSON parser — not a regex over the text — so it
 * cannot mistake a brace inside a quoted string for a structural one, and it enforces a maximum
 * depth and node count as it goes rather than after the fact.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface JsonScanOk {
  ok: true
  value: JsonValue
  maxDepthSeen: number
}
export interface JsonScanError {
  ok: false
  error: string
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])

/** Parse `text` as JSON, rejecting duplicate object keys and payloads deeper than `maxDepth`.
 *  `maxNodes` bounds total array/object/string/number/literal nodes visited, so a huge flat
 *  array (still depth 1) can't spend unbounded time either. */
export function scanJson(text: string, opts: { maxDepth: number; maxNodes: number }): JsonScanOk | JsonScanError {
  let i = 0
  const n = text.length
  let maxDepthSeen = 0
  let nodeCount = 0

  const fail = (error: string): JsonScanError => ({ ok: false, error })

  function skipWs(): void {
    while (i < n && WHITESPACE.has(text[i])) i++
  }

  function budget(): string | null {
    nodeCount++
    if (nodeCount > opts.maxNodes) return `the file has more than ${opts.maxNodes} JSON values`
    return null
  }

  function parseString(): { ok: true; value: string } | { ok: false; error: string } {
    // Caller has already confirmed text[i] === '"'.
    i++
    let out = ''
    while (i < n) {
      const c = text[i]
      if (c === '"') {
        i++
        return { ok: true, value: out }
      }
      if (c === '\\') {
        i++
        if (i >= n) break
        const e = text[i]
        if (e === '"' || e === '\\' || e === '/') out += e
        else if (e === 'b') out += '\b'
        else if (e === 'f') out += '\f'
        else if (e === 'n') out += '\n'
        else if (e === 'r') out += '\r'
        else if (e === 't') out += '\t'
        else if (e === 'u') {
          const hex = text.slice(i + 1, i + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { ok: false, error: 'invalid \\u escape' }
          out += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else return { ok: false, error: 'invalid escape sequence' }
        i++
      } else if (c.charCodeAt(0) < 0x20) {
        return { ok: false, error: 'control character in string' }
      } else {
        out += c
        i++
      }
    }
    return { ok: false, error: 'unterminated string' }
  }

  function parseLiteral(word: string, value: JsonValue): boolean {
    if (text.startsWith(word, i)) {
      i += word.length
      return true
    }
    return false
  }

  function parseNumber(): { ok: true; value: number } | { ok: false; error: string } {
    const start = i
    if (text[i] === '-') i++
    if (text[i] === '0') i++
    else if (text[i] >= '1' && text[i] <= '9') {
      while (i < n && text[i] >= '0' && text[i] <= '9') i++
    } else return { ok: false, error: 'invalid number' }
    if (text[i] === '.') {
      i++
      if (!(text[i] >= '0' && text[i] <= '9')) return { ok: false, error: 'invalid number' }
      while (i < n && text[i] >= '0' && text[i] <= '9') i++
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++
      if (text[i] === '+' || text[i] === '-') i++
      if (!(text[i] >= '0' && text[i] <= '9')) return { ok: false, error: 'invalid number' }
      while (i < n && text[i] >= '0' && text[i] <= '9') i++
    }
    return { ok: true, value: Number(text.slice(start, i)) }
  }

  function parseValue(depth: number): { ok: true; value: JsonValue } | { ok: false; error: string } {
    if (depth > opts.maxDepth) return { ok: false, error: `nested more than ${opts.maxDepth} levels deep` }
    maxDepthSeen = Math.max(maxDepthSeen, depth)
    const budgetErr = budget()
    if (budgetErr) return { ok: false, error: budgetErr }
    skipWs()
    const c = text[i]
    if (c === '"') return parseString()
    if (c === '{') return parseObject(depth)
    if (c === '[') return parseArray(depth)
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber()
    if (parseLiteral('true', true)) return { ok: true, value: true }
    if (parseLiteral('false', false)) return { ok: true, value: false }
    if (parseLiteral('null', null)) return { ok: true, value: null }
    return { ok: false, error: i >= n ? 'unexpected end of input' : `unexpected character at position ${i}` }
  }

  function parseObject(depth: number): { ok: true; value: JsonValue } | { ok: false; error: string } {
    i++ // consume '{'
    const out: Record<string, JsonValue> = {}
    const seen = new Set<string>()
    skipWs()
    if (text[i] === '}') {
      i++
      return { ok: true, value: out }
    }
    for (;;) {
      skipWs()
      if (text[i] !== '"') return { ok: false, error: 'expected an object key' }
      const key = parseString()
      if (!key.ok) return key
      if (seen.has(key.value)) return { ok: false, error: `duplicate key "${key.value}"` }
      seen.add(key.value)
      skipWs()
      if (text[i] !== ':') return { ok: false, error: 'expected ":" after object key' }
      i++
      const value = parseValue(depth + 1)
      if (!value.ok) return value
      out[key.value] = value.value
      skipWs()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === '}') {
        i++
        return { ok: true, value: out }
      }
      return { ok: false, error: 'expected "," or "}" in object' }
    }
  }

  function parseArray(depth: number): { ok: true; value: JsonValue } | { ok: false; error: string } {
    i++ // consume '['
    const out: JsonValue[] = []
    skipWs()
    if (text[i] === ']') {
      i++
      return { ok: true, value: out }
    }
    for (;;) {
      const value = parseValue(depth + 1)
      if (!value.ok) return value
      out.push(value.value)
      skipWs()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === ']') {
        i++
        return { ok: true, value: out }
      }
      return { ok: false, error: 'expected "," or "]" in array' }
    }
  }

  skipWs()
  if (i >= n) return fail('empty file')
  const result = parseValue(1)
  if (!result.ok) return fail(result.error)
  skipWs()
  if (i < n) return fail('trailing data after the JSON value')
  return { ok: true, value: result.value, maxDepthSeen }
}
