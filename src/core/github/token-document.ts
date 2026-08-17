/** One canonical on-disk envelope shared by Desktop and Server Edition. */
export type GitHubTokenDocument =
  | { version: 1; kind: 'safe-storage'; value: string }
  | { version: 1; kind: 'restricted-file'; token: string }

export class GitHubTokenDocumentError extends Error {
  readonly code = 'credential-unavailable' as const

  constructor(
    message = 'The stored GitHub credential is malformed or unavailable.',
    options: { cause?: unknown } = {}
  ) {
    super(message, options)
  }
}

export function validGitHubToken(token: string): boolean {
  return token.trim() === token && token.length > 0 && token.length <= 4096 && !/[\r\n\0]/.test(token)
}

function validCanonicalBase64(value: string): boolean {
  if (
    !value ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    return false
  }
  return Buffer.from(value, 'base64').toString('base64') === value
}

export function parseGitHubTokenDocument(value: unknown): GitHubTokenDocument {
  if (!value || typeof value !== 'object') throw new GitHubTokenDocumentError()
  const document = value as Partial<GitHubTokenDocument>
  if (document.version !== 1) throw new GitHubTokenDocumentError()
  if (
    document.kind === 'safe-storage' &&
    typeof document.value === 'string' &&
    validCanonicalBase64(document.value)
  ) {
    return document as GitHubTokenDocument
  }
  if (
    document.kind === 'restricted-file' &&
    typeof document.token === 'string' &&
    validGitHubToken(document.token)
  ) {
    return document as GitHubTokenDocument
  }
  // Server Edition v1 originally omitted the explicit kind. Accept that exact legacy envelope
  // without weakening validation, then write the canonical cross-shell shape on the next save.
  const legacy = value as { version?: unknown; kind?: unknown; token?: unknown }
  if (
    legacy.version === 1 &&
    legacy.kind === undefined &&
    typeof legacy.token === 'string' &&
    validGitHubToken(legacy.token)
  ) {
    return { version: 1, kind: 'restricted-file', token: legacy.token }
  }
  throw new GitHubTokenDocumentError()
}
