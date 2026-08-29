/** Single-quote a value as one POSIX shell argument. Shared by launch previews and the trusted
 * command paths so custom-agent expansion cannot drift between what is shown and what is sent. */
export function shellSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

const SAFE_BARE_TOKEN = /^[A-Za-z0-9_@%+=:,.^\/-]+$/

/** Keep shell-inert values readable, quote every value that could become shell syntax. */
export function shellQuoteIfNeeded(value: string): string {
  return value !== '' && SAFE_BARE_TOKEN.test(value) ? value : shellSingleQuote(value)
}

/**
 * Split a user-entered argv fragment without evaluating shell syntax. Quotes and backslash escapes
 * define token boundaries; environment expansion happens only after this split, so an expanded
 * value containing spaces or metacharacters remains one argument.
 */
export function shellSplit(input: string): string[] {
  const tokens: string[] = []
  let buffer = ''
  let inSingle = false
  let inDouble = false
  let hasToken = false
  const push = (): void => {
    if (hasToken) tokens.push(buffer)
    buffer = ''
    hasToken = false
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inSingle) {
      if (ch === "'") inSingle = false
      else buffer += ch
      continue
    }
    if (inDouble) {
      if (ch === '\\' && input[i + 1] !== undefined) buffer += input[++i]
      else if (ch === '"') inDouble = false
      else buffer += ch
      continue
    }
    if (ch === '\\' && input[i + 1] !== undefined) {
      buffer += input[++i]
      hasToken = true
    } else if (ch === "'") {
      inSingle = true
      hasToken = true
    } else if (ch === '"') {
      inDouble = true
      hasToken = true
    } else if (/\s/.test(ch)) {
      push()
    } else {
      buffer += ch
      hasToken = true
    }
  }
  if (inSingle || inDouble) return []
  push()
  return tokens
}
