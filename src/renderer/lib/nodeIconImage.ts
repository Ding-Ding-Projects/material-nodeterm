import { useEffect, useState } from 'react'
import type { FsApi } from '@shared/types'
import { nodeIconMime, resolveIconPath, type NodeIcon } from '@shared/node-icon'
import { sessionForProject } from '../session/session'
import { useProjects } from '../state/projects'

const CACHE_MAX = 128
const SRC_MAX_CHARS = 4_000_000
const cache = new Map<string, Promise<string | null>>()
const keyFor = (projectId: string, absPath: string): string => `${projectId}\u0000${absPath}`

export function clearNodeIconCache(): void {
  cache.clear()
}

export function loadNodeIconSrc(fs: FsApi, projectId: string, absPath: string): Promise<string | null> {
  const key = keyFor(projectId, absPath)
  const existing = cache.get(key)
  if (existing) return existing
  const mime = nodeIconMime(absPath)
  if (!mime) return Promise.resolve(null)
  const pending = Promise.resolve()
    .then(() => fs.readBinary(absPath))
    .then((base64) => (base64 && base64.length < SRC_MAX_CHARS ? `data:${mime};base64,${base64}` : null))
    .catch(() => null)
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, pending)
  return pending
}

export function useNodeIconSrc(icon: NodeIcon | undefined, projectId?: string): string | null {
  const activeProjectId = useProjects((state) => state.activeProjectId)
  const pid = projectId ?? activeProjectId
  const storedPath = icon?.type === 'image' ? icon.path : null
  const cwd = useProjects((state) => (pid ? state.getProject(pid)?.cwd : undefined))
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    if (!storedPath || !pid) {
      setSrc(null)
      return
    }
    const absolutePath = resolveIconPath(storedPath, cwd)
    if (!absolutePath) {
      setSrc(null)
      return
    }
    let live = true
    void loadNodeIconSrc(sessionForProject(pid).api.fs, pid, absolutePath).then((value) => {
      if (live) setSrc(value)
    })
    return () => {
      live = false
    }
  }, [storedPath, pid, cwd])

  return src
}
