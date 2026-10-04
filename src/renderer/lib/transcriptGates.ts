import { canChat, type AgentId } from '@shared/agents/config'

/**
 * Does this node's conversation live in a file **claude's** transcript readers can locate and parse?
 *
 * This is the gate for every feature that goes through `core/transcript-ipc.ts`'s
 * `resolveTranscript`: today the find bar's transcript index (`claude.readTranscript`). It is
 * deliberately NOT `hasUsage`.
 *
 * Those two used to share `hasUsage` with the context METER, back when all three were claude-only
 * and the distinction cost nothing. Then codex and gemini joined `USAGE_CAPABLE` (their own
 * transcripts state the numbers a meter needs) and the shared gate turned into a bug in both
 * features at once, because `resolveTranscript` has a **cwd fallback**: when the sessionId leg
 * misses — which it always does for a codex/gemini id, since no `<that id>.jsonl` exists under
 * `~/.claude/projects` — it returns *the newest claude transcript for that cwd*. So a codex node
 * would rehydrate its meter from a stranger's claude session (wrong numerator AND wrong
 * denominator, then flapping against the correct codex tail) and its find bar would present that
 * session's messages as its own hits. Even wired to the right file the reader would be wrong: it
 * parses claude's JSONL shape, which a codex rollout is not.
 *
 * `CHAT_CAPABLE` already states exactly the fact being asked for — "we can read and render this
 * agent's transcript ourselves" — so it is reused here rather than adding a fourth capability list
 * that would mean the same thing.
 *
 * `context.ensure` left this gate: it is gated on the meter's own capability at its call site.
 * Nothing about the danger above changed; what changed is that its handler stopped BEING claude's
 * resolver. `core/context-ensure.ts` routes on the agent id to that agent's OWN locator
 * (`locateCodex` / `locateGemini`, both keyed strictly by session id, with no cwd fallback) and its
 * own tail, so the resolver this function names is reached only by an agent whose transcript it can
 * actually read. The find bar's index has no such routing and therefore has not moved. If you are
 * about to widen a THIRD consumer: route it, do not widen this.
 *
 * The meter itself is fed by the per-agent context tails in the shells (`geminiContextParse` /
 * `codexContextParse`), which need no resolver because the hook envelope hands them the path; the
 * mount-time rehydration gives an idle or resumed Codex/Gemini session its reading without waiting
 * for the next hook event. Grok is the one hook-capable agent still without it, and that is
 * structural: its meter reads a `signals.json` whose directory is learned from a hook event, so after
 * a restart there is no path to rehydrate from.
 */
export function readsClaudeTranscript(agentId: AgentId | undefined): boolean {
  return !!agentId && canChat(agentId)
}
