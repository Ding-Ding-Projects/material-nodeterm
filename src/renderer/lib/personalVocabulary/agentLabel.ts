import { useCallback } from 'react'
import { AGENT_CONFIG, BUILTIN_AGENT_IDS, type AgentId, type BuiltinAgentId } from '@shared/agents/config'
import { useVocabularyMapper } from './useVocabularyText'

/**
 * Map only the shipped label for a built-in agent at a display boundary.
 *
 * Custom agent labels, account names, node titles, and every other caller-owned value are
 * deliberately passed through unchanged. Agent ids remain identifiers and are never translated.
 */
export function mapBuiltinAgentLabel(
  map: (text: string) => string,
  agentId: AgentId | string | undefined,
  fallback?: string
): string {
  if (agentId && (BUILTIN_AGENT_IDS as readonly string[]).includes(agentId)) {
    return map(AGENT_CONFIG[agentId as BuiltinAgentId].label)
  }
  return fallback ?? agentId ?? ''
}

/** Hook form for display sinks that receive an agent id rather than a pre-resolved label. */
export function useBuiltinAgentLabel(): (agentId: AgentId | string | undefined, fallback?: string) => string {
  const map = useVocabularyMapper()
  return useCallback(
    (agentId: AgentId | string | undefined, fallback?: string) => mapBuiltinAgentLabel(map, agentId, fallback),
    [map]
  )
}

