import { create } from 'zustand'
import type { OAuthCallbackArmResult } from '@shared/types'

export interface RemoteOAuthPrompt {
  ticket: string
  provider: string
  redirectPort: number
  redirectPath: string
  expiresAt: number
  sessionId: string
  error?: string
}

interface OAuthCallbacksState {
  prompts: RemoteOAuthPrompt[]
  add(result: Extract<OAuthCallbackArmResult, { ok: true }>, sessionId: string): void
  setError(ticket: string, error: string): void
  remove(ticket: string): void
}

export const useOAuthCallbacks = create<OAuthCallbacksState>((set) => ({
  prompts: [],
  add(result, sessionId) {
    set((state) => ({
      prompts: [
        ...state.prompts.filter((prompt) => prompt.ticket !== result.ticket),
        {
          ticket: result.ticket,
          provider: result.provider,
          redirectPort: result.redirectPort,
          redirectPath: result.redirectPath,
          expiresAt: result.expiresAt,
          sessionId
        }
      ]
    }))
  },
  setError(ticket, error) {
    set((state) => ({
      prompts: state.prompts.map((prompt) => (prompt.ticket === ticket ? { ...prompt, error } : prompt))
    }))
  },
  remove(ticket) {
    set((state) => ({ prompts: state.prompts.filter((prompt) => prompt.ticket !== ticket) }))
  }
}))
