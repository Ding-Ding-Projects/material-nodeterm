import { create } from 'zustand'

interface SystemCodexAccountState {
  email: string | null
  loaded: boolean
  remoteEmails: Record<string, string | null>
  remoteLoading: Record<string, boolean>
  ensure(): void
  ensureRemote(host: string, projectId: string): void
}

export const useSystemCodexAccount = create<SystemCodexAccountState>((set, get) => ({
  email: null,
  loaded: false,
  remoteEmails: {},
  remoteLoading: {},
  ensure() {
    if (get().loaded) return
    set({ loaded: true })
    void window.nodeTerminal.codexAccounts
      .systemIdentity()
      .then((identity) => set({ email: identity?.email ?? null }))
      .catch(() => {})
  },
  ensureRemote(host, projectId) {
    if (get().remoteLoading[host] || Object.hasOwn(get().remoteEmails, host)) return
    set((state) => ({
      remoteLoading: { ...state.remoteLoading, [host]: true }
    }))
    void window.nodeTerminal.codexAccounts
      .systemIdentity({ projectId })
      .then((identity) =>
        set((state) => ({
          remoteEmails: {
            ...state.remoteEmails,
            [host]: identity?.email ?? null
          },
          remoteLoading: { ...state.remoteLoading, [host]: false }
        }))
      )
      .catch(() =>
        set((state) => ({
          remoteLoading: { ...state.remoteLoading, [host]: false }
        }))
      )
  }
}))
