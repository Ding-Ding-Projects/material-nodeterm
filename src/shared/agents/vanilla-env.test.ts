import { afterEach, describe, expect, it } from 'vitest'
import { setCustomAgentBaseResolver, vanillaEnvStripPattern } from './config'

afterEach(() => setCustomAgentBaseResolver(null))

describe('vanillaEnvStripPattern', () => {
  it('claude strips provider variables but keeps the managed config directory', () => {
    const re = vanillaEnvStripPattern('claude')!
    expect(re).not.toBeNull()
    expect(re.test('ANTHROPIC_BASE_URL')).toBe(true)
    expect(re.test('ANTHROPIC_AUTH_TOKEN')).toBe(true)
    expect(re.test('ANTHROPIC_API_KEY')).toBe(true)
    expect(re.test('CLAUDE_CODE_OAUTH_TOKEN')).toBe(true)
    expect(re.test('CLAUDE_CONFIG_DIR')).toBe(false)
    expect(re.test('CLAUDE_HOOK_EVENTS')).toBe(false)
  })

  it('codex strips only its two gateway variables', () => {
    const re = vanillaEnvStripPattern('codex')!
    expect(re.test('OPENAI_BASE_URL')).toBe(true)
    expect(re.test('OPENAI_API_KEY')).toBe(true)
    expect(re.test('OPENAI_ORG_ID')).toBe(false)
    expect(re.test('CODEX_HOME')).toBe(false)
  })

  it('copilot strips provider variables but keeps its home and hook values', () => {
    const re = vanillaEnvStripPattern('copilot')!
    expect(re.test('COPILOT_PROVIDER_API_KEY')).toBe(true)
    expect(re.test('COPILOT_PROVIDER_BASE_URL')).toBe(true)
    expect(re.test('COPILOT_HOME')).toBe(false)
    expect(re.test('COPILOT_HOOK_EVENTS')).toBe(false)
  })

  it('agents without a strip pattern return null', () => {
    expect(vanillaEnvStripPattern('gemini')).toBeNull()
    expect(vanillaEnvStripPattern('grok')).toBeNull()
    expect(vanillaEnvStripPattern('opencode')).toBeNull()
    expect(vanillaEnvStripPattern('custom:plain')).toBeNull()
  })

  it('custom agents inherit the strip pattern from their base harness', () => {
    setCustomAgentBaseResolver((id) => (id === 'custom:proxy' ? 'claude' : undefined))
    const re = vanillaEnvStripPattern('custom:proxy')!
    expect(re.test('ANTHROPIC_BASE_URL')).toBe(true)
    expect(re.test('CLAUDE_CONFIG_DIR')).toBe(false)
  })

  it('caches one compiled expression per source', () => {
    expect(vanillaEnvStripPattern('claude')).toBe(vanillaEnvStripPattern('claude'))
  })
})
