import { useEffect, useState } from 'react'

let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  timer ??= setInterval(() => {
    now = Date.now()
    for (const notify of listeners) notify()
  }, 5_000)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useContextClock(enabled: boolean): number {
  const [value, setValue] = useState(now)
  useEffect(() => (enabled ? subscribe(() => setValue(now)) : undefined), [enabled])
  return value
}
