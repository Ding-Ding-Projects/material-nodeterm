import type { UsageDiagnostic } from '@shared/types'
import { plainUsageTranslate, type UsageTranslate } from './usageFormat'

function viewLabel(view: UsageDiagnostic['view'], tr: UsageTranslate): string {
  return view === 'credits'
    ? tr('usage.diagnostic.view.credits', 'Credits view')
    : tr('usage.diagnostic.view.default', 'Default view')
}

/** The reason sentence alone, without the view it was read from. */
function usageDiagnosticMessage(
  provider: string,
  diagnostic: UsageDiagnostic,
  tr: UsageTranslate
): string {
  switch (diagnostic.reason) {
    case 'timeout':
      return tr('usage.diagnostic.timeout', 'Usage request timed out. Try again later.')
    case 'network':
      return tr(
        'usage.diagnostic.network',
        'Could not reach {provider}. Check the connection and try again.',
        { provider }
      )
    case 'invalid-response':
      return tr('usage.diagnostic.invalidResponse', 'Usage response could not be read. Try again later.')
    case 'http': {
      const status = String(diagnostic.httpStatus)
      const code = diagnostic.httpStatus
      return code === 401 || code === 403
        ? tr(
            'usage.diagnostic.httpAuth',
            '{provider} authentication failed (HTTP {status}). Check the CLI authentication on the machine running this project.',
            { provider, status }
          )
        : code === 429
          ? tr('usage.diagnostic.httpRateLimited', 'Usage request rate limited (HTTP 429). Try again later.')
          : code >= 500
            ? tr('usage.diagnostic.httpServer', '{provider} returned HTTP {status}. Try again later.', {
                provider,
                status
              })
            : tr(
                'usage.diagnostic.httpOther',
                'Usage request failed (HTTP {status}). Check the provider service and CLI configuration.',
                { status }
              )
    }
  }
}

/** Static copy only: diagnostics never carry provider response text or credential details. */
export function usageDiagnosticText(
  provider: string,
  diagnostic: UsageDiagnostic,
  tr: UsageTranslate = plainUsageTranslate
): string {
  return tr('usage.diagnostic.line', '{views}: {message}', {
    views: viewLabel(diagnostic.view, tr),
    message: usageDiagnosticMessage(provider, diagnostic, tr)
  })
}

/**
 * The lines a provider's failed views print (issue #912). Views stay distinct — they are different
 * reads — but an IDENTICAL reason is printed once, naming every view it came from, instead of the
 * same sentence verbatim per view (which made a provider with no data the tallest block).
 */
export function usageDiagnosticLines(
  provider: string,
  diagnostics: readonly UsageDiagnostic[] | undefined,
  tr: UsageTranslate = plainUsageTranslate
): string[] {
  const groups = new Map<string, string[]>()
  for (const d of diagnostics ?? []) {
    const message = usageDiagnosticMessage(provider, d, tr)
    const views = groups.get(message) ?? []
    const label = viewLabel(d.view, tr)
    groups.set(message, views.includes(label) ? views : [...views, label])
  }
  return [...groups].map(([message, views]) =>
    tr('usage.diagnostic.line', '{views}: {message}', { views: joinViews(views, tr), message })
  )
}

function joinViews(views: readonly string[], tr: UsageTranslate): string {
  if (views.length <= 1) return views[0] ?? ''
  return tr('usage.diagnostic.viewsJoined', '{first} and {last}', {
    first: views.slice(0, -1).join(', '),
    last: views[views.length - 1]
  })
}
