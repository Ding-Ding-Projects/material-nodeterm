/** Human-readable byte size, used by both the file converter and the Ollama manager panels. */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'unknown'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let u = -1
  do {
    v /= 1024
    u++
  } while (v >= 1024 && u < units.length - 1)
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`
}
