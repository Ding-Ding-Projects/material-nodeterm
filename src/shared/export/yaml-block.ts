// A small, real block-style YAML emitter for JSON-safe values (string | number | boolean | null |
// array | plain object) — human-editable output, not a flow-style JSON dump. Nested collections
// recurse in block style too; only genuinely empty collections fall back to `[]`/`{}` flow, which
// is the standard YAML spelling for "empty" anyway.

import { yamlFlow } from './scalars'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function indent(n: number): string {
  return '  '.repeat(n)
}

/** A mapping key is always emitted as a JSON double-quoted string. JSON string syntax is valid
 *  YAML 1.2, and quoting every key avoids the surprisingly broad plain-key grammar (`: ` starts
 *  a value, ` #` starts a comment, leading `?`/`-` have structure, and quotes need escaping).
 *  This is a data codec, so preserving the exact key beats shaving two quote characters. */
function renderKey(key: string): string {
  return JSON.stringify(key)
}

/** Renders `value` as it would appear AFTER `key:` at `depth` — i.e. either inline on the same
 *  line (scalars, empty collections) or as an indented block starting on the next line. */
function renderValue(value: unknown, depth: number): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return ' []\n'
    let out = '\n'
    for (const item of value) {
      if (isPlainObject(item) && Object.keys(item).length > 0) {
        // A mapping under a sequence item: `- key: value` then the rest indented to match.
        const entries = Object.entries(item)
        out += `${indent(depth)}- `
        entries.forEach(([k, v], i) => {
          const prefix = i === 0 ? '' : indent(depth + 1)
          out += `${prefix}${renderKey(k)}:${renderValue(v, depth + 2)}`
        })
      } else if (Array.isArray(item) && item.length > 0) {
        out += `${indent(depth)}-${renderValue(item, depth + 1)}`
      } else {
        out += `${indent(depth)}- ${yamlFlow(item)}\n`
      }
    }
    return out
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return ' {}\n'
    let out = '\n'
    for (const [k, v] of entries) out += `${indent(depth)}${renderKey(k)}:${renderValue(v, depth + 1)}`
    return out
  }
  return ` ${yamlFlow(value)}\n`
}

/** Renders a top-level object as a YAML document (no leading `---` — optional in YAML, and this
 *  module's callers add their own header comment above the document instead). */
export function toYamlDocument(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj)
  if (entries.length === 0) return '{}\n'
  let out = ''
  for (const [k, v] of entries) out += `${renderKey(k)}:${renderValue(v, 1)}`
  return out
}
