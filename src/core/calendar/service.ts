import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { renameAtomic, tempNameFor } from "../fs-atomic";
import type {
  CalendarAccount,
  CalendarApi,
  CalendarCache,
  CalendarCreateInput,
  CalendarEvent,
  CalendarNodeConfig,
  CalendarOAuthStart,
  CalendarProvider,
  CalendarRemoveInput,
  CalendarRestoreInput,
  CalendarSource,
  CalendarStatus,
  CalendarUpdateInput,
} from "../../shared/calendar";
import {
  assertCalendarConfig,
  isCalendarNodeId,
  parseIcsDetailed,
  validateCalendarEvent,
} from "../../shared/calendar";
import { LocalHistoryStore } from "../local-history";

interface LocalNodeFile {
  version: 1;
  nodeId: string;
  sourceId: string;
  sourceName: string;
  events: CalendarEvent[];
  fetchedAt: number;
  importReport: ReturnType<typeof parseIcsDetailed>["report"] | null;
}
const CACHE_TTL = 15 * 60_000;
const MAX_SOURCE_NAME = 200;

function sourceIdForIcs(
  nodeId: string,
  sourceName: string,
  text: string,
): string {
  return `ics-${nodeId}-${createHash("sha256").update(`${sourceName}\n`).update(text).digest("hex").slice(0, 24)}`;
}
function newEventId(): string {
  return `local-${Date.now().toString(36)}-${createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 12)}`;
}
function validSourceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(local|ics-[a-z][a-z0-9-]{1,120}-[0-9a-f]{24})$/.test(value)
  );
}
function validReport(value: unknown): value is LocalNodeFile["importReport"] {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    Number.isInteger(r.accepted) &&
    Number.isInteger(r.skipped) &&
    Number.isInteger(r.rejected) &&
    Array.isArray(r.issues) &&
    r.issues.length <= 10000 &&
    r.issues.every(
      (issue) =>
        !!issue &&
        typeof issue === "object" &&
        Object.keys(issue as object)
          .sort()
          .join("|") === "action|reason|uid" &&
        ((issue as Record<string, unknown>).uid === null ||
          typeof (issue as Record<string, unknown>).uid === "string") &&
        typeof (issue as Record<string, unknown>).reason === "string" &&
        ["skipped", "rejected"].includes(
          (issue as Record<string, unknown>).action as string,
        ),
    )
  );
}

export class CalendarService implements CalendarApi {
  private readonly root: string;
  private readonly accountsFile: string;
  private readonly sourcesFile: string;
  private readonly history: LocalHistoryStore;
  private readonly mutationQueues = new Map<string, Promise<void>>();
  private sourceWrite: Promise<void> = Promise.resolve();
  private ownerClaimed = false;
  private ownerClaimInFlight: Promise<void> | null = null;
  constructor(userDataDir: string) {
    this.root = path.join(userDataDir, "calendar-nodes");
    this.accountsFile = path.join(userDataDir, "calendar-accounts.json");
    this.sourcesFile = path.join(userDataDir, "calendar-sources.json");
    this.history = new LocalHistoryStore(userDataDir);
  }
  private file(nodeId: string): string {
    if (!isCalendarNodeId(nodeId))
      throw new Error("Calendar node id is invalid.");
    return path.join(this.root, `${nodeId}.json`);
  }
  private async read(nodeId: string): Promise<LocalNodeFile> {
    try {
      const parsed = JSON.parse(
        await readFile(this.file(nodeId), "utf8"),
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Calendar cache is not an object.");
      const value = parsed as Record<string, unknown>;
      const keys = Object.keys(value).sort();
      const expected = [
        "events",
        "fetchedAt",
        "importReport",
        "nodeId",
        "sourceId",
        "sourceName",
        "version",
      ];
      if (
        keys.length !== expected.length ||
        keys.some((key, index) => key !== expected[index])
      )
        throw new Error("Calendar cache has unsupported fields.");
      if (
        value.version !== 1 ||
        value.nodeId !== nodeId ||
        !validSourceId(value.sourceId) ||
        typeof value.sourceName !== "string" ||
        value.sourceName.length > MAX_SOURCE_NAME ||
        !Array.isArray(value.events) ||
        value.events.length > 10000 ||
        !value.events.every(validateCalendarEvent) ||
        typeof value.fetchedAt !== "number" ||
        !Number.isFinite(value.fetchedAt) ||
        !validReport(value.importReport)
      )
        throw new Error("Calendar cache has an unsupported shape.");
      return value as unknown as LocalNodeFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          version: 1,
          nodeId,
          sourceId: "local",
          sourceName: "Local calendar",
          events: [],
          fetchedAt: 0,
          importReport: null,
        };
      throw error;
    }
  }
  private async write(value: LocalNodeFile): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const destination = this.file(value.nodeId);
    const tmp = tempNameFor(destination);
    await writeFile(tmp, JSON.stringify(value), {
      encoding: "utf8",
      mode: 0o600,
    });
    await renameAtomic(tmp, destination);
  }
  private async recordHistory(
    nodeId: string,
    value: LocalNodeFile,
    label: string,
    action: "created" | "updated" | "deleted" | "restored",
  ): Promise<void> {
    await this.history.record({
      domain: `calendar-${nodeId}`,
      filename: "snapshot.json",
      content: JSON.stringify(value),
      label,
      action,
    });
  }
  private async readSources(): Promise<CalendarSource[]> {
    try {
      const parsed = JSON.parse(
        await readFile(this.sourcesFile, "utf8"),
      ) as unknown;
      if (!Array.isArray(parsed) || parsed.length > 1000)
        throw new Error("Calendar source catalog has unsupported shape.");
      return parsed
        .filter((source): source is CalendarSource => {
          if (!source || typeof source !== "object" || Array.isArray(source))
            return false;
          const value = source as Record<string, unknown>;
          const expected = [
            "accountId",
            "color",
            "id",
            "name",
            "provider",
            "readOnly",
            "timezone",
            "writable",
          ];
          return (
            Object.keys(value).sort().join("|") === expected.join("|") &&
            typeof value.id === "string" &&
            value.id.length <= 200 &&
            typeof value.name === "string" &&
            value.name.length <= MAX_SOURCE_NAME &&
            value.provider === "ics" &&
            value.accountId === null &&
            typeof value.color === "string" &&
            /^#[0-9a-f]{6}$/i.test(value.color) &&
            typeof value.timezone === "string" &&
            typeof value.readOnly === "boolean" &&
            typeof value.writable === "boolean"
          );
        })
        .map((source) => ({
          ...source,
          accountId: null,
          provider: "ics",
          readOnly: false,
          writable: true,
        }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  private async registerSource(source: CalendarSource): Promise<void> {
    const prior = this.sourceWrite;
    const run = prior
      .catch(() => undefined)
      .then(async () => {
        const sources = await this.readSources();
        const next = [
          ...sources.filter((entry) => entry.id !== source.id),
          {
            ...source,
            accountId: null,
            provider: "ics" as const,
            readOnly: false,
            writable: true,
          },
        ];
        await mkdir(path.dirname(this.sourcesFile), { recursive: true });
        const tmp = tempNameFor(this.sourcesFile);
        await writeFile(tmp, JSON.stringify(next), {
          encoding: "utf8",
          mode: 0o600,
        });
        await renameAtomic(tmp, this.sourcesFile);
      });
    this.sourceWrite = run;
    await run;
  }
  /** Serialize each node's read-modify-write cycle so concurrent imports and edits cannot lose data. */
  private async withNodeLock<T>(
    nodeId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.claimOwner();
    const previous = this.mutationQueues.get(nodeId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.mutationQueues.set(nodeId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationQueues.get(nodeId) === queued)
        this.mutationQueues.delete(nodeId);
    }
  }
  /** A cache has one writer across processes. Dead owners are recoverable; live owners are not raced. */
  private async claimOwner(): Promise<void> {
    if (this.ownerClaimed) return;
    if (this.ownerClaimInFlight) return this.ownerClaimInFlight;
    this.ownerClaimInFlight = this.claimOwnerNow();
    try {
      await this.ownerClaimInFlight;
    } finally {
      this.ownerClaimInFlight = null;
    }
  }
  private async claimOwnerNow(): Promise<void> {
    if (this.ownerClaimed) return;
    await mkdir(this.root, { recursive: true });
    const ownerDir = path.join(this.root, ".owner");
    try {
      await mkdir(ownerDir);
      await writeFile(
        path.join(ownerDir, "owner.json"),
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
        { encoding: "utf8", mode: 0o600 },
      );
      this.ownerClaimed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(
          await readFile(path.join(ownerDir, "owner.json"), "utf8"),
        ) as { pid?: unknown };
        if (typeof owner.pid === "number") {
          process.kill(owner.pid, 0);
          throw new Error(
            "Another calendar service owns this cache; concurrent writers are refused.",
          );
        }
      } catch (probeError) {
        if (
          probeError instanceof Error &&
          probeError.message.includes("Another calendar service owns")
        )
          throw probeError;
        await rm(ownerDir, { recursive: true, force: true });
        await mkdir(ownerDir);
        await writeFile(
          path.join(ownerDir, "owner.json"),
          JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
          { encoding: "utf8", mode: 0o600 },
        );
        this.ownerClaimed = true;
      }
    }
  }
  private assertLocalBinding(
    nodeId: string,
    config: CalendarNodeConfig,
    eventCalendarId?: string,
  ): void {
    if (!isCalendarNodeId(nodeId))
      throw new Error("Calendar node id is invalid.");
    assertCalendarConfig(config);
    if (config.provider !== "local" && config.provider !== "ics")
      throw new Error(
        "Remote calendar actions are unavailable until a trusted provider adapter is installed.",
      );
    const expected =
      config.calendarId ?? (config.provider === "local" ? "local" : null);
    if (
      !expected ||
      (eventCalendarId !== undefined && eventCalendarId !== expected)
    )
      throw new Error(
        "Calendar mutation does not match the selected node source.",
      );
    if (config.provider === "local" && expected !== "local")
      throw new Error("Local calendar source id is invalid.");
    if (config.provider === "ics" && !expected.startsWith("ics-"))
      throw new Error("ICS source id is invalid.");
  }
  private cache(
    data: LocalNodeFile,
    nodeId: string,
    sourceId: string,
    stateOverride?: CalendarCache["state"],
    reason?: string | null,
  ): CalendarCache {
    const same = data.sourceId === sourceId;
    const events = same ? data.events : [];
    const fresh =
      same && data.fetchedAt > 0 && Date.now() - data.fetchedAt < CACHE_TTL;
    return {
      nodeId,
      sourceId,
      fetchedAt: same ? data.fetchedAt : 0,
      expiresAt: same && data.fetchedAt ? data.fetchedAt + CACHE_TTL : 0,
      events,
      state:
        stateOverride ??
        (events.length ? (fresh ? "fresh" : "stale") : "empty"),
      reason:
        reason ??
        (same ? null : "The selected source has no cached events yet."),
      sourceRevision: same && data.fetchedAt ? String(data.fetchedAt) : null,
      sourceName: same ? data.sourceName : null,
      etag: null,
      complete: true,
      partial: !!data.importReport && data.importReport.rejected > 0,
      retryAt: null,
      backoffMs: 0,
      importReport: same ? (data.importReport ?? undefined) : undefined,
    };
  }
  async accounts(): Promise<CalendarAccount[]> {
    try {
      const parsed = JSON.parse(
        await readFile(this.accountsFile, "utf8"),
      ) as unknown;
      if (!Array.isArray(parsed) || parsed.length > 1000)
        throw new Error("Calendar account catalog has unsupported shape.");
      return parsed.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error("Calendar account catalog has unsupported shape.");
        const account = value as Record<string, unknown>;
        const expected = [
          "credentialRef",
          "displayName",
          "email",
          "id",
          "provider",
          "reason",
          "state",
        ].sort();
        if (
          Object.keys(account).sort().join("|") !== expected.join("|") ||
          typeof account.id !== "string" ||
          account.id.length > 160 ||
          typeof account.displayName !== "string" ||
          account.displayName.length > 240 ||
          typeof account.provider !== "string" ||
          !["local", "ics", "caldav", "google", "microsoft365"].includes(
            account.provider,
          ) ||
          !["connected", "needs-consent", "offline", "unavailable"].includes(
            account.state as string,
          ) ||
          (account.email !== null && typeof account.email !== "string") ||
          (account.credentialRef !== null &&
            typeof account.credentialRef !== "string") ||
          (account.reason !== null && typeof account.reason !== "string")
        )
          throw new Error("Calendar account catalog has unsupported shape.");
        return {
          ...account,
          state:
            account.provider === "local" || account.provider === "ics"
              ? account.state
              : "unavailable",
          credentialRef: null,
          reason:
            account.provider === "local" || account.provider === "ics"
              ? account.reason
              : "No trusted provider adapter is installed.",
        } as CalendarAccount;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  async calendars(
    accountId: string | null,
    provider: CalendarProvider,
  ): Promise<CalendarSource[]> {
    if (provider === "local")
      return [
        {
          id: "local",
          accountId: null,
          provider,
          name: "On this computer",
          timezone: "local",
          color: "#6750A4",
          readOnly: false,
          writable: true,
        },
      ];
    if (provider === "ics")
      return (await this.readSources()).filter(
        (source) => !accountId || source.id === accountId,
      );
    return [];
  }
  async events(
    nodeId: string,
    config: CalendarNodeConfig,
  ): Promise<CalendarCache> {
    this.assertLocalBinding(nodeId, config);
    const data = await this.read(nodeId);
    return config.cacheEnabled
      ? this.cache(data, nodeId, config.calendarId ?? "local")
      : this.cache(
          { ...data, events: [], sourceId: config.calendarId ?? "local" },
          nodeId,
          config.calendarId ?? "local",
          "empty",
          "Local cache is disabled for this node.",
        );
  }
  async importIcs(
    nodeId: string,
    icsText: string,
    sourceName = "Imported ICS file",
  ): Promise<CalendarCache> {
    if (!isCalendarNodeId(nodeId))
      throw new Error("Calendar node id is invalid.");
    if (typeof icsText !== "string") throw new Error("ICS input must be text.");
    if (typeof sourceName !== "string")
      throw new Error("ICS source name must be text.");
    return this.withNodeLock(nodeId, async () => {
      const boundedName = sourceName.slice(0, MAX_SOURCE_NAME);
      const sourceId = sourceIdForIcs(nodeId, boundedName, icsText);
      const parsed = parseIcsDetailed(icsText, sourceId);
      const fetchedAt = Date.now();
      const value = {
        version: 1 as const,
        nodeId,
        sourceId,
        sourceName: boundedName,
        events: parsed.events,
        fetchedAt,
        importReport: parsed.report,
      };
      await this.write(value);
      await this.registerSource({
        id: sourceId,
        accountId: null,
        provider: "ics",
        name: boundedName,
        timezone: "local",
        color: "#386A20",
        readOnly: false,
        writable: true,
      });
      await this.recordHistory(
        nodeId,
        value,
        "Imported ICS calendar events",
        "updated",
      );
      return this.cache(
        value,
        nodeId,
        sourceId,
        parsed.events.length ? "fresh" : "empty",
        parsed.events.length ? null : "The ICS file contained no valid events.",
      );
    });
  }
  async refresh(
    nodeId: string,
    config: CalendarNodeConfig,
  ): Promise<CalendarCache> {
    assertCalendarConfig(config);
    if (config.provider === "local" || config.provider === "ics")
      return this.events(nodeId, config);
    const data = await this.read(nodeId);
    const sourceId = config.calendarId ?? "remote-unconfigured";
    return this.cache(
      data,
      nodeId,
      sourceId,
      "empty",
      data.events.length
        ? "This provider adapter is unavailable. Cached records belong to a different source and were not shown; no network request was made."
        : "This provider adapter is unavailable and no matching source cache exists; no network request was made.",
    );
  }
  async status(
    nodeId: string,
    config: CalendarNodeConfig,
  ): Promise<CalendarStatus> {
    if (!isCalendarNodeId(nodeId))
      throw new Error("Calendar node id is invalid.");
    assertCalendarConfig(config);
    const account =
      (await this.accounts()).find((value) => value.id === config.accountId) ??
      null;
    const source =
      (await this.calendars(config.accountId, config.provider)).find(
        (value) => value.id === config.calendarId,
      ) ??
      (config.provider === "local"
        ? (await this.calendars(null, "local"))[0]
        : null);
    const cache =
      config.provider === "local" || config.provider === "ics"
        ? await this.events(nodeId, config)
        : null;
    const state =
      config.provider === "local" || config.provider === "ics"
        ? "ready"
        : account
          ? "unavailable"
          : "unconfigured";
    return {
      nodeId,
      provider: config.provider,
      state,
      account,
      source,
      cache,
      reason:
        state === "unconfigured"
          ? "Choose a trusted account adapter."
          : state === "unavailable"
            ? "No trusted provider adapter is installed; remote actions are disabled."
            : null,
    };
  }
  async beginOAuth(
    provider: Exclude<CalendarProvider, "local" | "ics">,
  ): Promise<CalendarOAuthStart> {
    return {
      provider,
      state: "unsupported",
      authorizationUrl: null,
      redirectUri: null,
      reason:
        "No trusted OAuth PKCE and OS-vault adapter is installed; this provider is unavailable.",
    };
  }
  async create(input: CalendarCreateInput): Promise<CalendarEvent> {
    if (!input || typeof input !== "object" || !input.config || !input.event)
      throw new Error("Calendar create input is invalid.");
    return this.withNodeLock(input.nodeId, async () => {
      this.assertLocalBinding(
        input.nodeId,
        input.config,
        input.event.calendarId,
      );
      if (
        !validateCalendarEvent({
          ...input.event,
          id: "new",
          updatedAt: Date.now(),
        })
      )
        throw new Error("Calendar event fields are invalid.");
      const data = await this.read(input.nodeId);
      const event: CalendarEvent = {
        ...input.event,
        id: newEventId(),
        updatedAt: Date.now(),
      };
      await this.write({
        ...data,
        sourceId: input.config.calendarId ?? "local",
        events: [...data.events, event],
        fetchedAt: Date.now(),
        importReport: null,
      });
      await this.recordHistory(
        input.nodeId,
        {
          ...data,
          sourceId: input.config.calendarId ?? "local",
          events: [...data.events, event],
          fetchedAt: Date.now(),
          importReport: null,
        },
        "Created calendar event",
        "created",
      );
      return event;
    });
  }
  async update(input: CalendarUpdateInput): Promise<CalendarEvent | null> {
    if (!input || typeof input !== "object" || !input.config || !input.event)
      throw new Error("Calendar update input is invalid.");
    return this.withNodeLock(input.nodeId, async () => {
      this.assertLocalBinding(input.nodeId, input.config);
      if (!boundedId(input.eventId))
        throw new Error("Calendar event id is invalid.");
      const data = await this.read(input.nodeId);
      const current = data.events.find((event) => event.id === input.eventId);
      if (!current) return null;
      if (current.calendarId !== input.config.calendarId)
        throw new Error(
          "Calendar mutation does not match the selected node source.",
        );
      const event = {
        ...current,
        ...input.event,
        id: current.id,
        calendarId: current.calendarId,
        updatedAt: Date.now(),
      };
      if (
        !validateCalendarEvent(event) ||
        Date.parse(event.end) <= Date.parse(event.start)
      )
        throw new Error("Calendar event fields are invalid.");
      const value = {
        ...data,
        events: data.events.map((entry) =>
          entry.id === current.id ? event : entry,
        ),
        fetchedAt: Date.now(),
        importReport: null,
      };
      await this.write(value);
      await this.recordHistory(
        input.nodeId,
        value,
        "Updated calendar event",
        "updated",
      );
      return event;
    });
  }
  async remove(input: CalendarRemoveInput): Promise<boolean> {
    if (!input || typeof input !== "object" || !input.config)
      throw new Error("Calendar remove input is invalid.");
    return this.withNodeLock(input.nodeId, async () => {
      this.assertLocalBinding(input.nodeId, input.config);
      if (!boundedId(input.eventId))
        throw new Error("Calendar event id is invalid.");
      const data = await this.read(input.nodeId);
      const current = data.events.find((event) => event.id === input.eventId);
      if (current && current.calendarId !== input.config.calendarId)
        throw new Error(
          "Calendar mutation does not match the selected node source.",
        );
      const next = data.events.filter((event) => event.id !== input.eventId);
      if (next.length === data.events.length) return false;
      const value = {
        ...data,
        events: next,
        fetchedAt: Date.now(),
        importReport: null,
      };
      await this.write(value);
      await this.recordHistory(
        input.nodeId,
        value,
        "Deleted calendar event",
        "deleted",
      );
      return true;
    });
  }
  async restore(input: CalendarRestoreInput): Promise<CalendarCache> {
    return this.withNodeLock(input.nodeId, async () => {
      this.assertLocalBinding(input.nodeId, input.config);
      if (!/^[0-9a-f]{40}$/.test(input.revision))
        throw new Error("Calendar history revision is invalid.");
      const content = await this.history.restoreContent(
        `calendar-${input.nodeId}`,
        input.revision,
        "snapshot.json",
      );
      const parsed = JSON.parse(content) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Calendar history snapshot is invalid.");
      const value = parsed as LocalNodeFile;
      if (
        value.version !== 1 ||
        value.nodeId !== input.nodeId ||
        !validSourceId(value.sourceId) ||
        value.sourceId !== (input.config.calendarId ?? "local") ||
        !Array.isArray(value.events) ||
        value.events.length > 10000 ||
        !value.events.every(validateCalendarEvent)
      )
        throw new Error(
          "Calendar history snapshot does not match the selected source.",
        );
      const restored = { ...value, fetchedAt: Date.now() };
      await this.write(restored);
      await this.recordHistory(
        input.nodeId,
        restored,
        "Restored calendar history revision",
        "restored",
      );
      return this.cache(
        restored,
        input.nodeId,
        input.config.calendarId ?? "local",
        "fresh",
      );
    });
  }
}
function boundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
