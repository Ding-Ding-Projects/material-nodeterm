// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentContinuationApi,
  AgentContinuationPreview,
  AgentContinuationResult
} from '@shared/agent-continuation'
import { AgentContinuationReview } from './AgentContinuationReview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const packet: AgentContinuationPreview = {
  nodeId: 'node-1',
  provider: 'codex',
  sessionId: 'session-1',
  summary: 'Recovered summary',
  preview: 'Recovered preview',
  warning: 'Review the recovered summary before continuing. Earlier side effects may already exist.',
  updatedAt: 1,
  acknowledged: false
}

function apiFor(overrides: Partial<AgentContinuationApi> = {}): AgentContinuationApi {
  const result: AgentContinuationResult = { ok: true, packet }
  return {
    summary: vi.fn(async () => [packet]),
    preview: vi.fn(async () => packet),
    ack: vi.fn(async () => true),
    discard: vi.fn(async () => true),
    continue: vi.fn(async () => result),
    onUpdate: vi.fn(() => () => {}),
    ...overrides
  }
}

describe('AgentContinuationReview', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    ;(window as unknown as { nodeTerminal?: unknown }).nodeTerminal = {}
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
  })

  it('does not inject or continue merely because the review card mounts', async () => {
    const api = apiFor()
    await act(async () => {
      root.render(<AgentContinuationReview nodeId="node-1" api={api} enabled />)
      await Promise.resolve()
    })

    expect(host.textContent).toContain('Recovered summary')
    expect(api.continue).not.toHaveBeenCalled()
  })

  it('does not even read a packet while cold-relaunch review is disabled', async () => {
    const api = apiFor()
    await act(async () => {
      root.render(<AgentContinuationReview nodeId="node-1" api={api} enabled={false} />)
      await Promise.resolve()
    })

    expect(api.preview).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')
  })

  it('only submits after the user activates Review and continue', async () => {
    const api = apiFor()
    await act(async () => {
      root.render(<AgentContinuationReview nodeId="node-1" api={api} enabled />)
      await Promise.resolve()
    })
    const continueButton = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Review and continue')
    ) as HTMLButtonElement

    await act(async () => {
      continueButton.click()
      await Promise.resolve()
    })

    expect(api.continue).toHaveBeenCalledWith('node-1')
  })
})
