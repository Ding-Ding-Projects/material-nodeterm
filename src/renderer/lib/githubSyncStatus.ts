// What the board header and Settings → GitHub Issues say about the state of GitHub sync — decided
// in one pure place so the two surfaces cannot describe the same condition in two ways. Each
// sentence names only what was measured: the throttle and budget come from GitHub's own
// `x-ratelimit-*` headers (or its refusal), never from a guess about why a request failed.
//
// Every sentence exists in two forms from ONE definition: a `GitHubSyncCopy` (catalogue id, English
// template, and the exact facts — times, counts — kept apart from the prose) for a surface that
// localizes and maps the personal vocabulary before the facts are filled in, and the plain English
// sentence (`*Sentence`) for anything that only needs the words.
import type { GitHubAuthStatus, GitHubRateStatus, GitHubThrottle } from '@shared/github-issues'

/** Local wall-clock time, hours and minutes. */
export function githubClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** One sentence as a catalogue id + English template + verbatim facts (`{token}` markers). */
export interface GitHubSyncCopy {
  id: string
  template: string
  facts: Record<string, string>
}

/** The English sentence a copy describes, facts filled in. */
export function githubCopyText(copy: GitHubSyncCopy): string {
  return copy.template.replace(/\{(\w+)\}/g, (match, key: string) => copy.facts[key] ?? match)
}

export function githubThrottleCopy(
  throttle: GitHubThrottle | undefined,
  clock: (ms: number) => string = githubClock
): GitHubSyncCopy | null {
  if (!throttle) return null
  return throttle.kind === 'rate-limited'
    ? {
        id: 'github.sync.rateLimited',
        template: 'GitHub rate limit reached. Sync resumes at {time}.',
        facts: { time: clock(throttle.until) }
      }
    : {
        id: 'github.sync.lowBudget',
        template: 'Background sync paused until {time} to leave the rest of this hour’s GitHub requests to you.',
        facts: { time: clock(throttle.until) }
      }
}

export function githubThrottleSentence(
  throttle: GitHubThrottle | undefined,
  clock: (ms: number) => string = githubClock
): string | null {
  const copy = githubThrottleCopy(throttle, clock)
  return copy ? githubCopyText(copy) : null
}

export function githubRateCopy(
  rate: GitHubRateStatus,
  clock: (ms: number) => string = githubClock
): GitHubSyncCopy {
  return {
    id: 'github.sync.rate',
    template: '{remaining} of {limit} GitHub requests left until {time}.',
    facts: {
      remaining: rate.remaining.toLocaleString('en-US'),
      limit: rate.limit.toLocaleString('en-US'),
      time: clock(rate.resetAt)
    }
  }
}

export function githubRateSentence(
  rate: GitHubRateStatus,
  clock: (ms: number) => string = githubClock
): string {
  return githubCopyText(githubRateCopy(rate, clock))
}

/** The sign-in check could not reach an answer. Deliberately never "signed out": only GitHub
 *  refusing the credential means that, and this sentence is for everything that is not that. */
export function githubUnreachableCopy(
  unreachable: NonNullable<GitHubAuthStatus['unreachable']>,
  clock: (ms: number) => string = githubClock
): GitHubSyncCopy {
  if (unreachable.reason === 'rate-limited') {
    return unreachable.retryAt !== undefined
      ? {
          id: 'github.sync.signInRateLimitedUntil',
          template: 'GitHub’s rate limit was reached, so the sign-in could not be checked until {time}.',
          facts: { time: clock(unreachable.retryAt) }
        }
      : {
          id: 'github.sync.signInRateLimited',
          template: 'GitHub’s rate limit was reached, so the sign-in could not be checked.',
          facts: {}
        }
  }
  return { id: 'github.sync.signInUnreachable', template: 'GitHub could not be reached to check the sign-in.', facts: {} }
}

export function githubUnreachableSentence(
  unreachable: NonNullable<GitHubAuthStatus['unreachable']>,
  clock: (ms: number) => string = githubClock
): string {
  return githubCopyText(githubUnreachableCopy(unreachable, clock))
}

/** Why the board will not write: this machine has not approved the column mapping now in the
 *  project file. Shared by the board header and a refused move, so both point at the same fix. */
export const GITHUB_MAPPING_NOT_APPROVED =
  'The column labels changed. Approve them in Settings → GitHub Issues to move issues again.'
