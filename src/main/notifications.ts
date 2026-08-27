// Electron garbage-collects Notification objects nothing references (electron/electron#16922):
// the notification still shows, but once the wrapper is collected its 'click' handler is gone —
// clicking then only activates the app (macOS default) instead of running our focus logic.
// Retain every shown notification here until the OS reports it dismissed.

// Structural view of Electron's Notification (keeps this module electron-free and unit-testable).
export interface NotificationLike {
  on(event: 'click' | 'close' | 'failed', cb: () => void): void
}

export interface NativeNotificationCopy {
  title: string
  body: string
}

export type PreparedNativeNotification = {
  title: string
  body: string
  titleKind: 'authored' | 'fact'
  bodyKind: 'authored' | 'fact'
}

export function isPreparedNativeNotification(payload: {
  title?: unknown
  body?: unknown
  titleKind?: unknown
  bodyKind?: unknown
}): payload is PreparedNativeNotification {
  return (
    typeof payload.title === 'string' &&
    typeof payload.body === 'string' &&
    (payload.titleKind === 'authored' || payload.titleKind === 'fact') &&
    (payload.bodyKind === 'authored' || payload.bodyKind === 'fact')
  )
}

export function isPreparedNativeNotification(payload: unknown): payload is PreparedNativeNotification {
  if (!payload || typeof payload !== 'object') return false
  const candidate = payload as {
    title?: unknown
    body?: unknown
    titleKind?: unknown
    bodyKind?: unknown
  }
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.body === 'string' &&
    (candidate.titleKind === 'authored' || candidate.titleKind === 'fact') &&
    (candidate.bodyKind === 'authored' || candidate.bodyKind === 'fact')
  )
}

/** The exact admission helper used by the app IPC handler. Keeping this tiny function beside
 * the structural check gives tests a seam that exercises the same rejection decision without
 * starting Electron's process-wide bootstrap. */
export function prepareNativeNotification(payload: unknown): PreparedNativeNotification | null {
  return isPreparedNativeNotification(payload) ? payload : null
}

/** Native notifications receive already-classified copy from the renderer. Keep title and body
 * separate, and never concatenate or map the body here: provider/host facts must survive exactly. */
export function composeNativeNotification(payload: PreparedNativeNotification): NativeNotificationCopy {
  return { title: payload.title, body: payload.body }
}

// Backstop for notifications macOS parks in Notification Center without ever emitting
// 'close' — beyond this, the oldest retained one is dropped (its click stops working,
// which is the pre-fix behavior; anything recent keeps its handler alive).
export const MAX_RETAINED_NOTIFICATIONS = 50

const live = new Set<NotificationLike>()

export function retainUntilDismissed(n: NotificationLike): void {
  live.add(n)
  const release = () => live.delete(n)
  n.on('click', release)
  n.on('close', release)
  n.on('failed', release)
  while (live.size > MAX_RETAINED_NOTIFICATIONS) {
    const oldest = live.values().next().value
    if (!oldest) break
    live.delete(oldest)
  }
}

export function retainedNotificationCount(): number {
  return live.size
}

export function clearRetainedNotifications(): void {
  live.clear()
}
