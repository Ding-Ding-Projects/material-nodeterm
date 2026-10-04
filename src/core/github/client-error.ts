export class GitHubClientError extends Error {
  constructor(
    readonly code: 'invalid-request' | 'malformed-response' | 'response-too-large' |
      'request-failed' | 'rate-limited' | 'insufficient-permission',
    readonly status?: number,
    readonly retryAt?: number,
    /** Which rate budget a PRIMARY limit belongs to (`x-ratelimit-resource`). `graphql` and `core`
     *  are separate budgets, so a spent `graphql` budget must not hold REST issue sync. Absent for a
     *  secondary limit, which GitHub applies to the whole account. */
    readonly resource?: string
  ) {
    super(code)
  }
}
