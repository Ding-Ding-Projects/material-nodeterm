/** Small line icons for the regex builder only — same convention as `components/icons.tsx`
 *  (24 viewBox, stroke=currentColor, 1.8 stroke width) but scoped to this lane so the shared
 *  icon file (owned by another lane) is only ever imported from, never edited, here. */
const S = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

export const IconRegexQuote = () => (
  <svg {...S}>
    <path d="M7 8c-2 1-3 2.6-3 5s1.3 4 3 5M17 8c2 1 3 2.6 3 5s-1.3 4-3 5" />
    <path d="M9 10v5M15 10v5" />
  </svg>
)

export const IconRegexError = () => (
  <svg {...S}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
)

export const IconRegexWarning = () => (
  <svg {...S}>
    <path d="M12 4l9 15.5H3z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
)

export const IconRegexArrowInsert = () => (
  <svg {...S}>
    <path d="M17 7L7 17M17 7H9M17 7v8" />
  </svg>
)
