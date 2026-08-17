// Decides whether an announcement-feed message is a solicitation (asking the user for
// stars, ratings, reviews, sponsorship, donations, a tip, or a paid upgrade) rather than a
// genuinely useful notice (security, breaking changes, outages, deprecations, releases).
//
// This exists because the announcements feed is served by a REMOTE backend
// (`window.nodeTerminal.announcements.fetch()`), so a message the app renders is not fully
// under this repository's control. The project's standing rule is that no user-facing app or
// page may nag users for stars/ratings/reviews/donations/sponsorship/payment/upgrades. A
// server-side fix could be quietly reverted or bypassed by anyone with feed access; this
// client-side filter cannot be, because it ships inside the app itself.
//
// Matching is on INTENT, not one hard-coded sentence, so a feed author rewording "give us a
// star" as "a GitHub star would mean the world" is still caught. A message that ALSO carries a
// protective signal (security, breaking change, outage, mandatory update, ...) is always KEPT,
// even if it happens to contain solicitation-shaped wording too — losing a security notice to
// an overzealous keyword match is far worse than showing one nag.

/** The subset of an announcement's fields this predicate reads. */
export interface AnnouncementTextLike {
  title?: string | null
  body?: string | null
}

// Intent patterns for a solicitation. Deliberately phrased as intents (star/rate/review us,
// sponsor/donate/tip/back us, upgrade/subscribe/buy, or a link to a known
// donation/sponsorship host) rather than one literal sentence, so rewordings are still caught.
const SOLICITATION_PATTERNS: RegExp[] = [
  // "star us", "rate us", "review us" (and "starring"/"rating"/"reviewing" variants),
  // "star nodeterm", "star this repo/app/project"
  /\b(?:star|starring|rate|rating|review|reviewing)\s+(?:us|it|nodeterm|this\s+(?:app|project|repo(?:sitory)?))\b/i,
  // "give us a star/rating/review", "leave us a star/rating/review"
  /\b(?:give|leave|drop)\s+(?:us\s+)?a\s+(?:star|rating|review)\b/i,
  // "hit 600 GitHub stars", "600 stars", celebratory star-count framing that asks for more
  /\bhit\s+[\d,]+\s*(?:github\s+)?stars?\b/i,
  /\b[\d,]+\s*(?:github\s+)?stars?\b.*\b(?:help|mean|would|reach|goal|thanks|thank\s+you)\b/i,
  /\b(?:github\s+)?stars?\b.*\b(?:would\s+mean|mean\s+a\s+lot|help\s+us|reach\s+\d)/i,
  /\bstar\s+(?:us|nodeterm|this|it)\s+on\s+github\b/i,
  // sponsorship / donations / tipping — stemmed to catch "sponsor(ing/s)", "donat(e/ion/ing)"
  /\bsponsor\w*/i,
  /\bdonat\w*/i,
  /\btip\w*\s+(?:us|the\s+(?:dev|devs|team|author|authors))\b/i,
  /\bback(?:ing)?\s+(?:this|us|the\s+project)\b/i,
  /\bsupport\w*\s+(?:the\s+|this\s+)?project\b/i,
  /\bsupport\w*\s+us\b/i,
  /\bbuy\w*\s+(?:us\s+|me\s+)?a\s+coffee\b/i,
  // commercial upsell: upgrade to a paid tier, subscribe, purchase
  /\bupgrade\s+to\s+(?:pro|premium|paid)\b/i,
  /\bgo\s+pro\b/i,
  /\bsubscri\w*\s+(?:to|now|today)\b/i,
  /\bpurchas\w*\s+(?:a\s+)?(?:license|subscription|plan)\b/i,
  // links to known donation / sponsorship hosts
  /github\.com\/sponsors/i,
  /opencollective\.com/i,
  /patreon\.com/i,
  /ko-fi\.com/i,
  /buymeacoffee\.com/i,
  /paypal\.me/i
]

// Protective patterns: content that must never be suppressed, whatever else the message
// contains. If any of these match, the message is kept unconditionally.
const PROTECTIVE_PATTERNS: RegExp[] = [
  /\bsecurity\b/i,
  /\bvulnerabilit(?:y|ies)\b/i,
  /\bcve-\d{4}-\d+\b/i,
  /\bexploit(?:s|ed|able)?\b/i,
  /\bbreaking\s+change/i,
  /\bdeprecat/i,
  /\boutage\b/i,
  /\bdata\s*[- ]?loss\b/i,
  /\bincident\b/i,
  /\bdowntime\b/i,
  /\bdisruption\b/i,
  /\bmigration\b/i,
  /\bmandatory\b/i,
  /\brequired\s+update\b/i,
  /\burgent\b/i,
  /\bcritical\b/i,
  /\bpatch(?:ed|es)?\b/i,
  /\brelease\s+notes\b/i,
  /\bchangelog\b/i,
  /\bend[\s-]of[\s-]life\b/i,
  /\bunsupported\s+version\b/i,
  /\bmust\s+update\b/i
]

/**
 * True when `message` is a solicitation (stars/ratings/reviews/sponsorship/donations/tips/
 * paid-upgrade nagging) and carries none of the protective signals that must always be shown
 * (security, breaking changes, outages, deprecations, mandatory updates, release notes, ...).
 *
 * Used to filter the remote announcements feed before it is rendered — see
 * `src/renderer/components/AnnouncementBanner.tsx`.
 */
export function isSolicitationAnnouncement(message: AnnouncementTextLike | null | undefined): boolean {
  if (!message) return false
  const text = `${message.title ?? ''} ${message.body ?? ''}`.trim()
  if (!text) return false
  if (PROTECTIVE_PATTERNS.some((re) => re.test(text))) return false
  return SOLICITATION_PATTERNS.some((re) => re.test(text))
}
