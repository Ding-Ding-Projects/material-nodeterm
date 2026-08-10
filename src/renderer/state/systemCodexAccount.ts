import { create } from 'zustand'

interface SystemCodexAccountState {
  email: string | null
  loaded: boolean
  ensure(): void
}

export const useSystemCodexAccount = create<SystemCodexAccountState>((set, get) => ({
  email: null,
  loaded: false,
  ensure() {
    if (get().loaded) return
    set({ loaded: true })
    void window.nodeTerminal.codexAccounts
      .systemIdentity()
      .then((identity) => set({ email: identity?.email ?? null }))
      .catch(() => {})
  }
}))
