// Decides whether a message from the remote announcements feed may be rendered at all.
//
// This exists because the feed is served by a REMOTE backend
// (`window.nodeTerminal.announcements.fetch()` → `/v1/check` → `{ messages, update }`), so a
// message the app renders is not fully under this repository's control. The standing product
// rule is that nodeterm never shows unsolicited marketing: no promotion, no upsell, no
// "subscribe to our other app", no stars/ratings/donations/sponsorship nagging. A server-side
// fix could be quietly reverted by anyone with feed access; this client-side gate cannot be,
// because it ships inside the app itself.
//
// WHY THIS IS A CLASSIFIER AND NOT A BLOCKLIST — the failure it prevents:
// the previous version of this file was allow-by-default (`isSolicitationAnnouncement`): it
// hid anything matching a list of nag phrasings and SHOWED everything else. A feed entry
// reading "Our iOS app is officially live on the App Store! ... we'd really appreciate it if
// you could subscribe <app>" shipped straight through it, because "subscribe <name>" is not
// "subscribe to" and an app-store launch was in no list at all. That is the general shape of
// the bug: an unclassified message is exactly how the next promo gets in. So the decision is
// now three-way and defaults to NOT showing — an item must positively look OPERATIONAL to
// render.
//
// The feed carries no kind/severity field we could trust for this (`level` is a remote-supplied
// COLOR, and asking the untrusted publisher to self-declare "this is not an ad" would hand the
// bypass right back), so the kind is classified here from the text.
//
// PRECEDENCE — promotional beats operational, deliberately. A promo that sprinkles in the word
// "critical" or "security" must not buy itself a render; fail closed for marketing. The cost of
// that choice is bounded, and it is why the trade is acceptable: the banner is NOT the channel
// that carries a forced update. `update.mandatory` / `update.minSupported` from the same
// `/v1/check` response drive `UpdateCard`'s blocking required-update state and never pass
// through this function, so refusing a mixed message here cannot leave a user stranded on an
// unsupported build.
//
// Surfaces: this is renderer code, so it covers BOTH Desktop and the Server Edition (same
// renderer, same banner). The mobile companion is a separate private repo and owes its own
// gate if it renders this feed — not fixable from here.

/** The subset of an announcement's fields this classifier reads. */
export interface AnnouncementTextLike {
  title?: string | null
  body?: string | null
  /** The "Learn more" target, if any — a store/donation link is itself a promotional signal. */
  url?: string | null
}

/**
 * What a feed message is, as judged from its own text.
 * - `operational` — the user needs it: security, mandatory update, broken release, outage.
 * - `promotional` — marketing/upsell/solicitation. Never rendered.
 * - `unknown` — nothing recognizable either way. Never rendered (fail closed).
 */
export type AnnouncementKind = 'operational' | 'promotional' | 'unknown'

// Promotional intent. Phrased as intents rather than literal sentences so a reworded campaign
// ("a star would mean the world", "grab it on the App Store") is still caught.
const PROMOTIONAL_PATTERNS: RegExp[] = [
  // cross-selling another product / app-store launches — the message that motivated this file
  /\bapp\s*store\b/i,
  /\bgoogle\s+play\b/i,
  /\bplay\s+store\b/i,
  /\btestflight\b/i,
  /\bdownload\s+(?:our|the)\s+(?:new\s+|free\s+)?(?:app|ios|android|mobile)/i,
  /\b(?:our|the)\s+(?:new\s+)?(?:ios|android|mobile|desktop)\s+app\b/i,
  /\bofficially\s+live\b/i,
  /\btry\s+(?:out\s+)?(?:our|the\s+new)\b/i,
  // subscribing / following / signing up to be marketed at (stemmed: subscribe/subscription)
  /\bsubscri\w*/i,
  /\bnewsletter\b/i,
  /\bfollow\s+us\b/i,
  /\bwaitlist\b/i,
  /\bearly\s+access\b/i,
  // affection-bait framing that precedes every ask
  /\bif\s+you\s+(?:love|like|enjoy|are\s+enjoying)\b/i,
  /\bwe(?:'|’)?d\s+(?:really\s+)?appreciate\b/i,
  /\bwould\s+mean\s+(?:a\s+lot|the\s+world)\b/i,
  // stars / ratings / reviews
  /\b(?:star|starring|rate|rating|review|reviewing)\s+(?:us|it|nodeterm|this\s+(?:app|project|repo(?:sitory)?))\b/i,
  /\b(?:give|leave|drop)\s+(?:us\s+)?a\s+(?:star|rating|review)\b/i,
  /\bhit\s+[\d,]+\s*(?:github\s+)?stars?\b/i,
  /\b[\d,]+\s*(?:github\s+)?stars?\b.*\b(?:help|mean|would|reach|goal|thanks|thank\s+you)\b/i,
  /\b(?:github\s+)?stars?\b.*\b(?:would\s+mean|mean\s+a\s+lot|help\s+us|reach\s+\d)/i,
  // sponsorship / donations / tipping — stemmed to catch sponsor(ing/s), donat(e/ion/ing)
  /\bsponsor\w*/i,
  /\bdonat\w*/i,
  /\btip\w*\s+(?:us|the\s+(?:dev|devs|team|author|authors))\b/i,
  /\bback(?:ing)?\s+(?:this|us|the\s+project)\b/i,
  /\bsupport\w*\s+(?:the\s+|this\s+)?project\b/i,
  /\bsupport\w*\s+us\b/i,
  /\bbuy\w*\s+(?:us\s+|me\s+)?a\s+coffee\b/i,
  // paid tiers, pricing, campaigns
  /\bupgrade\s+to\s+(?:pro|premium|paid|plus)\b/i,
  /\bgo\s+pro\b/i,
  /\bfree\s+trial\b/i,
  /\bpurchas\w*\s+(?:a\s+)?(?:license|subscription|plan)\b/i,
  /\bbuy\s+now\b/i,
  /\bpromo(?:tion(?:al)?)?\s*code\b/i,
  /\bcoupon\b/i,
  /\bdiscount\b/i,
  /\blimited[-\s]time\b/i,
  /\b\d+%\s*off\b/i,
  // links to app stores / donation / sponsorship hosts (checked against the "Learn more" url too)
  /play\.google\.com/i,
  /github\.com\/sponsors/i,
  /opencollective\.com/i,
  /patreon\.com/i,
  /ko-fi\.com/i,
  /buymeacoffee\.com/i,
  /paypal\.me/i
]

// Operational intent: the message exists to protect the user's machine, data or work — a
// security notice, a mandatory/blocking update, a release known to be broken, an outage. Only
// these render. Deliberately NOT here: ordinary product news ("v0.4 is out", "see the
// changelog"). That is not something a terminal must interrupt anyone for, and leaving it in
// `unknown` is what keeps the default closed instead of turning "mentions a version" into a
// marketing loophole.
const OPERATIONAL_PATTERNS: RegExp[] = [
  // security
  /\bsecurity\b/i,
  /\bvulnerabilit(?:y|ies)\b/i,
  /\bcve-\d{4}-\d+\b/i,
  /\bexploit(?:s|ed|able)?\b/i,
  /\bcompromis(?:e|ed|ing)\b/i,
  /\brevoke(?:d)?\s+(?:key|token|credential)/i,
  // forced / blocking update
  /\bmandatory\b/i,
  /\brequired\s+update\b/i,
  /\bmust\s+update\b/i,
  /\bupdate\s+(?:immediately|now|as\s+soon\s+as\s+possible)\b/i,
  /\bunsupported\s+version\b/i,
  /\bno\s+longer\s+supported\b/i,
  /\bend[\s-]of[\s-]life\b/i,
  // this release is broken
  /\bbroken\b/i,
  /\bregression\b/i,
  /\bknown\s+issue\b/i,
  /\bdata\s*[-\s]?loss\b/i,
  /\bcorrupt(?:s|ed|ion)?\b/i,
  /\bdo\s+not\s+(?:install|upgrade|update)\b/i,
  /\broll(?:ing)?\s*back\b/i,
  /\bwithdrawn\b/i,
  /\byanked\b/i,
  /\bhotfix\b/i,
  // service / compatibility
  /\boutage\b/i,
  /\bincident\b/i,
  /\bdowntime\b/i,
  /\bdisruption\b/i,
  /\bdegraded\b/i,
  /\bmaintenance\s+window\b/i,
  /\bbreaking\s+change/i,
  /\bdeprecat/i,
  /\bexpir(?:e|es|ed|ing|ation)\b/i
]

function textOf(message: AnnouncementTextLike): string {
  return `${message.title ?? ''} ${message.body ?? ''} ${message.url ?? ''}`.trim()
}

/**
 * Classify a feed message from its own text. Promotional signals win over operational ones —
 * see the precedence note at the top of this file.
 */
export function classifyAnnouncement(
  message: AnnouncementTextLike | null | undefined
): AnnouncementKind {
  if (!message) return 'unknown'
  const text = textOf(message)
  if (!text) return 'unknown'
  if (PROMOTIONAL_PATTERNS.some((re) => re.test(text))) return 'promotional'
  if (OPERATIONAL_PATTERNS.some((re) => re.test(text))) return 'operational'
  return 'unknown'
}

/**
 * The single decision the banner asks: may this message be rendered?
 *
 * Only `operational` may. `promotional` and `unknown` may not — an unclassified message is
 * exactly how a promo sneaks back in, so silence is the safe failure.
 *
 * Used by `src/renderer/components/AnnouncementBanner.tsx`.
 */
export function shouldShowAnnouncement(
  message: AnnouncementTextLike | null | undefined
): boolean {
  return classifyAnnouncement(message) === 'operational'
}
