import { create } from 'zustand'
import type { NotifyPayload } from '../../shared/types'
import { readLocal, writeLocal } from '../lib/localStore'

/**
 * Non-blocking notification system — the store behind the corner-anchored toast stack
 * (`NotificationToasts`) and the reviewable history panel (`NotificationCenter`).
 *
 * Every notification lives here for its whole life: pushed → shown as a toast → dismissed
 * (auto or manual, which only hides the TOAST) → optionally removed (permanently deleted from
 * history). `dismissedAt` is what separates "no longer a toast" from "gone" — the history panel
 * shows dismissed notifications too, exactly like a real notification centre.
 *
 * Safe notification metadata is persisted to localStorage so unread and actionable records
 * survive a reload. Runtime `actions` are live closures and are deliberately omitted from that
 * projection; stable node targets are used for restart-safe actions instead.
 */

export type NotificationKind = 'info' | 'success' | 'progress' | 'warning' | 'error'

/** Notification copy is typed at the producer boundary. Authored prose may use the local
 * vocabulary, while a provider or host fact must remain byte-identical. */
export type NotificationBodyKind = NonNullable<NotifyPayload['bodyKind']>

export interface NotificationAction {
  label: string
  onClick: () => void
}

/** A safe, serializable destination for an actionable notification. Runtime callbacks are
 * deliberately not persisted because closures can capture stale state or private data. */
export interface NotificationTarget {
  nodeId: string
  projectId?: string
}

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  titleKind?: NonNullable<NotifyPayload['titleKind']>
  body?: string
  bodyKind?: NotificationBodyKind
  createdAt: number
  /** null while still shown as a toast (or never dismissed); a timestamp once dismissed. */
  dismissedAt: number | null
  read: boolean
  actions?: NotificationAction[]
  /** ms until auto-dismiss. Errors and warnings default to `null` (persist until the user
   *  dismisses them) — every other kind gets a sensible default in `push`. */
  autoDismissMs?: number | null
  /** True only for an item pushed already-dismissed by ADHD low stimulation (`silent: true` at
   *  construction, `lib/adhdNotify.ts`). Set once, at push, and never changed afterward — it is
   *  NOT derived from `dismissedAt`, because an ordinary user dismissal also sets that field and
   *  would otherwise be indistinguishable from a quieted delivery in the history panel. */
  deliveredSilently: boolean
  /** Optional local destination for an actionable notification. Only stable ids are persisted. */
  target?: NotificationTarget
  /** Stable key used to coalesce duplicate events from multiple hook paths. */
  dedupeKey?: string
}

export type PushNotificationInput = Omit<
  AppNotification,
  'id' | 'createdAt' | 'dismissedAt' | 'read' | 'deliveredSilently' | 'titleKind' | 'bodyKind'
> & {
  id?: string
  /** Land in history without ever appearing as a toast — pushed already dismissed, still unread,
   *  still counted by the bell. Used by ADHD low stimulation (`lib/adhdNotify.ts`) to remove the
   *  interruption without removing the information. Set at construction rather than by pushing and
   *  then dismissing, so the item is never briefly a live toast in any render. */
  silent?: boolean
  /** Defaults to `authored` for the app's existing titles; host/provider titles opt into `fact`. */
  titleKind?: NonNullable<NotifyPayload['titleKind']>
  /** Defaults to `fact` so existing host/provider errors stay verbatim unless a producer opts into
   * authored copy explicitly. */
  bodyKind?: NotificationBodyKind
  target?: NotificationTarget
  dedupeKey?: string
  /** Coalescing window for repeated events. Defaults to ten seconds when a key is supplied. */
  dedupeWindowMs?: number
}

interface NotificationsState {
  items: AppNotification[]
  push(input: PushNotificationInput): string
  dismiss(id: string): void
  dismissMany(ids: string[]): void
  /** Undo a dismissal — used by the toast's own brief "Undo" affordance is NOT offered (that
   *  would just be a second toast); exposed for the notification centre's "restore to toasts"
   *  action, which re-arms auto-dismiss from now. */
  restore(id: string): void
  remove(id: string): void
  removeMany(ids: string[]): void
  markRead(id: string): void
  markAllRead(ids?: string[]): void
  clearAll(): void
}

/** Errors and warnings persist until dismissed; everything else times out on a sensible
 *  schedule that scales gently with how much there is to read. */
function defaultAutoDismissMs(kind: NotificationKind, body?: string): number | null {
  if (kind === 'warning' || kind === 'error') return null
  if (kind === 'progress') return null // progress notifications resolve into success/error, not a timer
  const base = kind === 'success' ? 4500 : 6000
  return Math.min(base + (body?.length ?? 0) * 20, 12000)
}

/** History is capped so a long session doesn't grow this list forever — the oldest DISMISSED
 *  items are dropped first (a still-live toast is never silently removed out from under the
 *  user, however far the cap has to reach to find something droppable). */
export const NOTIFICATION_STORAGE_KEY = 'nodeterm.notifications.v1'
const NOTIFICATION_STORAGE_CAP = 300
const NOTIFICATION_DEDUPE_WINDOW_MS = 10_000
const HISTORY_CAP = NOTIFICATION_STORAGE_CAP

function safeTarget(value: unknown): NotificationTarget | undefined {
  if (!value || typeof value !== 'object') return undefined
  const target = value as Partial<NotificationTarget>
  if (typeof target.nodeId !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(target.nodeId)) return undefined
  if (target.projectId !== undefined && (typeof target.projectId !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(target.projectId))) return undefined
  return target.projectId ? { nodeId: target.nodeId, projectId: target.projectId } : { nodeId: target.nodeId }
}

function loadPersistedNotifications(): AppNotification[] {
  try {
    const parsed = JSON.parse(readLocal(NOTIFICATION_STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is Partial<AppNotification> => !!value && typeof value === 'object')
      .map((value): AppNotification | null => {
        const kind = value.kind
        const title = typeof value.title === 'string' ? value.title : ''
        const body = value.body === undefined ? undefined : typeof value.body === 'string' ? value.body : undefined
        if (!['info', 'success', 'progress', 'warning', 'error'].includes(String(kind)) || !title || title.length > 500) return null
        if (body !== undefined && body.length > 4000) return null
        if (typeof value.id !== 'string' || !/^[A-Za-z0-9._-]{1,200}$/.test(value.id)) return null
        if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null
        const dismissedAt = value.dismissedAt === null || value.dismissedAt === undefined || (typeof value.dismissedAt === 'number' && Number.isFinite(value.dismissedAt))
          ? value.dismissedAt ?? null
          : null
        const target = safeTarget(value.target)
        const dedupeKey = value.dedupeKey === undefined ? undefined : typeof value.dedupeKey === 'string' && value.dedupeKey.length <= 400 ? value.dedupeKey : undefined
        return {
          id: value.id,
          kind: kind as NotificationKind,
          title,
          titleKind: value.titleKind === 'authored' || value.titleKind === 'fact' ? value.titleKind : 'authored',
          body,
          bodyKind: value.bodyKind === 'authored' || value.bodyKind === 'fact' ? value.bodyKind : 'fact',
          createdAt: value.createdAt,
          dismissedAt,
          read: value.read === true,
          autoDismissMs: value.autoDismissMs === null || (typeof value.autoDismissMs === 'number' && Number.isFinite(value.autoDismissMs)) ? value.autoDismissMs : null,
          deliveredSilently: value.deliveredSilently === true,
          target,
          dedupeKey
        } satisfies AppNotification
      })
      .filter((value): value is AppNotification => value !== null)
      .slice(-NOTIFICATION_STORAGE_CAP)
  } catch {
    return []
  }
}

function persistNotifications(items: AppNotification[]): void {
  try {
    const serializable = items.slice(-NOTIFICATION_STORAGE_CAP).map(({ actions: _actions, ...item }) => item)
    writeLocal(NOTIFICATION_STORAGE_KEY, JSON.stringify(serializable))
  } catch {
    // Storage can be unavailable or full. The in-memory centre remains usable in that case.
  }
}

function trim(items: AppNotification[]): AppNotification[] {
  if (items.length <= HISTORY_CAP) return items
  const over = items.length - HISTORY_CAP
  const droppable = items
    .map((n, i) => ({ n, i }))
    .filter((x) => x.n.dismissedAt != null)
    .sort((a, b) => (a.n.dismissedAt as number) - (b.n.dismissedAt as number))
    .slice(0, over)
    .map((x) => x.i)
  if (droppable.length === 0) return items // nothing safe to drop yet — let it grow briefly
  const drop = new Set(droppable)
  return items.filter((_, i) => !drop.has(i))
}

let seq = 0
function freshId(): string {
  seq += 1
  return `notif-${Date.now().toString(36)}-${seq}`
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  items: loadPersistedNotifications(),
  push(input) {
    const id = input.id ?? freshId()
    const now = Date.now()
    if (input.dedupeKey) {
      const existing = get().items.find(
        (item) => item.dedupeKey === input.dedupeKey && now - item.createdAt >= 0 && now - item.createdAt < (input.dedupeWindowMs ?? NOTIFICATION_DEDUPE_WINDOW_MS)
      )
      if (existing) return existing.id
    }
    const autoDismissMs =
      input.autoDismissMs !== undefined ? input.autoDismissMs : defaultAutoDismissMs(input.kind, input.body)
    const item: AppNotification = {
      id,
      kind: input.kind,
      title: input.title,
      titleKind: input.titleKind ?? 'authored',
      body: input.body,
      bodyKind: input.bodyKind ?? 'fact',
      actions: input.actions,
      autoDismissMs,
      createdAt: now,
      // Already dismissed = in history, never a toast. `read` stays false either way: the bell
      // still says there is something to look at, which is what keeps "quieter" from becoming
      // "hidden".
      dismissedAt: input.silent ? now : null,
      read: false,
      deliveredSilently: input.silent === true,
      target: safeTarget(input.target),
      dedupeKey: input.dedupeKey
    }
    set((s) => ({ items: trim([item, ...s.items]) }))
    return id
  },
  dismiss(id) {
    set((s) => ({
      items: s.items.map((n) => (n.id === id && n.dismissedAt == null ? { ...n, dismissedAt: Date.now() } : n))
    }))
  },
  dismissMany(ids) {
    const set_ = new Set(ids)
    set((s) => ({
      items: s.items.map((n) => (set_.has(n.id) && n.dismissedAt == null ? { ...n, dismissedAt: Date.now() } : n))
    }))
  },
  restore(id) {
    set((s) => ({ items: s.items.map((n) => (n.id === id ? { ...n, dismissedAt: null } : n)) }))
  },
  remove(id) {
    set((s) => ({ items: s.items.filter((n) => n.id !== id) }))
  },
  removeMany(ids) {
    const set_ = new Set(ids)
    set((s) => ({ items: s.items.filter((n) => !set_.has(n.id)) }))
  },
  markRead(id) {
    set((s) => ({ items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)) }))
  },
  markAllRead(ids) {
    if (ids) {
      const set_ = new Set(ids)
      set((s) => ({ items: s.items.map((n) => (set_.has(n.id) ? { ...n, read: true } : n)) }))
    } else {
      set((s) => ({ items: s.items.map((n) => ({ ...n, read: true })) }))
    }
  },
  clearAll() {
    set({ items: [] })
  }
}))

// Persist only the safe projection above. Runtime action callbacks are intentionally omitted, so
// a restarted app can still show and act on a stable node target without serializing closures or
// transcript data.
useNotifications.subscribe((state) => persistNotifications(state.items))

/** Convenience: push from anywhere without importing the store's setter shape. Used by
 *  non-React code (banners migrated to toasts, IPC-driven notices).
 *
 *  **Prefer `lib/adhdNotify.ts`'s `notify` over this one for anything a person sees.** That is the
 *  same function with ADHD low stimulation applied, and it is what every current call site uses —
 *  this raw export has no production callers left. Importing it directly opts the new call site out
 *  of the mode silently, which is the whole failure the funnel exists to prevent. */
export function notify(input: PushNotificationInput): string {
  return useNotifications.getState().push(input)
}

/** Active (not-yet-dismissed) notifications, newest first — what the toast stack renders. */
export function selectActiveToasts(items: AppNotification[]): AppNotification[] {
  return items.filter((n) => n.dismissedAt == null)
}

export function selectUnreadCount(items: AppNotification[]): number {
  return items.filter((n) => !n.read).length
}
