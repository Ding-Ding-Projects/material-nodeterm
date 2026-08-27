export class GitHubClientError extends Error {
  constructor(
    readonly code: 'invalid-request' | 'malformed-response' | 'response-too-large' |
      'request-failed' | 'rate-limited' | 'insufficient-permission',
    readonly status?: number,
    readonly retryAt?: number
  ) {
    super(code)
  }
}
