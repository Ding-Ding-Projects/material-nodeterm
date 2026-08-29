import { app, ipcMain, safeStorage, shell, webContents } from 'electron'
import type { CorePlatform } from '../core/platform'
import { mainWindowClientIds, sendToMain } from './main-window'
import { peerRegistry } from './peer-registry'
import { E_NO_HANDLER, rpcErrorDetails, type RpcErr, type RpcOk, type RpcRequest } from '../shared/rpc'
import { IPC } from '../shared/ipc'
import { stripSharedNodeExec } from '../shared/node-exec'
import type {
  RelayPtyCreateDecision,
  RelayPtyCreateSource
} from './relay-pty-create'
import { relayCastAllowed, relayEventAllowed, relayRequestAllowed } from './relay-rpc-policy'

type Handler = { fn: (...args: any[]) => unknown; withSender: boolean }
type Listener = { fn: (...args: any[]) => void; withSender: boolean }

/**
 * Machine-local desktop state that a relay peer must never read or mutate. Keep this check at the
 * dispatch boundary as well as registering the desktop-only profile handlers with raw ipcMain:
 * the second guard means a later refactor cannot expose either surface merely by moving its
 * registration onto CorePlatform. Local renderer calls still travel through ipcMain unchanged.
 */
const RELAY_LOCAL_ONLY_METHODS = new Set<string>([
  IPC.settingsLoad,
  IPC.settingsSave,
  IPC.terminalProfilesList,
  IPC.terminalProfilesRefresh,
  IPC.ptyRecycleConfirmed,
  IPC.ptyExecuteLaunchIntent,
  IPC.workspaceSave,
  // Host-security control plane (registered on raw ipcMain, never on this CorePlatform table, so
  // dispatch's handler lookup already misses them) — listed here too as defense in depth and as
  // the explicit, reviewable statement that a relay peer must never revoke anyone or enumerate who
  // else is trusted.
  IPC.remoteRevokePeer,
  IPC.remoteListApprovedPeers
])

/** Sanitize only the copy crossing into a relay sink; the local window keeps its live overlay. */
function relayEventArgs(channel: string, args: any[]): any[] {
  if (channel !== IPC.workspaceExternalChange) return args
  const project = args[0]
  if (!project || typeof project !== 'object' || !Array.isArray(project.nodes)) return args
  return [{ ...project, nodes: stripSharedNodeExec(project.nodes) }, ...args.slice(1)]
}

/**
 * The Electron platform, with the two extra members a relay PEER needs (they are deliberately NOT
 * on CorePlatform: the core never dispatches, only the shell that owns the socket does — exactly as
 * attach/detach/dispatch are extras on ServerPlatform).
 */
export interface ElectronPlatform extends CorePlatform {
  /** Answer one peer RPC request from the recorded handler table. The peer's clientId is the
   *  sender, so handleWithSender attributes it correctly. Never rejects: a missing handler is
   *  E_NO_HANDLER and a throwing handler is E_HANDLER, so the peer's `await` always settles. */
  dispatch(
    clientId: number,
    req: RpcRequest,
    source?: RelayPtyCreateSource
  ): Promise<RpcOk | RpcErr>
  /** Fire one peer cast at every listener on that channel, in registration order. */
  cast(clientId: number, method: string, args: unknown[]): void
}

export interface ElectronPlatformOptions {
  /** Relay-only authority rewriter. Native ipcMain calls deliberately bypass this seam. */
  authorizeRelayPtyCreate?: (
    raw: unknown,
    source: RelayPtyCreateSource
  ) => RelayPtyCreateDecision | Promise<RelayPtyCreateDecision>
}

/**
 * The Electron shell's CorePlatform. Getters keep app.getPath lazy (safe pre-ready).
 *
 * A client here is EITHER a webContents (the main window) OR a relay PEER — a phone, or another
 * desktop (4c) — addressed by a UiSink in the peer registry. Everything Stages 1-3 built (presence
 * hub, canvas reflector, terminal co-attach) is already written against CorePlatform and is
 * multi-client; a peer was half-joined only because these three members resolved ids through
 * `webContents.fromId` alone, so every send aimed at one silently no-op'd. Peer ids are minted ≥
 * 1_000_000 (allocateRelayClientId), so they can never collide with a webContents id.
 *
 * SOLO COST: zero. With no peer registered the registry holds an empty Map — `has` is a miss, `ids`
 * is empty — and the webContents path below is the code it replaced, byte for byte.
 */
export function electronPlatform(options: ElectronPlatformOptions = {}): ElectronPlatform {
  // THE INVARIANT (4c + the raw-RPC security boundary): platform().handle/on records a channel so
  // the Server Edition and local renderer can use the shared core implementation, but registration
  // alone NEVER grants a relay peer access. dispatch/cast also require the exact method to appear in
  // relay-rpc-policy.ts's allowlist. This matters for services such as the authenticator: they are
  // correctly registered through CorePlatform for the Server Edition, while relay-api.ts correctly
  // keeps them local to the viewing desktop. Without the second gate, a raw peer frame could skip
  // the renderer's confirmation UI and ask the host core to unseal every secret.
  //
  // A raw `ipcMain.handle` remains invisible to a peer — a peer has no webContents, so its request
  // never travels through ipcMain at all. When adding an intended relay method, update BOTH the
  // relay API builder and the exact allowlist; a newly registered service otherwise fails closed.
  // Core-bound handlers act on this machine's project/session state through platform().handle/on;
  // user-machine or host-security-sensitive operations remain raw ipcMain in src/main/index.ts.
  // Relay pty:create has a second boundary below: even after the method is allowed, the host
  // reconstructs its launch options from host-owned authority before the handler can see them.
  // handle/handleWithSender are ONE handler per channel (last wins, like ipcMain.handle);
  // on/onWithSender are an ordered set of listeners. Mirrors ServerPlatform exactly — a divergence
  // here would be a behavior difference between the two remote surfaces.
  //
  // SOLO COST: one Map.set per boot-time registration. With no peer connected nothing ever reads it.
  const handlers = new Map<string, Handler>()
  const listeners = new Map<string, Set<Listener>>()
  const addListener = (channel: string, listener: Listener): void => {
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
    }
    set.add(listener)
  }

  return {
    get userDataDir() {
      return app.getPath('userData')
    },
    get appVersion() {
      return app.getVersion()
    },
    get isPackaged() {
      return app.isPackaged
    },
    // `<app>/Contents/Resources` when packaged; node_modules/electron/…/Resources in dev (which is
    // why bundledTmuxPath falls back to the repo's own resources/bin).
    get resourcesPath() {
      return process.resourcesPath
    },
    // The ipcMain half of each registration is UNCHANGED — the local window's call is bit-identical
    // to what it was before the table existed (same event-stripping, same sender id).
    handle: (ch, fn) => {
      handlers.set(ch, { fn, withSender: false })
      ipcMain.handle(ch, (_e, ...args) => fn(...args))
    },
    on: (ch, fn) => {
      addListener(ch, { fn, withSender: false })
      ipcMain.on(ch, (_e, ...args) => fn(...args))
    },
    handleWithSender: (ch, fn) => {
      handlers.set(ch, { fn, withSender: true })
      ipcMain.handle(ch, (e, ...args) => fn(e.sender.id, ...args))
    },
    onWithSender: (ch, fn) => {
      addListener(ch, { fn, withSender: true })
      ipcMain.on(ch, (e, ...args) => fn(e.sender.id, ...args))
    },
    async dispatch(clientId, req, source = {}) {
      if (RELAY_LOCAL_ONLY_METHODS.has(req.method)) {
        return {
          t: 'res', id: req.id, ok: false,
          error: {
            code: 'E_FORBIDDEN',
            message: 'machine-local desktop operation is not available to relay peers'
          }
        }
      }
      if (req.method.startsWith('githubControl:')) {
        return {
          t: 'res', id: req.id, ok: false,
          error: {
            code: 'E_FORBIDDEN',
            message: 'host-control method is not available to relay peers'
          }
        }
      }
      if (!relayRequestAllowed(req.method)) {
        return {
          t: 'res', id: req.id, ok: false,
          error: {
            code: 'E_FORBIDDEN',
            message: 'method is not available to relay peers'
          }
        }
      }
      const h = handlers.get(req.method)
      if (!h) {
        return {
          t: 'res', id: req.id, ok: false,
          error: { code: E_NO_HANDLER, message: `no handler for ${req.method}` }
        }
      }
      try {
        let args = req.args
        if (req.method === IPC.ptyCreate) {
          const authorize = options.authorizeRelayPtyCreate
          if (!authorize) {
            return {
              t: 'res', id: req.id, ok: false,
              error: {
                code: 'E_FORBIDDEN',
                message: 'relay terminal launch authority is unavailable'
              }
            }
          }
          let decision: RelayPtyCreateDecision
          try {
            decision = await authorize(args[0], source)
          } catch {
            return {
              t: 'res', id: req.id, ok: false,
              error: {
                code: 'E_FORBIDDEN',
                message: 'host terminal authority could not validate this launch'
              }
            }
          }
          if (!decision.ok) {
            return {
              t: 'res', id: req.id, ok: false,
              error: { code: 'E_FORBIDDEN', message: decision.message }
            }
          }
          // `pty:create` has one argument. Reconstruct the array as well as the object so a hostile
          // peer cannot smuggle a future positional execution option past the authority rewriter.
          args = [decision.options]
        }
        const result = h.withSender ? await h.fn(clientId, ...args) : await h.fn(...args)
        return { t: 'res', id: req.id, ok: true, result: result ?? null }
      } catch (err) {
        return {
          t: 'res', id: req.id, ok: false,
          error: {
            code: 'E_HANDLER',
            message: err instanceof Error ? err.message : String(err),
            ...(rpcErrorDetails(err) ? { details: rpcErrorDetails(err) } : {})
          }
        }
      }
    },
    cast(clientId, method, args) {
      // A peer chooses the tunnel frame shape. Do not rely on an invoke-only preload contract:
      // sending a forged CAST for a machine-local channel must remain inert even if a future
      // refactor accidentally registers a listener with the same name.
      if (RELAY_LOCAL_ONLY_METHODS.has(method) || method.startsWith('githubControl:')) return
      // Casts have no reply channel, so a forbidden raw cast is dropped. Apply the same default-deny
      // rule as dispatch before even looking up a listener: registering a future machine-global
      // listener must not silently create a peer-reachable mutation path.
      if (!relayCastAllowed(method)) return
      const set = listeners.get(method)
      if (!set) return
      for (const l of set) {
        // A cast has no reply channel (unlike dispatch, which returns E_HANDLER), so isolate each
        // listener: one throw must not skip the rest — a broken attribution listener would
        // otherwise swallow the peer's keystrokes. Log it, keep going. (Mirrors ServerPlatform.)
        try {
          if (l.withSender) l.fn(clientId, ...args)
          else l.fn(...args)
        } catch (err) {
          console.warn(
            `[peer] cast listener for ${method} threw`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }
    },
    sendTo: (id, ch, ...args) => {
      // A peer id resolves to a UiSink (RPC-framed; pty:data goes out as a binary frame, with the
      // registry's WS backpressure). Everything else is a webContents, dispatched natively.
      const peers = peerRegistry()
      if (peers.has(id)) {
        // CorePlatform is shared by session-scoped and machine-global services. A direct event to a
        // peer must pass the same exact surface review as an inbound method; registration or client
        // attribution alone is not authorization to expose host-global state.
        if (!relayEventAllowed(ch)) return
        peers.sendTo(id, ch, ...relayEventArgs(ch, args))
        return
      }
      const wc = webContents.fromId(id)
      if (wc && !wc.isDestroyed()) wc.send(ch, ...args)
    },
    broadcast: (ch, ...args) => {
      sendToMain(ch, ...args) // the main window, exactly as before
      // …plus every relay peer. Not optional: presence diffs (presence:peer) and canvas mutations
      // fan out via broadcast, so a peer that only received sendTo would still see nothing.
      const peers = peerRegistry()
      if (peers.size === 0) return // solo desktop: no ids() array, no loop — allocation-free
      // The local renderer always receives its own machine's event above. Only the peer fan-out is
      // filtered, so adding the boundary cannot disable host UI updates.
      if (!relayEventAllowed(ch)) return
      for (const id of peers.ids()) {
        // One peer must never break the fan-out. UiSinkRegistry.sendTo already contains a throwing
        // SINK (and evicts a dead one), so this only catches the rest of the path — the flow
        // controller it may call into. Either way the invariant is the same: an exception here
        // would skip every peer after this one AND unwind into the emitter (presenceHub.emit, the
        // canvas reflector), freezing the HOST's own presence/canvas over someone else's socket.
        try {
          peers.sendTo(id, ch, ...relayEventArgs(ch, args))
        } catch (err) {
          console.warn(
            `[peer] broadcast of ${ch} to peer ${id} failed`,
            err instanceof Error ? err.message : String(err)
          )
        }
      }
    },
    clientIds: () => [...mainWindowClientIds(), ...peerRegistry().ids()],
    openExternal: (url) => shell.openExternal(url),
    // Seal / unseal node secrets at rest with the OS keychain. Byte-in byte-out, mirroring #167's
    // codex-node-auth-key.json shape: encrypt the UTF-8 content of the passed buffer, decrypt back to
    // the same bytes. Both are supplied together (a shell must supply BOTH hooks or NEITHER — see
    // CorePlatform). If the keychain is unavailable safeStorage throws, which node-auth-secret.ts
    // surfaces as a rejected load; both shells catch that and run legacy (fail-open), never crash.
    sealSecret: (b) => safeStorage.encryptString(b.toString('utf8')),
    unsealSecret: (b) => Buffer.from(safeStorage.decryptString(b), 'utf8'),
  }
}
