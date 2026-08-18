import { useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { isServiceNodeKind, type ServiceNodeKind } from '@shared/types'
import { COLLAPSED_HEIGHT, SERVICE_NODE_LABELS, type CanvasNode } from '../state/workspace'
import { ColumnPill } from '../components/kanban/ColumnPill'
import { safeServiceEndpoint } from '@shared/node-exec'
import { nodeBorderStyle, nodeColorStyle } from '../lib/nodeColor'
import { ColorMenu } from '../components/color/ColorMenu'

/**
 * One component for the whole service family — Minecraft, Docker, Proxmox, GitLab, Home Assistant
 * and FreePBX. They differ in what they will eventually manage, not in how they behave as canvas
 * objects, so six near-identical components would be six copies of one rule waiting to drift.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO, and why the emptiness is the point:
 *
 * This node is not connected to anything yet. CLAUDE.md is explicit that a control which is styled
 * as operable while being inert is a defect rather than a placeholder — "any icon, preview, mock
 * window, toolbar control, card, tab, badge, illustration, affordance ... presented as if it can be
 * used must perform its labeled action". So there is no greyed-out Connect button here, no fake
 * status lamp, and no mock console: the surface says plainly what it is and what it cannot do yet,
 * and both controls it draws — the name and the address — genuinely work and genuinely persist.
 *
 * The address is stored and validated but nothing DIALS it yet, and the copy says exactly that
 * rather than implying a connection. Storing where you would connect is a real, useful thing on
 * its own; pretending it connects would not be.
 *
 * When a lane wires a real connection, it adds real controls beside this copy. Until then the honest
 * empty state is the feature, and it is much easier to add a working button later than to explain
 * why an existing one never did anything.
 */
/**
 * A realistic example per kind, so the field teaches its own format instead of demanding the user
 * already know it. Docker is the one worth getting right: `ssh://user@host` is how a remote Docker
 * host is actually named, and a placeholder showing `https://` would send people down the wrong
 * path entirely.
 */
const ENDPOINT_PLACEHOLDER: Record<ServiceNodeKind, string> = {
  minecraft: 'ssh://docker@192.168.1.10',
  dockerhost: 'ssh://docker@192.168.1.10',
  proxmox: 'https://proxmox.local:8006',
  gitlab: 'https://gitlab.example.com',
  homeassistant: 'http://homeassistant.local:8123',
  freepbx: 'https://pbx.local'
}

/**
 * Why an address was refused, in words that say what to do next.
 *
 * The password case is the one that has to be explicit. Somebody who pasted a URL with credentials
 * in it has just been refused FOR THEIR OWN BENEFIT, and without a reason they will reasonably
 * conclude the field is broken and go looking for a workaround — which in practice means finding
 * somewhere else to put the password.
 */
function describeEndpointProblem(value: string): string {
  const trimmed = value.trim()
  let url: URL | null = null
  try {
    url = new URL(trimmed)
  } catch {
    return 'That is not an address yet. It needs a scheme, like https://host or ssh://user@host.'
  }
  if (url.password !== '') {
    return 'Remove the password from the address. It would be saved as plain text, so a password belongs in the system keychain instead — the address itself is stored, the secret is not.'
  }
  if (url.username !== '' && url.protocol !== 'ssh:') {
    return 'Remove the username from the address. Only ssh:// addresses carry one, because there it names the target rather than an identity to log in with.'
  }
  if (!['http:', 'https:', 'ssh:'].includes(url.protocol)) {
    return `${url.protocol} addresses are not supported here. Use http://, https:// or ssh://.`
  }
  if (url.hostname === '') return 'That address has no host.'
  return 'That address cannot be used.'
}
export function ServiceNode({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const { updateNodeData, setNodes } = useReactFlow()
  /** Viewport anchor for the colour surface, or null when closed — coordinates rather than a
  *  boolean because ColorMenu is a body portal. */
  const [colorAnchor, setColorAnchor] = useState<{ x: number; y: number } | null>(null)
  /** The title is a plain span until clicked, matching StickyNode and TerminalNode — a permanently
   *  live input covers the whole header strip and leaves nothing to grab the node by. */
  const [editingLabel, setEditingLabel] = useState(false)
  /** The value editing started with, so Escape can put it back. */
  const [labelBefore, setLabelBefore] = useState('')
  const collapsed = !!data.collapsed

  /**
   * A node whose `type` is not a service kind cannot reach this component in production — React Flow
   * routes by the same string. It is still narrowed rather than cast, because `type` survives a
   * hand-edited project.json, and the alternative is indexing a lookup table with an arbitrary
   * string. Falling back to a neutral name keeps a mangled record rendering instead of throwing.
   */
  const kind: ServiceNodeKind | null = isServiceNodeKind(type) ? type : null
  /**
   * The address is a DRAFT until it parses. Committing on every keystroke would mean the node
   * flickers through a dozen invalid states while somebody types a hostname, and — worse — would
   * write a half-typed value into the machine-local index, where a later read would find it, refuse
   * it, and silently drop the connection the user thought they had set.
   */
  const [endpointDraft, setEndpointDraft] = useState(data.serviceConnection?.endpoint ?? '')
  const endpointOk = safeServiceEndpoint(endpointDraft)

  const commitEndpoint = (): void => {
    const trimmed = endpointDraft.trim()
    if (trimmed === '') {
      if (data.serviceConnection) updateNodeData(id, { serviceConnection: undefined })
      return
    }
    // The SAME predicate the storage boundary uses, deliberately. A form that accepted something
    // the store then refused would produce a node that looks configured and is not — the exact
    // silent half-state this component exists to avoid.
    if (!safeServiceEndpoint(trimmed)) return
    updateNodeData(id, {
      serviceConnection: { ...data.serviceConnection, endpoint: trimmed }
    })
  }
  // Derived once: the root colours its BORDER, the header a translucent wash of the same value,
  // and rainbow has to reach both or the node animates on one edge and not the other.
  const rootBorder = nodeBorderStyle(data.color)
  const headerTint = nodeColorStyle(data.color, 0.2)
  const productName = kind ? SERVICE_NODE_LABELS[kind] : data.title || 'Service'
  const label = data.serviceLabel ?? ''

  const toggleCollapse = () =>
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== id) return n
        const next = !n.data.collapsed
        const expandedHeight =
          (n.data.expandedHeight as number) ?? n.measured?.height ?? (n.height as number) ?? 400
        const height = next ? COLLAPSED_HEIGHT : expandedHeight
        return {
          ...n,
          height,
          style: { ...n.style, height },
          data: { ...n.data, collapsed: next, expandedHeight }
        }
      })
    )

  return (
    <>
      {/* Sibling of the root, which is overflow:hidden and would clip the half-pill. */}
      <ColumnPill nodeId={id} />
      <div
        className={`service-node${selected ? ' selected' : ''}${collapsed ? ' collapsed' : ''} ${rootBorder.className}`}
        style={rootBorder.style}
        role="group"
        aria-label={label ? `${productName}: ${label}` : `${productName}, no name set`}
      >
        <NodeResizer minWidth={320} minHeight={220} isVisible={selected && !collapsed} color={data.color} />

        <div
          // Not `${data.color}33`. Appending hex alpha is only a colour when the stored value is
          // 6-digit hex, and the picker has offered rgb() and oklch() for a while — so the trick
          // drops the whole declaration for anyone who used them. It is worse now that rainbow is
          // selectable: `rainbow33` is not an error either, just an ignored line, so the header
          // would render untinted with nothing to say why.
          className={`service-node__header ${headerTint.className}`}
          style={headerTint.style}
        >
          <button className="term-node__collapse" title={collapsed ? 'Expand' : 'Collapse'} onClick={toggleCollapse}>
            {collapsed ? '▸' : '▾'}
          </button>
          <button
            className="term-node__color"
            style={{ background: data.color }}
            title="Color"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setColorAnchor((a) => (a ? null : { x: r.left, y: r.bottom }))
            }}
          />
          {colorAnchor && (
            <ColorMenu
              x={colorAnchor.x}
              y={colorAnchor.y}
              value={data.color}
              onPick={(c) => updateNodeData(id, { color: c })}
              onClose={() => setColorAnchor(null)}
            />
          )}

          <span className="service-node__product">{productName}</span>

          {editingLabel ? (
            <input
              className="term-node__title nodrag"
              value={label}
              spellCheck={false}
              autoFocus
              aria-label={`Name for this ${productName}`}
              onChange={(e) => updateNodeData(id, { serviceLabel: e.target.value })}
              // Every exit commits what is on screen — the edits are live, so there is nothing to
              // save — except Escape, which puts back the value editing started with.
              onBlur={() => setEditingLabel(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  setEditingLabel(false)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  updateNodeData(id, { serviceLabel: labelBefore })
                  setEditingLabel(false)
                }
              }}
            />
          ) : (
            <button
              className="service-node__label-text nodrag"
              title="Rename"
              onClick={() => {
                setLabelBefore(label)
                setEditingLabel(true)
              }}
            >
              {label || <span className="service-node__label-empty">Name this {productName.toLowerCase()}…</span>}
            </button>
          )}
        </div>

        {!collapsed && (
          <div className="service-node__body">
            <label className="service-node__field" htmlFor={`${id}-endpoint`}>
              <span className="service-node__field-label">Address</span>
              <input
                id={`${id}-endpoint`}
                className="service-node__input nodrag"
                type="text"
                spellCheck={false}
                placeholder={ENDPOINT_PLACEHOLDER[kind ?? 'proxmox']}
                value={endpointDraft}
                aria-invalid={endpointDraft !== '' && !endpointOk}
                aria-describedby={`${id}-endpoint-note`}
                onChange={(e) => setEndpointDraft(e.target.value)}
                onBlur={commitEndpoint}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitEndpoint()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setEndpointDraft(data.serviceConnection?.endpoint ?? '')
                  }
                }}
              />
            </label>

            {/* Says what is wrong AND what to do about it. A bare red border teaches nothing, and
                the password case in particular needs its reason stated: a user who pasted a URL
                with credentials in it has just been refused for their own benefit and deserves to
                know that rather than assume the field is broken. */}
            <p id={`${id}-endpoint-note`} className="service-node__note">
              {endpointDraft === '' ? (
                <>Not connected. Enter the address of your {productName.toLowerCase()}.</>
              ) : endpointOk ? (
                <>
                  Saved on this machine only — an address is never written into the shared canvas
                  file, so it does not travel to anyone who clones the repository.
                </>
              ) : (
                <>{describeEndpointProblem(endpointDraft)}</>
              )}
            </p>

            <p className="service-node__hint">
              Talking to a real {productName} is not built yet, so this node stores where it would
              connect and nothing more. There is deliberately no button here that looks like it
              would connect.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
