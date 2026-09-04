/** Pure SVG plan for the Windows taskbar overlay icon. */
export function taskbarBadgePlan(count: unknown): { dataUrl: string; description: string } | null {
  if (!Number.isFinite(count) || Number(count) <= 0) return null
  const value = Math.min(999, Math.floor(Number(count)))
  const label = value > 99 ? '99+' : String(value)
  const size = label.length >= 3 ? 6 : label.length === 2 ? 8 : 10
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' +
    '<circle cx="8" cy="8" r="7.5" fill="#b3261e" stroke="#ffffff" stroke-width="1"/>' +
    `<text x="8" y="11" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${size}" font-weight="700" fill="#ffffff">${label}</text>` +
    '</svg>'
  return {
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    description: `${value} unread agent ${value === 1 ? 'update' : 'updates'}`
  }
}
