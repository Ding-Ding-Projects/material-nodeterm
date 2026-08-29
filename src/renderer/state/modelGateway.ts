import { create } from 'zustand'
import type { GatewayModel, ModelGatewaySettings } from '@shared/agents/model-gateway'

export type ModelDiscoveryStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ModelGatewayState {
  models: GatewayModel[]
  status: ModelDiscoveryStatus
  error: string
  discover(settings: ModelGatewaySettings): Promise<void>
  clear(): void
}

let requestSequence = 0

export const useModelGateway = create<ModelGatewayState>((set) => ({
  models: [],
  status: 'idle',
  error: '',
  async discover(settings) {
    const sequence = ++requestSequence
    set({ status: 'loading', error: '' })
    const result = await window.nodeTerminal.agent.discoverModels(settings).catch((error: unknown) => ({
      models: [],
      error: error instanceof Error ? error.message : 'Model discovery failed.'
    }))
    if (sequence !== requestSequence) return
    set({ models: result.models, status: result.error ? 'error' : 'ready', error: result.error ?? '' })
  },
  clear() {
    requestSequence++
    set({ models: [], status: 'idle', error: '' })
  }
}))
