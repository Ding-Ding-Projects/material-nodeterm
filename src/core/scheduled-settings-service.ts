// Orchestrates the scheduled-settings feature: on a bounded background tick, refreshes every
// enabled rule's external source (api / home-assistant), re-resolves which rule (if any) is
// active right now, and broadcasts the result to every attached UI. Runs identically on the
// Electron main process and the Server Edition (both instantiate this the same way — see
// src/main/index.ts / src/server/index.ts), because it only ever talks to the world through
// `platform()`.
import { IPC } from '../shared/ipc'
import { platform } from './platform'
import type { ScheduledSettingsStore } from './scheduled-settings-store'
import {
  resolveActiveSchedule,
  scheduleWindowActiveAt,
  SCHEDULED_SETTINGS_REFRESH_INTERVAL_MS,
  type RuleSourceState,
  type RuleSourceStates,
  type ScheduleRule,
  type ScheduleSource,
  type ScheduledSettingsFile,
  type ScheduledSettingsActiveState,
  type SchedulableSettingsPatch
} from '../shared/scheduled-settings'
import {
  fetchApiSettingsSource,
  fetchHomeAssistantState,
  type ApiFetchResult,
  type HaFetchResult
} from './scheduled-settings-network'
import {
  setHomeAssistantToken,
  getHomeAssistantToken,
  homeAssistantTokenStatus,
  pruneOrphanedTokens
} from './scheduled-settings-secrets'

/** How often the background refresh sweep runs. A rule ALSO refreshes immediately the moment its
 *  window transitions from inactive to active ("refresh on activation" — see `tick`), so this
 *  interval only governs the steady re-check while a rule stays enabled with an external source. */
const TICK_MS = 30_000

type ScheduledSettingsStorePort = Pick<ScheduledSettingsStore, 'get' | 'loadState' | 'onChange'>

export interface ScheduledSettingsServiceDependencies {
  now(): number
  fetchApiSettingsSource(url: string, timeoutMs?: number): Promise<ApiFetchResult>
  fetchHomeAssistantState(baseUrl: string, entityId: string, token: string): Promise<HaFetchResult>
  setHomeAssistantToken(ruleId: string, token: string | null): Promise<void>
  getHomeAssistantToken(ruleId: string): Promise<string | null>
  homeAssistantTokenStatus(ruleIds: readonly string[]): Promise<Record<string, boolean>>
  pruneOrphanedTokens(liveRuleIds: ReadonlySet<string> | readonly string[]): Promise<void>
}

const DEFAULT_DEPENDENCIES: ScheduledSettingsServiceDependencies = {
  now: Date.now,
  fetchApiSettingsSource,
  fetchHomeAssistantState,
  setHomeAssistantToken,
  getHomeAssistantToken,
  homeAssistantTokenStatus,
  pruneOrphanedTokens
}

function sourceKey(source: ScheduleSource): string {
  switch (source.kind) {
    case 'local':
      return JSON.stringify(['local'])
    case 'api':
      return JSON.stringify(['api', source.url, source.timeoutMs ?? null])
    case 'home-assistant':
      return JSON.stringify(['home-assistant', source.baseUrl, source.entityId])
  }
}

interface InFlightRefresh {
  generation: number
  sourceKey: string
  promise: Promise<void>
}

export class ScheduledSettingsService {
  private readonly states: RuleSourceStates = {}
  /** Per-rule fetch generation: a fetch whose generation is no longer current when it completes —
   *  because a newer fetch started, or the rule was removed/retargeted — is discarded. This is the
   *  brief's "generation or cancellation guard": a slow, stale response can never overwrite a
   *  newer one. */
  private readonly generations = new Map<string, number>()
  /** Exactly one external check owns a rule/source generation. A 31-second check must not be
   *  replaced every 30-second tick forever, and a stale check's `finally` must not release the
   *  newer source's slot after a retarget. */
  private readonly inFlight = new Map<string, InFlightRefresh>()
  private readonly windowWasActive = new Map<string, boolean>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastPushSignature: string | null = null
  private unsubscribeStore: (() => void) | null = null
  private credentialPruneInFlight: Promise<void> | null = null

  private readonly dependencies: ScheduledSettingsServiceDependencies

  constructor(
    private readonly store: ScheduledSettingsStorePort,
    dependencies: Partial<ScheduledSettingsServiceDependencies> = {}
  ) {
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies }
  }

  start(): void {
    this.unsubscribeStore = this.store.onChange((file, previous) => this.onFileChanged(file, previous))
    this.registerIpc()
    this.retryOrphanedCredentialPrune()
    this.tick() // recompute (and kick off any due refreshes) immediately — don't wait 30s at boot
    this.timer = setInterval(() => {
      this.retryOrphanedCredentialPrune()
      this.tick()
    }, TICK_MS)
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.unsubscribeStore?.()
    this.unsubscribeStore = null

    // Startup/interval cleanup owns a SQLite handle until its transaction settles. Shutdown must
    // drain that bounded owner before a shell removes or reuses userData; otherwise Windows can
    // observe an EPERM/EBUSY sidecar even though the service has stopped scheduling new work.
    // Background cleanup already reports its own warning, so a prior failure must not turn an
    // otherwise orderly shell shutdown into a rejection.
    const prune = this.credentialPruneInFlight
    if (prune) {
      try {
        await prune
      } catch {
        // The retry warning is emitted by retryOrphanedCredentialPrune's attached handler.
      }
    }
  }

  private invalidateSource(ruleId: string): void {
    // Never delete/reset a generation number. An old check for a removed rule can still be alive;
    // re-adding the same id must receive a genuinely newer generation rather than accidentally
    // recreating the old number and accepting its response.
    this.generations.set(ruleId, (this.generations.get(ruleId) ?? 0) + 1)
    this.inFlight.delete(ruleId)
    delete this.states[ruleId]
    this.windowWasActive.delete(ruleId)
  }

  private async onFileChanged(file: ScheduledSettingsFile, previous: ScheduledSettingsFile): Promise<void> {
    const previousById = new Map(previous.rules.map((rule) => [rule.id, rule]))
    const nextById = new Map(file.rules.map((rule) => [rule.id, rule]))
    const allIds = new Set([...previousById.keys(), ...nextById.keys()])

    for (const id of allIds) {
      const before = previousById.get(id)
      const after = nextById.get(id)
      // Compare the complete external-source identity, not only its kind. URL A -> URL B and HA
      // entity A -> entity B are security-relevant retargets: cached A and an in-flight A response
      // must disappear before B gets its immediate refresh.
      if (!before || !after || sourceKey(before.source) !== sourceKey(after.source)) {
        this.invalidateSource(id)
      }
    }

    try {
      await this.prunePublishedCredentials(file)
    } finally {
      // Recompute even when cleanup is incomplete. The store surfaces that failure, while the
      // running schedule must still reflect the file that was successfully published.
      this.tick()
    }
  }

  /** Save-triggered cleanup must run after any older background attempt, then own a fresh prune
   * for the schedule that was actually published. A background failure is retried here rather
   * than being mistaken for this save's result. */
  private async prunePublishedCredentials(file: ScheduledSettingsFile): Promise<void> {
    while (this.credentialPruneInFlight) {
      const previous = this.credentialPruneInFlight
      try {
        await previous
      } catch {
        // Background cleanup reports its own warning. This publication still needs its own
        // current-ID attempt, whose failure is propagated to the store.
      }
    }
    // A failed load deliberately installs a safe empty cache. It is not evidence that no rules
    // exist, so it can never authorize deleting credential files.
    if (!this.store.loadState().ok) return
    await this.startCredentialPrune(
      new Set(file.rules.filter((rule) => rule.source.kind === 'home-assistant').map((rule) => rule.id))
    )
  }

  private startCredentialPrune(liveIds: ReadonlySet<string>): Promise<void> {
    if (this.credentialPruneInFlight) {
      throw new Error('A scheduled credential cleanup already owns the mutation boundary.')
    }
    const run: Promise<void> = Promise.resolve()
      .then(() => this.dependencies.pruneOrphanedTokens(liveIds))
      .finally(() => {
        if (this.credentialPruneInFlight === run) this.credentialPruneInFlight = null
      })
    this.credentialPruneInFlight = run
    return run
  }

  /** Retry startup/crash-gap residue even when no later schedule edit occurs. The awaited save
   * path reports failures inline; background retries are bounded to one operation and avoid
   * logging credential paths or ids. */
  private retryOrphanedCredentialPrune(): void {
    if (this.credentialPruneInFlight) return
    const load = this.store.loadState()
    if (!load.ok) return
    const liveIds = new Set(
      load.file.rules
        .filter((rule) => rule.source.kind === 'home-assistant')
        .map((rule) => rule.id)
    )
    const run = this.startCredentialPrune(liveIds)
    void run.catch(() => {
      console.warn('[scheduled-settings] orphaned credential cleanup is incomplete; retrying')
    })
  }

  private registerIpc(): void {
    platform().handle(IPC.scheduledSettingsSetHaToken, async (ruleId: string, token: string | null) => {
      try {
        await this.dependencies.setHomeAssistantToken(ruleId, token)
      } finally {
        // A credential mutation can change canonical state and then reject while cleaning an
        // alternate artifact. Invalidate for every settled attempt so a partially-applied Clear
        // cannot retain cached `on` state or accept an older bearer response.
        this.invalidateSource(ruleId)
        this.recomputeAndBroadcast()
        this.tick()
      }
    })
    // Deliberately no "get token" handler anywhere in this file — only a status boolean ever
    // crosses the IPC boundary. See scheduled-settings-secrets.ts's doc on getHomeAssistantToken.
    platform().handle(IPC.scheduledSettingsTokenStatus, () =>
      this.dependencies.homeAssistantTokenStatus(this.store.get().rules.map((r) => r.id))
    )
    platform().handle(IPC.scheduledSettingsRefreshRule, (ruleId: string) => this.refreshRuleById(ruleId))
    platform().handle(IPC.scheduledSettingsActiveState, () => this.currentState())
  }

  /** The explicit "Retry" affordance in the Settings UI. */
  private async refreshRuleById(ruleId: string): Promise<void> {
    const rule = this.store.get().rules.find((r) => r.id === ruleId)
    if (!rule) return
    await this.refreshRule(rule)
    this.recomputeAndBroadcast()
  }

  private tick(): void {
    const file = this.store.get()
    const now = this.dependencies.now()
    const refreshes: Promise<void>[] = []
    for (const rule of file.rules) {
      if (!rule.enabled || rule.source.kind === 'local') continue
      const active = scheduleWindowActiveAt(rule.window, now, file.timezone)
      const wasActive = this.windowWasActive.get(rule.id) ?? false
      const justActivated = active && !wasActive
      this.windowWasActive.set(rule.id, active)
      const state = this.states[rule.id]
      const stale = !state?.lastAttemptMs || now - state.lastAttemptMs >= SCHEDULED_SETTINGS_REFRESH_INTERVAL_MS
      if (justActivated || stale) refreshes.push(this.refreshRule(rule))
    }
    // Recompute once now (so a currently-cached value is reflected immediately) and again once
    // any refreshes this tick land (so a completed fetch doesn't wait for the NEXT tick to show).
    this.recomputeAndBroadcast()
    if (refreshes.length) void Promise.allSettled(refreshes).then(() => this.recomputeAndBroadcast())
  }

  private async refreshRule(rule: ScheduleRule): Promise<void> {
    if (rule.source.kind === 'local') return
    const key = sourceKey(rule.source)
    const currentRule = this.store.get().rules.find((candidate) => candidate.id === rule.id)
    if (!currentRule || sourceKey(currentRule.source) !== key) return

    const generation = this.generations.get(rule.id) ?? 0
    const existing = this.inFlight.get(rule.id)
    if (existing && existing.generation === generation && existing.sourceKey === key) {
      return existing.promise
    }

    const owner: InFlightRefresh = {
      generation,
      sourceKey: key,
      promise: Promise.resolve()
    }
    // Defer the check one microtask so ownership is published before an injected/test fetcher can
    // synchronously re-enter this service.
    owner.promise = Promise.resolve()
      .then(() => this.runRefresh(rule, owner))
      .finally(() => {
        // An invalidated old check must not clear the newer source generation's in-flight slot.
        if (this.inFlight.get(rule.id) === owner) this.inFlight.delete(rule.id)
      })
    this.inFlight.set(rule.id, owner)
    return owner.promise
  }

  private ownsRefresh(ruleId: string, owner: InFlightRefresh): boolean {
    if (this.inFlight.get(ruleId) !== owner) return false
    if ((this.generations.get(ruleId) ?? 0) !== owner.generation) return false
    const current = this.store.get().rules.find((rule) => rule.id === ruleId)
    return current !== undefined && sourceKey(current.source) === owner.sourceKey
  }

  private async runRefresh(rule: ScheduleRule, owner: InFlightRefresh): Promise<void> {
    if (!this.ownsRefresh(rule.id, owner)) return
    const now = this.dependencies.now()
    let result: { ok: boolean; error?: string; values?: SchedulableSettingsPatch; on?: boolean } | null
    try {
      result =
        rule.source.kind === 'api'
          ? await this.dependencies.fetchApiSettingsSource(rule.source.url, rule.source.timeoutMs)
          : await this.fetchHa(rule, owner)
    } catch {
      result = {
        ok: false,
        error:
          rule.source.kind === 'home-assistant'
            ? 'The stored Home Assistant token could not be read.'
            : 'The scheduled source check failed.'
      }
    }
    // `null` is a deliberately abandoned HA token-read barrier, not a source failure. The source
    // was invalidated while the token was being read, so it owns no status update at all.
    if (!result || !this.ownsRefresh(rule.id, owner)) return

    const previous = this.states[rule.id]
    const next: RuleSourceState = {
      hasValue: previous?.hasValue ?? false,
      values: previous?.values,
      on: previous?.on,
      lastSuccessMs: previous?.lastSuccessMs,
      lastAttemptOk: result.ok,
      lastAttemptMs: now,
      error: result.ok ? undefined : result.error
    }
    if (result.ok) {
      next.hasValue = true
      next.lastSuccessMs = now
      if (rule.source.kind === 'api') next.values = result.values
      else next.on = result.on
    }
    // Otherwise: leave hasValue/values/on/lastSuccessMs exactly as they were — "retain the last
    // valid state" on a transient failure, per docs/scheduled-settings.md.
    this.states[rule.id] = next
  }

  private async fetchHa(rule: ScheduleRule, owner: InFlightRefresh): Promise<HaFetchResult | null> {
    if (rule.source.kind !== 'home-assistant') return null
    const token = await this.dependencies.getHomeAssistantToken(rule.id)
    // A clear or retarget can finish while an OS credential-vault read is pending. Check ownership before
    // putting the recovered bearer on a network request, not merely after that request returns.
    if (!this.ownsRefresh(rule.id, owner)) return null
    if (!token) return { ok: false, error: 'No access token saved for this rule.' }
    return this.dependencies.fetchHomeAssistantState(rule.source.baseUrl, rule.source.entityId, token)
  }

  private currentState(): ScheduledSettingsActiveState {
    const file = this.store.get()
    const now = this.dependencies.now()
    const resolved = resolveActiveSchedule(file, now, this.states)
    const sources: ScheduledSettingsActiveState['sources'] = {}
    for (const rule of file.rules) {
      if (rule.source.kind === 'local') continue
      const s = this.states[rule.id]
      sources[rule.id] = {
        ok: s?.hasValue === true,
        lastAttemptMs: s?.lastAttemptMs,
        lastSuccessMs: s?.lastSuccessMs,
        error: s && s.lastAttemptOk === false ? s.error : undefined
      }
    }
    return {
      computedAtMs: now,
      active: resolved ? { ruleId: resolved.ruleId, values: resolved.values, effects: resolved.effects } : null,
      sources
    }
  }

  private recomputeAndBroadcast(): void {
    const state = this.currentState()
    // Cheap de-dupe: without it, every 30s tick re-broadcasts and re-triggers
    // `applyScheduleOverride` in every attached renderer even when literally nothing changed.
    const signature = JSON.stringify({ active: state.active, sources: state.sources })
    if (signature === this.lastPushSignature) return
    this.lastPushSignature = signature
    platform().broadcast(IPC.scheduledSettingsActiveChange, state)
  }
}
