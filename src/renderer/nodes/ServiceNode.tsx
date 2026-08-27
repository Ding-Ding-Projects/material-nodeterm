import { useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { isServiceNodeKind, type ServiceNodeKind } from '@shared/types'
import { COLLAPSED_HEIGHT, SERVICE_NODE_LABELS, type CanvasNode } from '../state/workspace'
import { ColumnPill } from '../components/kanban/ColumnPill'
import { safeServiceEndpoint } from '@shared/node-exec'
import { nodeBorderStyle, nodeColorStyle } from '../lib/nodeColor'
import { ColorMenu } from '../components/color/ColorMenu'
import { MinecraftServerPanel } from '../components/minecraft/MinecraftServerPanel'
import { DockerHostManagerPanel } from '../components/docker/DockerHostManagerPanel'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapAroundExactFacts } from './nodeVocabulary'

/**
 * One component for the whole service family — Minecraft, Docker, Proxmox, GitLab, Home Assistant
 * and FreePBX. They differ in what they will eventually manage, not in how they behave as canvas
 * objects, so six near-identical components would be six copies of one rule waiting to drift.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO for four of the six kinds, and why the emptiness is the point:
 *
 * Proxmox/GitLab/Home Assistant/FreePBX are not connected to anything yet. CLAUDE.md is
 * explicit that a control which is styled as operable while being inert is a defect rather than a
 * placeholder — "any icon, preview, mock window, toolbar control, card, tab, badge, illustration,
 * affordance ... presented as if it can be used must perform its labeled action". So there is no
 * greyed-out Connect button here, no fake status lamp, and no mock console: the surface says
 * plainly what it is and what it cannot do yet, and both controls it draws — the name and the
 * address — genuinely work and genuinely persist.
 *
 * The address is stored and validated but nothing DIALS it yet, and the copy says exactly that
 * rather than implying a connection. Storing where you would connect is a real, useful thing on
 * its own; pretending it connects would not be.
 *
 * `minecraft` and `dockerhost` are the lanes that wire real managers. See `MinecraftServerPanel`
 * (docs/minecraft-server-manager.md). It runs a real local `java -jar server.jar` process on the
 * and `DockerHostManagerPanel`. Both replace the generic address field entirely rather than growing
 * a fake "Connect" button beside it. When a future lane wires one of the other four kinds, it follows
 * the same pattern: real
 * controls that do exactly what they say, added beside this honest copy rather than instead of it.
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
 * The address of "the Docker daemon on this machine", for the one kind where that shortcut is
 * common enough to earn a button (`dockerhost`).
 *
 * This is NOT the button it looks like it should be. Docker's actual local transports are a Unix
 * domain socket (`/var/run/docker.sock`) on macOS/Linux and a named pipe
 * (`//./pipe/docker_engine`) on Windows — the "differs by platform" case the request that shipped
 * this button called out by name. Neither is representable here: `safeServiceEndpoint` accepts
 * only `http:`, `https:` and `ssh:`, on purpose (see its own comment) — `unix:`/`npipe:` were never
 * on that list, and adding a fifth just for this button would mean the field promises to store
 * something the connection boundary would then silently discard the moment anything reads it.
 *
 * `ssh://localhost` IS representable, and it is the same address on every platform: bare `ssh://`
 * with no `user@` defaults, exactly like the bare `ssh` command, to whoever is currently logged in
 * — there is no per-OS branch to get wrong, and no username to go and ask the shell for. It is
 * honest about being an SSH hop to the local Docker CLI rather than a claim about the daemon's own
 * transport, which is the whole reason a platform-specific pipe/socket path was never on the table.
 */
const LOCAL_DOCKER_ENDPOINT = 'ssh://localhost'

/**
 * Why an address was refused, in words that say what to do next.
 *
 * The password case is the one that has to be explicit. Somebody who pasted a URL with credentials
 * in it has just been refused FOR THEIR OWN BENEFIT, and without a reason they will reasonably
 * conclude the field is broken and go looking for a workaround — which in practice means finding
 * somewhere else to put the password.
 */
function describeEndpointProblem(value: string, map: (text: string) => string = (text) => text): string {
  const trimmed = value.trim()
  let url: URL | null = null
  try {
    url = new URL(trimmed)
  } catch {
    return map('That is not an address yet. It needs a scheme, like https://host or ssh://user@host.')
  }
  if (url.password !== '') {
    return map('Remove the password from the address. It would be saved as plain text, so a password belongs in the system keychain instead — the address itself is stored, the secret is not.')
  }
  if (url.username !== '' && url.protocol !== 'ssh:') {
    return map('Remove the username from the address. Only ssh:// addresses carry one, because there it names the target rather than an identity to log in with.')
  }
  if (!['http:', 'https:', 'ssh:'].includes(url.protocol)) {
    return `${url.protocol} ${map('addresses are not supported here. Use http://, https:// or ssh://.')}`
  }
  if (url.hostname === '') return map('That address has no host.')
  return map('That address cannot be used.')
}
export function ServiceNode({ id, type, data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const { updateNodeData, setNodes } = useReactFlow()
  /** Viewport anchor for the colour surface, or null when closed — coordinates rather than a
  *  boolean because ColorMenu is a body portal. */
  const [colorAnchor, setColorAnchor] = useState<{ x: number; y: number } | null>(null)
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

  /** `overrideValue` lets the "Use localhost" button commit its own value in one click rather than
   *  writing into the draft and hoping a render lands before the user notices — same commit path,
   *  same validation, just fed a value that did not come from the input's own onChange. */
  const commitEndpoint = (overrideValue?: string): void => {
    const trimmed = (overrideValue ?? endpointDraft).trim()
    if (trimmed === '') {
      if (data.serviceConnection) updateNodeData(id, { serviceConnection: undefined })
      return
    }
    // The SAME predicate the storage boundary uses, deliberately. A form that accepted something
    // the store then refused would produce a node that looks configured and is not — the exact
    // silent half-state this component exists to avoid.
    if (!safeServiceEndpoint(trimmed)) return
    if (overrideValue !== undefined) setEndpointDraft(overrideValue)
    updateNodeData(id, {
      serviceConnection: { ...data.serviceConnection, endpoint: trimmed }
    })
  }

  const localEndpoint = kind === 'dockerhost' ? LOCAL_DOCKER_ENDPOINT : undefined
  const isLocalEndpointSet = localEndpoint !== undefined && endpointDraft.trim() === localEndpoint
  // Derived once: the root colours its BORDER, the header a translucent wash of the same value,
  // and rainbow has to reach both or the node animates on one edge and not the other.
  const rootBorder = nodeBorderStyle(data.color)
  const headerTint = nodeColorStyle(data.color, 0.2)
  const productName = kind ? SERVICE_NODE_LABELS[kind] : data.title || 'Service'
  const displayProductName = kind ? productName : data.title ? productName : vocab('Service')
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
        aria-label={label ? `${displayProductName}: ${label}` : `${displayProductName}, ${vocab('no name set')}`}
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
          <button className="term-node__collapse" title={vocab(collapsed ? 'Expand' : 'Collapse')} onClick={toggleCollapse}>
            {collapsed ? '▸' : '▾'}
          </button>
          <button
            className="term-node__color"
            style={{ background: data.color }}
            title={vocab('Color')}
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

          <span className="service-node__product">{displayProductName}</span>

          <EditableNodeTitle
            value={label}
            onChange={(next) => updateNodeData(id, { serviceLabel: next })}
            ariaLabel={`${vocab('Name for this')} ${displayProductName}`}
            title={vocab('Rename')}
            baseTriggerClassName=""
            triggerClassName="service-node__label-text"
            emptyLabel={
              <span className="service-node__label-empty">{vocab('Name this')} {displayProductName.toLowerCase()}…</span>
            }
            rejectEmpty={false}
          />
        </div>

        {!collapsed && kind === 'minecraft' && <MinecraftServerPanel nodeId={id} />}
        {!collapsed && kind === 'dockerhost' && <DockerHostManagerPanel />}

        {!collapsed && kind !== 'minecraft' && kind !== 'dockerhost' && (
          <div className="service-node__body">
            <label className="service-node__field" htmlFor={`${id}-endpoint`}>
              <span className="service-node__field-label">{vocab('Address')}</span>
              <div className="service-node__field-row">
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
                  onBlur={() => commitEndpoint()}
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
                {/* Fills the field with the local Docker daemon's address in one click — it never
                    dials anything itself, per the honesty rule this whole node lives by (see the
                    hint paragraph and LOCAL_DOCKER_ENDPOINT's own comment). Disabled once the field
                    already holds that exact value, so the control never claims there is a further
                    action to take when there is not. The field stays editable afterwards; this is a
                    shortcut into it, not a lock on it. */}
                {localEndpoint !== undefined && (
                  <button
                    type="button"
                    className="service-node__local-btn nodrag"
                    disabled={isLocalEndpointSet}
                    title={
                      isLocalEndpointSet
                        ? mapAroundExactFacts('Address is already set to the local Docker host', ['Docker'], vocab)
                        : mapAroundExactFacts('Fill the address with the local Docker host, reached over SSH', ['Docker', 'SSH'], vocab)
                    }
                    onClick={() => commitEndpoint(localEndpoint)}
                  >
                    {vocab('Use localhost')}
                  </button>
                )}
              </div>
            </label>

            {/* Says what is wrong AND what to do about it. A bare red border teaches nothing, and
                the password case in particular needs its reason stated: a user who pasted a URL
                with credentials in it has just been refused for their own benefit and deserves to
                know that rather than assume the field is broken. */}
            <p id={`${id}-endpoint-note`} className="service-node__note">
              {endpointDraft === '' ? (
                <>{mapAroundExactFacts(`Not connected. Enter the address of your ${productName.toLowerCase()}.`, [productName], vocab)}</>
              ) : endpointOk ? (
                <>
                  {vocab('Saved on this machine only — an address is never written into the shared canvas file, so it does not travel to anyone who clones the repository.')}
                </>
              ) : (
                <>{describeEndpointProblem(endpointDraft, vocab)}</>
              )}
            </p>

            <p className="service-node__hint">
              {mapAroundExactFacts(
                `Talking to a real ${productName} is not built yet, so this node stores where it would connect and nothing more. There is deliberately no button here that looks like it would connect.`,
                [productName],
                vocab
              )}
            </p>
          </div>
        )}
      </div>
    </>
  )
}
