import { create } from 'zustand'

/**
 * Non-blocking notification system — the store behind the corner-anchored toast stack
 * (`NotificationToasts`) and the reviewable history panel (`NotificationCenter`).
 *
 * Every notification lives here for its whole life: pushed → shown as a toast → dismissed
 * (auto or manual, which only hides the TOAST) → optionally removed (permanently deleted from
 * history). `dismissedAt` is what separates "no longer a toast" from "gone" — the history panel
 * shows dismissed notifications too, exactly like a real notification centre.
 *
 * In-memory only (not persisted to localStorage): notifications commonly carry an `actions`
 * array of live closures (retry, undo, open) that cannot survive serialization, and unlike
 * settings this is transient UI state that legitimately resets on relaunch — the same call
 * `agentStatus` makes for its live `state` field.
 */

export type NotificationKind = 'info' | 'success' | 'progress' | 'warning' | 'error'

export interface NotificationAction {
  label: string
  onClick: () => void
}

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body?: string
  createdAt: number
  /** null while still shown as a toast (or never dismissed); a timestamp once dismissed. */
  dismissedAt: number | null
  read: boolean
  actions?: NotificationAction[]
  /** ms until auto-dismiss. Errors and warnings default to `null` (persist until the user
   *  dismisses them) — every other kind gets a sensible default in `push`. */
  autoDismissMs?: number | null
}

export type PushNotificationInput = Omit<
  AppNotification,
  'id' | 'createdAt' | 'dismissedAt' | 'read'
> & { id?: string }

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
const HISTORY_CAP = 300

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

export const useNotifications = create<NotificationsState>((set) => ({
  items: [],
  push(input) {
    const id = input.id ?? freshId()
    const autoDismissMs =
      input.autoDismissMs !== undefined ? input.autoDismissMs : defaultAutoDismissMs(input.kind, input.body)
    const item: AppNotification = {
      id,
      kind: input.kind,
      title: input.title,
      body: input.body,
      actions: input.actions,
      autoDismissMs,
      createdAt: Date.now(),
      dismissedAt: null,
      read: false
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

/** Convenience: push from anywhere without importing the store's setter shape. Used by
 *  non-React code (banners migrated to toasts, IPC-driven notices). */
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
