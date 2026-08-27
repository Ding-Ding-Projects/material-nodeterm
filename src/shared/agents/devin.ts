import { shellSingleQuote } from '../shell-quote'

/** Facts measured against Cognition's Devin CLI 3000.4.25 (7e8e528a). */
export const DEVIN_CLI_VERSION = '3000.4.25'
export const DEVIN_CLI_REVISION = '7e8e528a'

export type DevinPromptForm = 'interactive' | 'argv' | 'prompt-file' | 'print'
export type DevinResumeForm = 'resume' | 'continue'
export type DevinStructuredStatus =
  | 'running'
  | 'needs-input'
  | 'permission-required'
  | 'stopped'
  | 'unknown'

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function safeSessionId(sessionId: string): string | null {
  const value = sessionId.trim()
  return value && SAFE_SESSION_ID.test(value) ? value : null
}

/**
 * Assemble one of Devin's measured prompt forms. Prompt text is shell-quoted at the boundary and
 * the `--` separator is retained for argv forms so words such as "login" remain prompt text.
 */
export function devinPromptCommand(
  prompt: string,
  form: DevinPromptForm = 'interactive'
): string | null {
  if (typeof prompt !== 'string' || !prompt.trim()) return null
  const value = shellSingleQuote(prompt.replace(/\s+/g, ' ').trim())
  if (form === 'prompt-file') return `devin --prompt-file ${value}`
  if (form === 'print') return `devin -p -- ${value}`
  return `devin -- ${value}`
}

export function devinInteractiveCommand(): string {
  return 'devin'
}

export function devinPromptFileCommand(filePath: string): string | null {
  if (typeof filePath !== 'string' || !filePath.trim()) return null
  return `devin --prompt-file ${shellSingleQuote(filePath.trim())}`
}

export function devinPrintCommand(prompt: string): string | null {
  return devinPromptCommand(prompt, 'print')
}

/** Resume a known session with Devin's documented short option. */
export function devinResumeCommand(sessionId: string): string | null {
  const value = safeSessionId(sessionId)
  return value ? `devin -r ${value}` : null
}

/** Continue the most recent session, or a specific session when Devin supplies an id. */
export function devinContinueCommand(sessionId?: string): string | null {
  if (sessionId === undefined || !sessionId.trim()) return 'devin -c'
  const value = safeSessionId(sessionId)
  return value ? `devin -c ${value}` : null
}

/**
 * Map a Devin hook event to nodeterm's structured status vocabulary. Unknown events deliberately
 * stay `unknown`; terminal BEL/OSC notifications are a fallback and never become a fabricated
 * structured hook event.
 */
export function devinStatusForHook(eventName: unknown): DevinStructuredStatus {
  switch (eventName) {
    case 'SessionStart':
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostCompaction':
      return 'running'
    case 'PermissionRequest':
      return 'permission-required'
    case 'Stop':
    case 'SessionEnd':
      return 'stopped'
    default:
      return 'unknown'
  }
}

export interface DevinTerminalNotification {
  source: 'BEL' | 'OSC 9' | 'OSC 777'
  status: DevinStructuredStatus
  message?: string
}

/**
 * Parse Devin's terminal-only notification fallback. BEL has no semantic payload, so it is kept as
 * `unknown`. OSC 9/777 messages are classified only on explicit words and never promoted to a
 * structured lifecycle event. The parser accepts one terminal chunk and returns the first signal.
 */
export function parseDevinTerminalNotification(chunk: string): DevinTerminalNotification | null {
  if (typeof chunk !== 'string' || !chunk) return null
  if (chunk.includes('\u0007')) return { source: 'BEL', status: 'unknown' }

  const osc = /\u001b\](9|777);([^\u0007\u001b]*)(?:\u0007|\u001b\\)/.exec(chunk)
  if (!osc) return null
  const message = osc[2].trim()
  const lower = message.toLowerCase()
  const status: DevinStructuredStatus =
    /permission|approval|approve/.test(lower)
      ? 'permission-required'
      : /input|question|respond|reply|waiting|attention/.test(lower)
        ? 'needs-input'
        : /done|finish|complete|stopped|stop|exit|ended/.test(lower)
          ? 'stopped'
          : 'unknown'
  return {
    source: osc[1] === '9' ? 'OSC 9' : 'OSC 777',
    status,
    ...(message ? { message } : {})
  }
}
