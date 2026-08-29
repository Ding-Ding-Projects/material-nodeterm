import type { NodeKind } from '@shared/types'

/**
 * Minimum width/height for each node kind. These are the single source of truth
 * for the `minWidth`/`minHeight` every node passes to React Flow's `<NodeResizer>` —
 * the components read them here instead of re-declaring the literals, so the two
 * can't drift apart.
 *
 * The resizer enforces these only during a drag. Programmatic size changes (e.g.
 * align-to-grid) bypass the resizer, so they must clamp to these values themselves
 * to avoid shrinking a node below what its resizer would allow.
 */
export const NODE_MIN_SIZES: Record<NodeKind, { width: number; height: number }> = {
  terminal: { width: 260, height: 160 },
  sticky: { width: 160, height: 120 },
  group: { width: 200, height: 140 },
  editor: { width: 320, height: 200 },
  diff: { width: 420, height: 220 },
  video: { width: 320, height: 200 },
  web: { width: 320, height: 200 },
  browser: { width: 360, height: 240 },
  photo: { width: 320, height: 240 },
  gallery: { width: 360, height: 280 },
  'wild-dim-sum': { width: 360, height: 280 },
  files: { width: 280, height: 220 },
  scheduler: { width: 320, height: 220 },
  calendar: { width: 420, height: 320 },
  authenticator: { width: 420, height: 360 },
  annotation: { width: 180, height: 120 },
  shop: { width: 360, height: 260 },
  nsis: { width: 520, height: 420 },
  'homeassistant-control': { width: 460, height: 480 },
  'nextcloud-aio': { width: 520, height: 420 },
  'nextcloud-managed': { width: 520, height: 420 },
  subagent: { width: 180, height: 84 },
  loop: { width: 180, height: 84 },
  dino: { width: 400, height: 160 },
  'recovery-game': { width: 480, height: 520 },
  'windows-diagnostics': { width: 520, height: 360 },
  veracrypt: { width: 560, height: 420 },
  'gitlab-hosting': { width: 560, height: 360 },
  'aws-universe': { width: 320, height: 220 },
  'aws-resource': { width: 520, height: 420 },
  'repository-graph': { width: 560, height: 380 },
  unigetui: { width: 360, height: 240 }
  , 'homeassistant-sensor': { width: 460, height: 360 }
  , alarm: { width: 360, height: 260 }
  , trigger: { width: 360, height: 260 }
  , awsidentity: { width: 460, height: 360 }
  , dockerhost: { width: 520, height: 420 }
  , freepbx: { width: 520, height: 360 }
  , gitlab: { width: 520, height: 360 }
  , homeassistant: { width: 460, height: 360 }
  , proxmox: { width: 520, height: 360 }
  , minecraft: { width: 520, height: 420 }
  , timer: { width: 320, height: 220 }
  , 'open-webui-hosting': { width: 520, height: 420 }
  , 'cloudflare-tunnel': { width: 520, height: 420 }
  , 'cloudflare-zero-trust': { width: 520, height: 420 }
  , 'cloudflare-core-managers': { width: 520, height: 420 }
  , torrent: { width: 520, height: 420 }
  , 'linux-vm': { width: 520, height: 420 }
  , 'github-work-item': { width: 520, height: 360 }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Snap a rectangle so all four corners land on grid intersections: each edge
 * (left, top, right, bottom) rounds independently to its nearest grid line. The
 * width/height are then raised to the node kind's grid-aligned minimum so a small
 * node (or a large grid) never inverts or undershoots what its `<NodeResizer>`
 * would allow. Left/top stay at their snapped positions; only the right/bottom
 * edge extends when the minimum has to kick in.
 */
export function snapNodeToGrid(g: number, kind: NodeKind, r: Rect): Rect {
  const x = Math.round(r.x / g) * g
  const y = Math.round(r.y / g) * g
  let width = Math.round((r.x + r.width) / g) * g - x
  let height = Math.round((r.y + r.height) / g) * g - y
  const min = NODE_MIN_SIZES[kind] ?? { width: 0, height: 0 }
  const minW = Math.ceil(min.width / g) * g
  const minH = Math.ceil(min.height / g) * g
  if (width < minW) width = minW
  if (height < minH) height = minH
  return { x, y, width, height }
}
