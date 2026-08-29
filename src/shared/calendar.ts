/** Shared calendar contracts. Project state contains intent only, never credentials or source paths. */

export type CalendarProvider =
  "local" | "ics" | "caldav" | "google" | "microsoft365";
export type CalendarView = "month" | "week" | "agenda";
export type CalendarProviderStatus =
  "connected" | "needs-consent" | "offline" | "unavailable";

const PROVIDERS: readonly CalendarProvider[] = [
  "local",
  "ics",
  "caldav",
  "google",
  "microsoft365",
];
const VIEWS: readonly CalendarView[] = ["month", "week", "agenda"];
const CONFIG_KEYS = [
  "provider",
  "accountId",
  "calendarId",
  "timezone",
  "view",
  "showWeekends",
  "cacheEnabled",
] as const;

export function calendarTimezones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: "timeZone") => string[];
  };
  const values = intl.supportedValuesOf?.("timeZone") ?? [
    "UTC",
    "America/Toronto",
    "America/Los_Angeles",
    "Europe/London",
    "Asia/Hong_Kong",
  ];
  return ["local", ...values];
}

export const CALENDAR_PROVIDER_CATALOG: readonly {
  id: CalendarProvider;
  label: string;
  configuredBy: "local" | "file" | "vault";
  availability: "available" | "requires-account" | "requires-adapter";
  reason: string | null;
}[] = [
  {
    id: "local",
    label: "Local calendar",
    configuredBy: "local",
    availability: "available",
    reason: null,
  },
  {
    id: "ics",
    label: "ICS file",
    configuredBy: "file",
    availability: "available",
    reason: null,
  },
  {
    id: "caldav",
    label: "CalDAV",
    configuredBy: "vault",
    availability: "requires-adapter",
    reason:
      "A trusted CalDAV adapter with PKCE and OS-vault storage is not installed.",
  },
  {
    id: "google",
    label: "Google Calendar",
    configuredBy: "vault",
    availability: "requires-adapter",
    reason:
      "A trusted Google OAuth PKCE adapter with OS-vault storage is not installed.",
  },
  {
    id: "microsoft365",
    label: "Microsoft 365",
    configuredBy: "vault",
    availability: "requires-adapter",
    reason:
      "A trusted Microsoft OAuth PKCE adapter with OS-vault storage is not installed.",
  },
] as const;

export interface CalendarNodeConfig {
  provider: CalendarProvider;
  accountId: string | null;
  calendarId: string | null;
  timezone: string;
  view: CalendarView;
  showWeekends: boolean;
  cacheEnabled: boolean;
}
export interface CalendarAccount {
  id: string;
  provider: CalendarProvider;
  displayName: string;
  email: string | null;
  credentialRef: string | null;
  state: CalendarProviderStatus;
  reason: string | null;
}
export interface CalendarSource {
  id: string;
  accountId: string | null;
  provider: CalendarProvider;
  name: string;
  timezone: string;
  color: string;
  readOnly: boolean;
  writable: boolean;
}
export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  recurrence: string | null;
  updatedAt: number;
}
export interface CalendarImportIssue {
  uid: string | null;
  reason: string;
  action: "skipped" | "rejected";
}
export interface CalendarImportReport {
  accepted: number;
  skipped: number;
  rejected: number;
  issues: CalendarImportIssue[];
}
export interface CalendarCache {
  nodeId: string;
  sourceId: string;
  fetchedAt: number;
  expiresAt: number;
  events: CalendarEvent[];
  state: "fresh" | "stale" | "offline" | "empty";
  reason: string | null;
  sourceRevision: string | null;
  etag: string | null;
  complete: boolean;
  partial: boolean;
  retryAt: number | null;
  backoffMs: number;
  sourceName?: string | null;
  importReport?: CalendarImportReport;
}
export interface CalendarStatus {
  nodeId: string;
  provider: CalendarProvider;
  state: "unconfigured" | "ready" | "offline" | "needs-consent" | "unavailable";
  account: CalendarAccount | null;
  source: CalendarSource | null;
  cache: CalendarCache | null;
  reason: string | null;
}
export interface CalendarOAuthStart {
  provider: Exclude<CalendarProvider, "local" | "ics">;
  state: "unsupported";
  authorizationUrl: null;
  redirectUri: null;
  reason: string;
}
export interface CalendarCreateInput {
  nodeId: string;
  config: CalendarNodeConfig;
  event: Omit<CalendarEvent, "id" | "updatedAt">;
}
export interface CalendarUpdateInput {
  nodeId: string;
  config: CalendarNodeConfig;
  eventId: string;
  event: Partial<Omit<CalendarEvent, "id" | "updatedAt">>;
}
export interface CalendarRemoveInput {
  nodeId: string;
  config: CalendarNodeConfig;
  eventId: string;
}
export interface CalendarRestoreInput {
  nodeId: string;
  config: CalendarNodeConfig;
  revision: string;
}
export interface CalendarApi {
  status(nodeId: string, config: CalendarNodeConfig): Promise<CalendarStatus>;
  accounts(): Promise<CalendarAccount[]>;
  calendars(
    accountId: string | null,
    provider: CalendarProvider,
  ): Promise<CalendarSource[]>;
  events(nodeId: string, config: CalendarNodeConfig): Promise<CalendarCache>;
  importIcs(
    nodeId: string,
    icsText: string,
    sourceName?: string,
  ): Promise<CalendarCache>;
  refresh(nodeId: string, config: CalendarNodeConfig): Promise<CalendarCache>;
  beginOAuth(
    provider: Exclude<CalendarProvider, "local" | "ics">,
  ): Promise<CalendarOAuthStart>;
  create(input: CalendarCreateInput): Promise<CalendarEvent>;
  update(input: CalendarUpdateInput): Promise<CalendarEvent | null>;
  remove(input: CalendarRemoveInput): Promise<boolean>;
  restore(input: CalendarRestoreInput): Promise<CalendarCache>;
}

export const DEFAULT_CALENDAR_NODE_CONFIG: CalendarNodeConfig = {
  provider: "local",
  accountId: null,
  calendarId: "local",
  timezone: "local",
  view: "agenda",
  showWeekends: true,
  cacheEnabled: true,
};
const PROVIDER_NAMES: Record<CalendarProvider, string> = {
  local: "Local calendar",
  ics: "ICS file",
  caldav: "CalDAV",
  google: "Google Calendar",
  microsoft365: "Microsoft 365",
};
export function calendarProviderName(provider: CalendarProvider): string {
  return PROVIDER_NAMES[provider];
}
export function isCalendarNodeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,120}$/.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
function boundedText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function validZone(value: unknown): value is string {
  if (!boundedText(value, 120)) return false;
  if (value === "local") return true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function isCalendarConfig(value: unknown): value is CalendarNodeConfig {
  if (!isRecord(value) || !hasExactKeys(value, CONFIG_KEYS)) return false;
  return (
    PROVIDERS.includes(value.provider as CalendarProvider) &&
    VIEWS.includes(value.view as CalendarView) &&
    (value.accountId === null || boundedText(value.accountId, 160)) &&
    (value.calendarId === null || boundedText(value.calendarId, 160)) &&
    validZone(value.timezone) &&
    typeof value.showWeekends === "boolean" &&
    typeof value.cacheEnabled === "boolean"
  );
}
export function validateCalendarConfig(value: unknown): CalendarNodeConfig {
  return isCalendarConfig(value)
    ? { ...value }
    : { ...DEFAULT_CALENDAR_NODE_CONFIG };
}
export function assertCalendarConfig(
  value: unknown,
): asserts value is CalendarNodeConfig {
  if (!isCalendarConfig(value))
    throw new Error(
      "Calendar node configuration has unsupported fields or values.",
    );
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}
function unfoldIcs(ics: string): string[] {
  const lines = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const result: string[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && result.length)
      result[result.length - 1] += line.slice(1);
    else result.push(line);
  }
  return result;
}
interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}
function parseProperty(line: string): IcsProperty | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  const [head, ...parts] = line.slice(0, colon).split(";");
  if (!/^[A-Z0-9-]+$/i.test(head)) return null;
  const params: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq > 0)
      params[part.slice(0, eq).toUpperCase()] = part
        .slice(eq + 1)
        .replace(/^"|"$/g, "");
  }
  return {
    name: head.toUpperCase(),
    params,
    value: unescapeIcs(line.slice(colon + 1)),
  };
}
function validDateParts(
  y: number,
  m: number,
  d: number,
  h = 0,
  min = 0,
  s = 0,
): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d, h, min, s));
  return (
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= 31 &&
    h >= 0 &&
    h <= 23 &&
    min >= 0 &&
    min <= 59 &&
    s >= 0 &&
    s <= 60 &&
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}
function offsetAt(ms: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const raw =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(raw);
  if (!match) return 0;
  return (
    (match[1] === "-" ? -1 : 1) *
    (Number(match[2]) * 60 + Number(match[3] ?? 0))
  );
}
function localParts(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}
/** Convert a local wall time. Repeated times choose the earlier instant; nonexistent times advance through the gap. */
export function calendarWallTimeToInstant(
  wall: string,
  timezone: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    wall,
  );
  if (!match) throw new Error("Calendar wall time is invalid.");
  const nums = match.slice(1).map(Number);
  if (
    !validDateParts(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5] ?? 0)
  )
    throw new Error("Calendar wall time is out of range.");
  if (timezone === "local")
    return new Date(
      nums[0],
      nums[1] - 1,
      nums[2],
      nums[3],
      nums[4],
      nums[5] ?? 0,
    ).toISOString();
  const wallMs = Date.UTC(
    nums[0],
    nums[1] - 1,
    nums[2],
    nums[3],
    nums[4],
    nums[5] ?? 0,
  );
  let candidate = wallMs;
  for (let i = 0; i < 5; i++)
    candidate = wallMs - offsetAt(candidate, timezone) * 60000;
  if (localParts(candidate, timezone) !== wall) {
    for (let minutes = 0; minutes <= 180; minutes++) {
      const probe = candidate + minutes * 60000;
      if (localParts(probe, timezone) >= wall) {
        candidate = probe;
        break;
      }
    }
  }
  return new Date(candidate).toISOString();
}
export function calendarInstantToWallTime(
  iso: string,
  timezone: string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  if (timezone === "local") {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
export function calendarDateKey(iso: string, timezone: string): string {
  return calendarInstantToWallTime(iso, timezone).slice(0, 10);
}
export function calendarPeriodBounds(
  cursor: Date,
  view: CalendarView,
  timezone: string,
): { start: string; end: string } {
  const wall = calendarInstantToWallTime(cursor.toISOString(), timezone).slice(
    0,
    10,
  );
  const base = new Date(`${wall}T00:00:00Z`);
  if (view === "month") base.setUTCDate(1);
  else if (view === "week") {
    const day = base.getUTCDay();
    base.setUTCDate(base.getUTCDate() - (day === 0 ? 6 : day - 1));
  }
  const end = new Date(base);
  if (view === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  else if (view === "week") end.setUTCDate(end.getUTCDate() + 7);
  else end.setUTCDate(end.getUTCDate() + 1);
  const wallStart = `${base.toISOString().slice(0, 10)}T00:00:00`;
  const wallEnd = `${end.toISOString().slice(0, 10)}T00:00:00`;
  return {
    start: calendarWallTimeToInstant(wallStart, timezone),
    end: calendarWallTimeToInstant(wallEnd, timezone),
  };
}
function parseIcsDate(
  property: IcsProperty,
  fallbackTimezone: string,
): { iso: string; allDay: boolean; wall: string } {
  const value = property.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(
    value,
  );
  const allDay = property.params.VALUE?.toUpperCase() === "DATE" || !!date;
  if (!date && !dateTime) throw new Error("Invalid date or datetime value.");
  const groups = date ?? dateTime!;
  const nums = groups.slice(1, 7).map(Number);
  if (
    !validDateParts(
      nums[0],
      nums[1],
      nums[2],
      dateTime ? nums[3] : 0,
      dateTime ? nums[4] : 0,
      dateTime ? nums[5] : 0,
    )
  )
    throw new Error("Date or datetime value is out of range.");
  if (date) {
    const wall = `${groups[1]}-${groups[2]}-${groups[3]}T00:00:00`;
    return {
      iso: calendarWallTimeToInstant(wall, fallbackTimezone),
      allDay: true,
      wall,
    };
  }
  const wall = `${groups[1]}-${groups[2]}-${groups[3]}T${groups[4]}:${groups[5]}:${groups[6]}`;
  return {
    iso: groups[7]
      ? `${wall}.000Z`
      : calendarWallTimeToInstant(
          wall,
          property.params.TZID ?? fallbackTimezone,
        ),
    allDay,
    wall,
  };
}
function durationMs(value: string): number | null {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value,
  );
  if (!match || (!match[1] && !match[2] && !match[3] && !match[4])) return null;
  const ms =
    (Number(match[1] ?? 0) * 86400 +
      Number(match[2] ?? 0) * 3600 +
      Number(match[3] ?? 0) * 60 +
      Number(match[4] ?? 0)) *
    1000;
  return ms > 0 && ms <= 366 * 86400000 ? ms : null;
}
function parseRule(rule: string): Record<string, string> {
  return Object.fromEntries(
    rule
      .replace(/^RRULE:/i, "")
      .split(";")
      .map((part) => {
        const [key, ...rest] = part.split("=");
        return [key.toUpperCase(), rest.join("=")];
      })
      .filter(([key, value]) => !!key && !!value),
  );
}
function expandRecurrence(
  base: CalendarEvent,
  ruleText: string | null,
  exdates: string[],
  rdates: string[],
  timezone: string,
): CalendarEvent[] {
  const startMs = Date.parse(base.start);
  const span = Date.parse(base.end) - startMs;
  const excluded = new Set(exdates.map((value) => Date.parse(value)));
  const add = (output: CalendarEvent[], ms: number): void => {
    if (!Number.isFinite(ms) || excluded.has(ms)) return;
    output.push({
      ...base,
      id: `${base.id}#${output.length}`,
      start: new Date(ms).toISOString(),
      end: new Date(ms + span).toISOString(),
    });
  };
  if (!ruleText) {
    const output: CalendarEvent[] = excluded.has(startMs) ? [] : [{ ...base }];
    for (const value of rdates) add(output, Date.parse(value));
    return output.slice(0, 500);
  }
  const rule = parseRule(ruleText);
  const freq = rule.FREQ;
  if (
    Object.keys(rule).some(
      (key) => !["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY"].includes(key),
    )
  )
    throw new Error("RRULE contains an unsupported field.");
  if (!["DAILY", "WEEKLY", "MONTHLY"].includes(freq))
    throw new Error(
      "RRULE frequency is not supported; use DAILY, WEEKLY, or MONTHLY.",
    );
  const intervalValue = rule.INTERVAL === undefined ? 1 : Number(rule.INTERVAL);
  const countValue = rule.COUNT === undefined ? 500 : Number(rule.COUNT);
  if (
    !Number.isSafeInteger(intervalValue) ||
    intervalValue < 1 ||
    intervalValue > 31
  )
    throw new Error("RRULE INTERVAL must be a finite integer from 1 to 31.");
  if (!Number.isSafeInteger(countValue) || countValue < 1 || countValue > 500)
    throw new Error("RRULE COUNT must be a finite integer from 1 to 500.");
  const interval = intervalValue;
  const count = countValue;
  const until = rule.UNTIL
    ? /(^\d{8})/.test(rule.UNTIL)
      ? Date.parse(
          calendarWallTimeToInstant(
            `${rule.UNTIL.slice(0, 4)}-${rule.UNTIL.slice(4, 6)}-${rule.UNTIL.slice(6, 8)}T23:59:59`,
            timezone,
          ),
        )
      : Date.parse(
          parseIcsDate(
            { name: "UNTIL", params: {}, value: rule.UNTIL },
            timezone,
          ).iso,
        )
    : Number.POSITIVE_INFINITY;
  const byday =
    rule.BYDAY?.split(",").filter((value) =>
      /^(MO|TU|WE|TH|FR|SA|SU)$/.test(value),
    ) ?? [];
  const dayNames = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const output: CalendarEvent[] = [];
  const baseWall = calendarInstantToWallTime(base.start, timezone);
  const wallDate = new Date(`${baseWall}:00Z`);
  const addWall = (wall: Date): void => {
    const instant = calendarWallTimeToInstant(
      wall.toISOString().slice(0, 19),
      timezone,
    );
    add(output, Date.parse(instant));
  };
  let cursor = new Date(wallDate);
  let occurrences = 0;
  let attempts = 0;
  while (
    occurrences < count &&
    attempts++ < 2000 &&
    cursor.getTime() <= until &&
    cursor.getTime() <= startMs + 366 * 86400000
  ) {
    const matches =
      freq !== "WEEKLY" ||
      byday.length === 0 ||
      byday.includes(dayNames[cursor.getUTCDay()]);
    if (matches) {
      addWall(cursor);
      occurrences++;
    }
    if (freq === "DAILY") cursor.setUTCDate(cursor.getUTCDate() + interval);
    else if (freq === "MONTHLY") {
      cursor.setUTCMonth(cursor.getUTCMonth() + interval);
    } else if (byday.length) cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + interval * 7);
  }
  for (const value of rdates) add(output, Date.parse(value));
  return output.slice(0, 500);
}

export function parseIcsDetailed(
  ics: string,
  calendarId = "ics-import",
): { events: CalendarEvent[]; report: CalendarImportReport } {
  if (new TextEncoder().encode(ics).byteLength > 2000000)
    throw new Error("ICS input exceeds the 2 MB UTF-8 safety limit.");
  const lines = unfoldIcs(ics);
  const events: CalendarEvent[] = [];
  const report: CalendarImportReport = {
    accepted: 0,
    skipped: 0,
    rejected: 0,
    issues: [],
  };
  const seen = new Set<string>();
  let current: IcsProperty[] | null = null;
  let fallbackTimezone = "local";
  const timezoneAliases = new Map<string, string>();
  let inVtimezone = false;
  let vtimezoneId: string | null = null;
  let vtimezoneLocation: string | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VTIMEZONE") {
      inVtimezone = true;
      vtimezoneId = null;
      vtimezoneLocation = null;
    } else if (upper === "END:VTIMEZONE") {
      if (vtimezoneId && vtimezoneLocation && validZone(vtimezoneLocation))
        timezoneAliases.set(vtimezoneId, vtimezoneLocation);
      inVtimezone = false;
    } else if (upper === "BEGIN:VEVENT") current = [];
    else if (upper === "END:VEVENT" && current) {
      const byName = (name: string) => current!.filter((p) => p.name === name);
      const uid = byName("UID")[0]?.value ?? null;
      try {
        if (!uid || !boundedText(uid, 240))
          throw new Error("UID is missing or invalid.");
        if (seen.has(uid)) {
          report.skipped++;
          report.issues.push({
            uid,
            reason: "Duplicate UID was ignored.",
            action: "skipped",
          });
          current = null;
          continue;
        }
        const startProp = byName("DTSTART")[0];
        if (!startProp) throw new Error("DTSTART is missing.");
        const resolvedStartZone =
          timezoneAliases.get(startProp.params.TZID ?? fallbackTimezone) ??
          startProp.params.TZID ??
          fallbackTimezone;
        const start = parseIcsDate(
          {
            ...startProp,
            params: { ...startProp.params, TZID: resolvedStartZone },
          },
          resolvedStartZone,
        );
        const endProp = byName("DTEND")[0];
        const duration = byName("DURATION")[0]
          ? durationMs(byName("DURATION")[0].value)
          : null;
        const resolvedEndZone = endProp
          ? (timezoneAliases.get(endProp.params.TZID ?? resolvedStartZone) ??
            endProp.params.TZID ??
            resolvedStartZone)
          : resolvedStartZone;
        const end = endProp
          ? parseIcsDate(
              {
                ...endProp,
                params: { ...endProp.params, TZID: resolvedEndZone },
              },
              resolvedEndZone,
            )
          : duration
            ? {
                iso: new Date(Date.parse(start.iso) + duration).toISOString(),
                allDay: start.allDay,
                wall: "",
              }
            : null;
        if (!end) throw new Error("DTEND or a bounded DURATION is required.");
        if (Date.parse(end.iso) <= Date.parse(start.iso))
          throw new Error("Event end must be after event start.");
        const title = byName("SUMMARY")[0]?.value ?? "(untitled event)";
        if (!boundedText(title, 500))
          throw new Error(
            "SUMMARY is too long or contains a control character.",
          );
        const timezone = validZone(
          resolvedStartZone ??
            byName("X-WR-TIMEZONE")[0]?.value ??
            fallbackTimezone,
        )
          ? (resolvedStartZone ??
            byName("X-WR-TIMEZONE")[0]?.value ??
            fallbackTimezone)
          : "local";
        const base: CalendarEvent = {
          id: uid,
          calendarId,
          title,
          start: start.iso,
          end: end.iso,
          timezone,
          allDay: start.allDay,
          location: byName("LOCATION")[0]?.value ?? null,
          description: byName("DESCRIPTION")[0]?.value ?? null,
          recurrence: byName("RRULE")[0]?.value ?? null,
          updatedAt: Date.now(),
        };
        const exdates = byName("EXDATE").flatMap((p) =>
          p.value.split(",").map(
            (value) =>
              parseIcsDate(
                {
                  ...p,
                  value,
                  params: {
                    ...p.params,
                    TZID:
                      timezoneAliases.get(p.params.TZID ?? timezone) ??
                      p.params.TZID,
                    VALUE: p.params.VALUE ?? "DATE-TIME",
                  },
                },
                timezone,
              ).iso,
          ),
        );
        const rdates = byName("RDATE").flatMap((p) =>
          p.value.split(",").map(
            (value) =>
              parseIcsDate(
                {
                  ...p,
                  value,
                  params: {
                    ...p.params,
                    TZID:
                      timezoneAliases.get(p.params.TZID ?? timezone) ??
                      p.params.TZID,
                    VALUE: p.params.VALUE ?? "DATE-TIME",
                  },
                },
                timezone,
              ).iso,
          ),
        );
        const expanded = expandRecurrence(
          base,
          base.recurrence,
          exdates,
          rdates,
          timezone,
        );
        if (events.length + expanded.length > 10000)
          throw new Error("The event limit is 10,000 instances.");
        seen.add(uid);
        events.push(...expanded);
        report.accepted += expanded.length;
      } catch (error) {
        report.rejected++;
        report.issues.push({
          uid,
          reason:
            error instanceof Error
              ? error.message
              : "Event could not be parsed.",
          action: "rejected",
        });
      }
      current = null;
    } else if (current) {
      const property = parseProperty(line);
      if (property) {
        if (property.name === "X-WR-TIMEZONE")
          fallbackTimezone = property.value;
        current.push(property);
      }
    } else if (inVtimezone) {
      const property = parseProperty(line);
      if (property?.name === "TZID") vtimezoneId = property.value;
      if (property?.name === "X-LIC-LOCATION")
        vtimezoneLocation = property.value;
    } else {
      const property = parseProperty(line);
      if (property?.name === "X-WR-TIMEZONE") fallbackTimezone = property.value;
    }
  }
  return { events, report };
}
export function parseIcs(
  ics: string,
  calendarId = "ics-import",
): CalendarEvent[] {
  return parseIcsDetailed(ics, calendarId).events;
}
export function validateCalendarEvent(value: unknown): value is CalendarEvent {
  if (!isRecord(value)) return false;
  const keys = [
    "id",
    "calendarId",
    "title",
    "start",
    "end",
    "timezone",
    "allDay",
    "location",
    "description",
    "recurrence",
    "updatedAt",
  ] as const;
  if (!hasExactKeys(value, keys)) return false;
  return (
    boundedText(value.id, 240) &&
    boundedText(value.calendarId, 240) &&
    boundedText(value.title, 500) &&
    Number.isFinite(Date.parse(value.start as string)) &&
    Number.isFinite(Date.parse(value.end as string)) &&
    validZone(value.timezone) &&
    typeof value.allDay === "boolean" &&
    (value.location === null || boundedText(value.location, 500)) &&
    (value.description === null || boundedText(value.description, 4000)) &&
    (value.recurrence === null || boundedText(value.recurrence, 500)) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt)
  );
}
