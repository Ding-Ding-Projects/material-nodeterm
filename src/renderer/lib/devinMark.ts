// A compact monochrome Devin mark for the agent picker and status indicator. It is inline so the
// same geometry can be painted by React and the imperative HUD without a remote image or asset.
export const DEVIN_MARK_VIEWBOX = '0 0 24 24'
export const DEVIN_MARK_PATH =
  'M4 3h7.4C17.9 3 21 6.6 21 12s-3.1 9-9.6 9H4V3Zm4 4v10h3.2c3.8 0 5.8-1.8 5.8-5s-2-5-5.8-5H8Z'

export function createDevinMarkSvg(size: number, className: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', DEVIN_MARK_VIEWBOX)
  svg.setAttribute('fill', 'currentColor')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', className)
  const path = document.createElementNS(NS, 'path')
  path.setAttribute('fill-rule', 'evenodd')
  path.setAttribute('d', DEVIN_MARK_PATH)
  svg.appendChild(path)
  return svg
}
