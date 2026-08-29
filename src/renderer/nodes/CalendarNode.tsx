import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeResizer, useReactFlow, type NodeProps } from "@xyflow/react";
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarNodeConfig,
  CalendarProvider,
  CalendarSource,
  CalendarView,
} from "@shared/calendar";
import {
  CALENDAR_PROVIDER_CATALOG,
  DEFAULT_CALENDAR_NODE_CONFIG,
  calendarDateKey,
  calendarInstantToWallTime,
  calendarPeriodBounds,
  calendarProviderName,
  calendarTimezones,
  calendarWallTimeToInstant,
  validateCalendarConfig,
} from "@shared/calendar";
import type { CanvasNode } from "../state/workspace";
import { useSession } from "../session/session";
import { openDestructiveGate } from "../state/destructiveGate";
import { IconCalendar } from "../components/icons";
import { useRegexSearchField } from "../lib/regex/useRegexSearchField";
import { AnchoredRegexBuilder } from "../components/regex/AnchoredRegexBuilder";
import { useI18n } from "../lib/i18n";

const PROVIDERS = CALENDAR_PROVIDER_CATALOG.map((entry) => entry.id);
const providerHelp: Record<CalendarProvider, string> = {
  local: "Events are stored only in this app on this computer.",
  ics: "Import a local .ics file. The file is read locally and is never uploaded.",
  caldav:
    "Requires a connected CalDAV account. Credentials remain in the OS vault.",
  google: "Requires Google OAuth consent. Tokens remain in the OS vault.",
  microsoft365:
    "Requires Microsoft OAuth consent. Tokens remain in the OS vault.",
};

function dateLabel(value: string, timezone: string, allDay: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Invalid date";
  try {
    if (allDay)
      return date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: timezone === "local" ? undefined : timezone,
      });
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone === "local" ? undefined : timezone,
    });
  } catch {
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

function EventEditor({
  nodeId,
  timezone,
  calendarId,
  initial,
  onSave,
  onCancel,
}: {
  nodeId: string;
  timezone: string;
  calendarId: string;
  initial?: CalendarEvent;
  onSave: (event: CalendarEvent) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { ts } = useI18n();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [start, setStart] = useState(
    initial ? calendarInstantToWallTime(initial.start, timezone) : "",
  );
  const [end, setEnd] = useState(
    initial ? calendarInstantToWallTime(initial.end, timezone) : "",
  );
  const [location, setLocation] = useState(initial?.location ?? "");
  const [recurrence, setRecurrence] = useState(initial?.recurrence ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  let validationError = "";
  let startInstant = "";
  let endInstant = "";
  try {
    startInstant = start ? calendarWallTimeToInstant(start, timezone) : "";
    endInstant = end ? calendarWallTimeToInstant(end, timezone) : "";
    if (
      startInstant &&
      endInstant &&
      Date.parse(endInstant) <= Date.parse(startInstant)
    )
      validationError =
        "End time must be after start time in the selected timezone.";
  } catch (error) {
    validationError =
      error instanceof Error
        ? error.message
        : "The selected timezone cannot interpret this time.";
  }
  const valid =
    title.trim().length > 0 &&
    !!startInstant &&
    !!endInstant &&
    !validationError;
  return (
    <div
      className="calendar-node__editor"
      role="region"
      aria-label={
        initial
          ? ts("calendar.edit", "Edit calendar event")
          : ts("calendar.createEvent", "Create calendar event")
      }
    >
      <h3>
        {initial
          ? ts("calendar.edit", "Edit event")
          : ts("calendar.createEvent", "Create event")}
      </h3>
      <p className="calendar-node__hint">
        Times use {timezone === "local" ? "this computer’s timezone" : timezone}
        . Review the preview before saving.
      </p>
      <label>
        {ts("calendar.titleField", "Title")}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </label>
      <div className="calendar-node__two-col">
        <label>
          {ts("calendar.starts", "Starts")}
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          {ts("calendar.ends", "Ends")}
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <label>
        {ts("calendar.location", "Location")}
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </label>
      <label>
        {ts("calendar.description", "Description")}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="calendar-node__check">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
        />{" "}
        {ts("calendar.allDay", "All-day event")}
      </label>
      <label>
        {ts("calendar.recurrence", "Recurrence rule (optional)")}
        <input
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
          placeholder="RRULE:FREQ=WEEKLY;BYDAY=MO"
        />
      </label>
      {!valid && (
        <p className="calendar-node__error" role="alert">
          {validationError || "Enter a title and both start and end times."}
        </p>
      )}
      <div className="calendar-node__actions">
        <button type="button" onClick={onCancel}>
          {ts("calendar.cancel", "Cancel")}
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            try {
              onSave({
                id: initial?.id ?? `local-${Date.now().toString(36)}`,
                calendarId: initial?.calendarId ?? calendarId,
                title: title.trim(),
                start: startInstant,
                end: endInstant,
                timezone,
                allDay,
                location: location.trim() || null,
                description: description.trim() || null,
                recurrence: recurrence.trim() || null,
                updatedAt: Date.now(),
              });
            } catch {
              /* validation remains visible through the disabled/invalid state */
            }
          }}
        >
          {initial
            ? ts("calendar.saveChanges", "Save changes")
            : ts("calendar.createEvent", "Create event")}
        </button>
      </div>
    </div>
  );
}

export default function CalendarNode({
  id,
  data,
  selected,
}: NodeProps<CanvasNode>): React.JSX.Element {
  const { api } = useSession();
  const { ts } = useI18n();
  const { updateNodeData } = useReactFlow();
  const config = validateCalendarConfig(
    data.calendarConfig ?? DEFAULT_CALENDAR_NODE_CONFIG,
  );
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [status, setStatus] = useState("Ready to choose a calendar.");
  const search = useRegexSearchField();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sourceSearch = useRegexSearchField();
  const sourceSearchRef = useRef<HTMLInputElement>(null);
  const accountSearch = useRegexSearchField();
  const accountSearchRef = useRef<HTMLInputElement>(null);
  const calendarSearch = useRegexSearchField();
  const calendarSearchRef = useRef<HTMLInputElement>(null);
  const timezoneSearch = useRegexSearchField();
  const timezoneSearchRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<CalendarEvent | null | undefined>(
    undefined,
  );
  const editorOriginRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const bulkCancelRef = useRef(false);
  const [historyRevision, setHistoryRevision] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<
    Array<{ sha: string; label: string; action: string; timestamp: number }>
  >([]);
  const historySearch = useRegexSearchField();
  const historySearchRef = useRef<HTMLInputElement>(null);
  const [sourceName, setSourceName] = useState("Imported ICS file");
  const [exportFormat, setExportFormat] = useState<
    "json" | "ics" | "csv" | "markdown"
  >("json");
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

  const setConfig = useCallback(
    (patch: Partial<CalendarNodeConfig>) =>
      updateNodeData(id, { calendarConfig: { ...config, ...patch } }),
    [config, id, updateNodeData],
  );
  const loadCatalog = useCallback(async (): Promise<void> => {
    try {
      const [nextAccounts, nextSources] = await Promise.all([
        api.calendar.accounts(),
        api.calendar.calendars(config.accountId, config.provider),
      ]);
      setAccounts(nextAccounts);
      setSources(nextSources);
      const calendarStatus = await api.calendar.status(id, config);
      if (calendarStatus.reason) setStatus(calendarStatus.reason);
    } catch {
      setStatus(
        "Calendar catalog is unavailable. Existing local cache remains available.",
      );
    }
  }, [
    api.calendar,
    id,
    config.accountId,
    config.calendarId,
    config.provider,
    config.timezone,
    config.view,
    config.showWeekends,
    config.cacheEnabled,
  ]);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (config.provider !== "local" && config.provider !== "ics") {
      setStatus("Remote provider is unavailable; no remote cache is shown.");
      return;
    }
    let cancelled = false;
    void api.calendar
      .events(id, config)
      .then((cache) => {
        if (cache.sourceId.startsWith("ics-") && cache.sourceName)
          setSources([
            {
              id: cache.sourceId,
              accountId: null,
              provider: "ics",
              name: cache.sourceName,
              timezone: config.timezone,
              color: "#386A20",
              readOnly: false,
              writable: true,
            },
          ]);
        if (cancelled || cache.events.length === 0) return;
        setEvents(cache.events);
        setStatus(
          cache.state === "stale" || cache.state === "offline"
            ? "Showing the last valid offline cache."
            : "Calendar cache loaded.",
        );
      })
      .catch(() => {
        if (!cancelled)
          setStatus(
            "Calendar cache could not be read. The source must be refreshed or imported again.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [
    api.calendar,
    config.accountId,
    config.cacheEnabled,
    config.calendarId,
    config.provider,
    config.showWeekends,
    config.timezone,
    config.view,
    id,
  ]);

  useEffect(() => {
    if (config.provider === "local" || config.provider === "ics") return;
    const account = accounts.find((a) => a.id === config.accountId);
    if (!account)
      setStatus(
        "Choose a connected account. The account list is empty when no vault binding exists.",
      );
  }, [accounts, config.accountId, config.provider]);

  const filtered = useMemo(
    () =>
      events
        .filter((event) =>
          search.test(
            `${event.title} ${event.location ?? ""} ${event.description ?? ""}`,
          ),
        )
        .sort((a, b) => a.start.localeCompare(b.start)),
    [events, search],
  );
  const viewEvents = useMemo(() => {
    if (config.view === "agenda") return filtered;
    const bounds = calendarPeriodBounds(
      cursorDate,
      config.view,
      config.timezone,
    );
    const start = Date.parse(bounds.start);
    const end = Date.parse(bounds.end);
    return filtered.filter(
      (event) =>
        Date.parse(event.start) < end && Date.parse(event.end) >= start,
    );
  }, [config.view, config.timezone, cursorDate, filtered]);
  const gridCells = useMemo(() => {
    if (config.view === "agenda") return [] as string[];
    const period = calendarPeriodBounds(
      cursorDate,
      config.view,
      config.timezone,
    );
    const wallStart = calendarInstantToWallTime(
      period.start,
      config.timezone,
    ).slice(0, 10);
    const start = new Date(`${wallStart}T00:00:00Z`);
    if (config.view === "month") {
      const day = start.getUTCDay();
      start.setUTCDate(1 - (day === 0 ? 6 : day - 1));
    }
    return Array.from(
      { length: config.view === "month" ? 42 : 7 },
      (_, index) => {
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + index);
        return date.toISOString().slice(0, 10);
      },
    );
  }, [config.timezone, config.view, cursorDate]);
  const movePeriod = (direction: -1 | 1): void =>
    setCursorDate((current) => {
      const next = new Date(current);
      if (config.view === "agenda") next.setDate(next.getDate() + direction);
      else if (config.view === "week")
        next.setDate(next.getDate() + direction * 7);
      else next.setMonth(next.getMonth() + direction);
      return next;
    });
  const goToday = (): void => setCursorDate(new Date());
  useEffect(() => {
    if (editing === undefined) {
      editorOriginRef.current?.focus();
      editorOriginRef.current = null;
    }
  }, [editing]);
  const updateEvents = (next: CalendarEvent[]): void => setEvents(next);
  const toggleEventSelection = (
    eventId: string,
    checked: boolean,
    extend: boolean,
  ): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (extend && selectionAnchor) {
        const start = viewEvents.findIndex(
          (event) => event.id === selectionAnchor,
        );
        const end = viewEvents.findIndex((event) => event.id === eventId);
        if (start >= 0 && end >= 0)
          for (const event of viewEvents.slice(
            Math.min(start, end),
            Math.max(start, end) + 1,
          ))
            next.add(event.id);
      } else if (checked) next.add(eventId);
      else next.delete(eventId);
      return next;
    });
    setSelectionAnchor(eventId);
  };
  const exportEvents = async (): Promise<void> => {
    const chosen = viewEvents.filter((event) => selectedIds.has(event.id));
    const rows = chosen.length ? chosen : viewEvents;
    const content =
      exportFormat === "json"
        ? JSON.stringify(
            {
              schemaVersion: 1,
              exportedRange: config.view,
              events: rows,
              omitted: ["provider credentials", "OAuth state", "source paths"],
            },
            null,
            2,
          )
        : exportFormat === "csv"
          ? [
              "id,title,start,end,timezone,allDay,location,description,recurrence",
              ...rows.map((event) =>
                [
                  event.id,
                  event.title,
                  event.start,
                  event.end,
                  event.timezone,
                  event.allDay,
                  event.location ?? "",
                  event.description ?? "",
                  event.recurrence ?? "",
                ]
                  .map((value) => `"${String(value).replaceAll('"', '""')}"`)
                  .join(","),
              ),
            ].join("\n")
          : exportFormat === "markdown"
            ? [
                `# Calendar export (${config.view})`,
                "",
                "| Title | Start | End | Timezone | All day |",
                "| --- | --- | --- | --- | --- |",
                ...rows.map(
                  (event) =>
                    `| ${event.title.replaceAll("|", "\\|")} | ${event.start} | ${event.end} | ${event.timezone} | ${event.allDay ? "yes" : "no"} |`,
                ),
                "",
                "Provider credentials, OAuth state, and source paths were omitted.",
              ].join("\n")
            : [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//nodeterm//Calendar//EN",
                ...rows.flatMap((event) => [
                  "BEGIN:VEVENT",
                  `UID:${event.id}`,
                  event.allDay
                    ? `DTSTART;VALUE=DATE:${event.start.slice(0, 10).replaceAll("-", "")}`
                    : `DTSTART:${event.start.replaceAll(/[-:]/g, "").replace(".000Z", "Z")}`,
                  event.allDay
                    ? `DTEND;VALUE=DATE:${event.end.slice(0, 10).replaceAll("-", "")}`
                    : `DTEND:${event.end.replaceAll(/[-:]/g, "").replace(".000Z", "Z")}`,
                  `SUMMARY:${event.title.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,")}`,
                  "END:VEVENT",
                ]),
                "END:VCALENDAR",
                "",
              ].join("\r\n");
    try {
      await api.export.saveText(
        `calendar-events.${exportFormat === "markdown" ? "md" : exportFormat}`,
        content,
        exportFormat === "json"
          ? "application/json"
          : exportFormat === "ics"
            ? "text/calendar"
            : "text/plain",
      );
      setStatus(
        `${chosen.length || viewEvents.length} event${(chosen.length || viewEvents.length) === 1 ? "" : "s"} exported. Credentials and source paths were omitted.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Calendar export failed: ${error.message}`
          : "Calendar export failed. No file was written.",
      );
    }
  };
  const restoreRevision = async (revision: string): Promise<void> => {
    try {
      const restored = await api.calendar.restore({
        nodeId: id,
        config,
        revision,
      });
      updateEvents(restored.events);
      setHistoryRevision(revision);
      setStatus(`Restored calendar revision ${revision.slice(0, 8)}.`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Calendar history restore failed.",
      );
    }
  };
  const restoreLatestHistory = async (): Promise<void> => {
    const listed = await api.history.list(`calendar-${id}`);
    if (!listed.ok || !listed.entries.length) {
      setStatus(
        listed.ok
          ? "Calendar history is empty."
          : "Calendar history is unavailable.",
      );
      return;
    }
    setHistoryEntries(
      listed.entries.map((entry) => ({
        sha: entry.sha,
        label: entry.label,
        action: entry.action,
        timestamp: entry.timestamp,
      })),
    );
    await restoreRevision(listed.entries[0].sha);
  };
  const loadHistory = async (): Promise<void> => {
    const listed = await api.history.list(`calendar-${id}`);
    if (listed.ok)
      setHistoryEntries(
        listed.entries.map((entry) => ({
          sha: entry.sha,
          label: entry.label,
          action: entry.action,
          timestamp: entry.timestamp,
        })),
      );
  };
  useEffect(() => {
    void loadHistory();
  }, [id, api.history]);
  const selectAllVisible = (): void =>
    setSelectedIds(new Set(viewEvents.map((event) => event.id)));
  const invertSelection = (): void =>
    setSelectedIds(
      (current) =>
        new Set(
          viewEvents
            .filter((event) => !current.has(event.id))
            .map((event) => event.id),
        ),
    );
  const bulkDelete = (target: HTMLButtonElement): void => {
    const chosen = viewEvents.filter((event) => selectedIds.has(event.id));
    if (!chosen.length) return;
    const rect = target.getBoundingClientRect();
    openDestructiveGate({
      title: "Delete selected calendar events",
      description: `Permanently delete ${chosen.length} selected event${chosen.length === 1 ? "" : "s"} from the selected calendar.`,
      affected: chosen.map((event) => event.title),
      confirmLabel: "Delete selected events",
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: target,
      onConfirm: () => {
        setBusy(true);
        bulkCancelRef.current = false;
        setBulkProgress({ done: 0, total: chosen.length });
        void (async () => {
          const removedIds = new Set<string>();
          let failures = 0;
          let done = 0;
          for (const event of chosen) {
            if (bulkCancelRef.current) break;
            try {
              if (
                await api.calendar.remove({
                  nodeId: id,
                  config,
                  eventId: event.id,
                })
              )
                removedIds.add(event.id);
            } catch {
              failures++;
            }
            done++;
            setBulkProgress({ done, total: chosen.length });
          }
          const removed = removedIds.size;
          if (removed)
            updateEvents(events.filter((event) => !removedIds.has(event.id)));
          setSelectedIds(new Set());
          setStatus(
            `${removed} selected event${removed === 1 ? "" : "s"} deleted; ${failures} failed and ${chosen.length - removed - failures} remained unchanged.`,
          );
        })().finally(() => {
          setBulkProgress(null);
          setBusy(false);
        });
      },
    });
  };
  const duplicateSelected = (): void => {
    const chosen = viewEvents.filter((event) => selectedIds.has(event.id));
    if (!chosen.length) return;
    setBusy(true);
    void Promise.all(
      chosen.map((event) =>
        api.calendar.create({
          nodeId: id,
          config,
          event: {
            ...event,
            id: undefined as never,
            updatedAt: undefined as never,
            title: `${event.title} (copy)`,
          },
        }),
      ),
    )
      .then((copies) => {
        updateEvents([...events, ...copies]);
        setSelectedIds(new Set(copies.map((event) => event.id)));
        setStatus(
          `${copies.length} event${copies.length === 1 ? "" : "s"} copied.`,
        );
      })
      .catch(() =>
        setStatus(
          "Some selected events could not be copied. Existing events remain unchanged.",
        ),
      )
      .finally(() => setBusy(false));
  };

  const importFile = async (): Promise<void> => {
    const path = await api.dialog.selectFile();
    if (!path) return;
    setBusy(true);
    try {
      const text = await api.fs.read(path);
      const imported = await api.calendar.importIcs(
        id,
        text,
        sourceName.trim().slice(0, 200) ||
          path.split(/[\\/]/).pop() ||
          "Imported ICS file",
      );
      updateEvents(imported.events);
      setSources([
        {
          id: imported.sourceId,
          accountId: null,
          provider: "ics",
          name: "Imported ICS file",
          timezone: config.timezone,
          color: "#386A20",
          readOnly: false,
          writable: true,
        },
      ]);
      setConfig({ provider: "ics", calendarId: imported.sourceId });
      setStatus(
        `${imported.events.length} event${imported.events.length === 1 ? "" : "s"} imported locally. ${imported.importReport?.rejected ?? 0} invalid event${(imported.importReport?.rejected ?? 0) === 1 ? "" : "s"} skipped. The source path was not saved.`,
      );
    } catch (error) {
      setStatus(
        `ICS import was not applied: ${error instanceof Error ? error.message : "the file could not be read"}.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const connect = async (): Promise<void> => {
    if (config.provider === "local" || config.provider === "ics") return;
    const result = await api.calendar.beginOAuth(config.provider);
    setStatus(result.reason ?? "This provider is unavailable.");
  };

  const createEvent = async (event: CalendarEvent): Promise<void> => {
    setBusy(true);
    try {
      const saved = await api.calendar.create({ nodeId: id, config, event });
      updateEvents([...events.filter((e) => e.id !== saved.id), saved]);
      setEditing(undefined);
      setStatus("Event created in the selected calendar.");
    } catch {
      setStatus(
        "The selected calendar did not confirm the write. No event was added.",
      );
    } finally {
      setBusy(false);
    }
  };
  const updateEvent = async (event: CalendarEvent): Promise<void> => {
    setBusy(true);
    try {
      const saved = await api.calendar.update({
        nodeId: id,
        config,
        eventId: event.id,
        event,
      });
      updateEvents(events.map((e) => (e.id === event.id ? (saved ?? e) : e)));
      setEditing(undefined);
      setStatus(
        saved
          ? "Event changes confirmed by the selected calendar."
          : "The selected calendar did not confirm the change; the cache was left unchanged.",
      );
    } catch {
      setStatus(
        "The provider did not confirm the edit. The offline cache was left unchanged.",
      );
    } finally {
      setBusy(false);
    }
  };
  const removeEvent = (
    event: CalendarEvent,
    target: HTMLButtonElement,
  ): void => {
    const rect = target.getBoundingClientRect();
    openDestructiveGate({
      title: "Delete this calendar event",
      description: `Permanently delete “${event.title}” from the selected calendar.`,
      affected: [event.title],
      confirmLabel: "Delete event",
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: target,
      onConfirm: () => {
        void api.calendar
          .remove({ nodeId: id, config, eventId: event.id })
          .then((ok) => {
            if (ok) updateEvents(events.filter((e) => e.id !== event.id));
            setStatus(
              ok
                ? "Event deleted."
                : "The selected calendar did not confirm deletion; no event was removed.",
            );
          })
          .catch(() =>
            setStatus(
              "Deletion was not confirmed by the selected calendar; no event was removed.",
            ),
          );
      },
    });
  };

  const account = accounts.find((a) => a.id === config.accountId);
  const source = sources.find((s) => s.id === config.calendarId);
  return (
    <div
      className={`term-node calendar-node${selected ? " selected" : ""}`}
      style={{ borderTopColor: data.color }}
    >
      <NodeResizer
        minWidth={420}
        minHeight={360}
        isVisible={selected}
        color={data.color}
      />
      <div
        className="term-node__header"
        style={{ background: `${data.color}22` }}
      >
        <IconCalendar />
        <span className="calendar-node__title">
          {data.title || ts("calendar.title", "Calendar")}
        </span>
        <span className="term-node__spacer" />
        <span className="calendar-node__state" role="status">
          {busy ? "Working…" : status}
        </span>
      </div>
      <div
        className="calendar-node__toolbar"
        role="tablist"
        aria-label={ts("calendar.views", "Calendar views")}
      >
        {(["agenda", "week", "month"] as CalendarView[]).map((view) => (
          <button
            key={view}
            id={`${id}-tab-${view}`}
            role="tab"
            aria-selected={config.view === view}
            aria-controls={`${id}-panel-${view}`}
            tabIndex={config.view === view ? 0 : -1}
            onClick={() => setConfig({ view })}
          >
            {ts(`calendar.${view}`, view[0].toUpperCase() + view.slice(1))}
          </button>
        ))}
      </div>
      <div className="calendar-node__body">
        <div className="calendar-node__filters">
          <label>
            {ts("calendar.searchEvents", "Search events")}
            <input
              ref={searchInputRef}
              value={search.value}
              onChange={(e) => search.setValue(e.target.value)}
              placeholder="Plain text search"
              aria-label={ts("calendar.searchEvents", "Search events")}
            />
          </label>
          <AnchoredRegexBuilder
            search={search}
            fieldRef={searchInputRef}
            label="Regex for calendar events"
          />
        </div>
        <div className="calendar-node__source">
          <label>
            {ts("calendar.source", "Source")}
            <select
              value={config.provider}
              onChange={(e) => {
                const provider = e.target.value as CalendarProvider;
                setConfig({
                  provider,
                  accountId: null,
                  calendarId: provider === "local" ? "local" : null,
                });
                setEvents([]);
                setStatus(providerHelp[provider]);
              }}
            >
              {PROVIDERS.filter((provider) =>
                sourceSearch.test(calendarProviderName(provider)),
              ).map((provider) => (
                <option
                  key={provider}
                  value={provider}
                  disabled={provider !== "local" && provider !== "ics"}
                >
                  {calendarProviderName(provider)}
                  {provider !== "local" && provider !== "ics"
                    ? " (unavailable)"
                    : ""}
                </option>
              ))}
            </select>
            <div className="calendar-node__picker-search">
              <input
                ref={sourceSearchRef}
                value={sourceSearch.value}
                onChange={(e) => sourceSearch.setValue(e.target.value)}
                placeholder={ts(
                  "calendar.searchSources",
                  "Filter calendar sources",
                )}
                aria-label={ts(
                  "calendar.searchSources",
                  "Filter calendar sources",
                )}
              />
              <AnchoredRegexBuilder
                search={sourceSearch}
                fieldRef={sourceSearchRef}
                label="Regex for calendar sources"
              />
            </div>
          </label>
          <p className="calendar-node__hint">{providerHelp[config.provider]}</p>
          {config.provider === "ics" && (
            <>
              <button
                type="button"
                onClick={() => void importFile()}
                disabled={busy}
              >
                Choose local ICS file…
              </button>
              <label>
                {ts("calendar.sourceName", "Source name")}
                <input
                  value={sourceName}
                  maxLength={200}
                  onChange={(event) => setSourceName(event.target.value)}
                  aria-label={ts("calendar.sourceName", "ICS source name")}
                />
              </label>
              <label>
                {ts("calendar.calendar", "ICS calendar")}
                <select
                  value={config.calendarId ?? ""}
                  onChange={(e) =>
                    setConfig({ calendarId: e.target.value || null })
                  }
                  disabled={!sources.length}
                >
                  <option value="">Choose imported source…</option>
                  {sources
                    .filter(
                      (s) =>
                        s.provider === "ics" &&
                        calendarSearch.test(`${s.name} ${s.timezone}`),
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {s.timezone}
                      </option>
                    ))}
                </select>
                <div className="calendar-node__picker-search">
                  <input
                    ref={calendarSearchRef}
                    value={calendarSearch.value}
                    onChange={(e) => calendarSearch.setValue(e.target.value)}
                    placeholder={ts(
                      "calendar.searchCalendars",
                      "Filter calendars",
                    )}
                    aria-label={ts(
                      "calendar.searchCalendars",
                      "Filter imported calendars",
                    )}
                  />
                  <AnchoredRegexBuilder
                    search={calendarSearch}
                    fieldRef={calendarSearchRef}
                    label="Regex for imported calendars"
                  />
                </div>
              </label>
            </>
          )}
          {config.provider !== "local" && config.provider !== "ics" && (
            <>
              <label>
                {ts("calendar.account", "Account")}
                <select value={config.accountId ?? ""} disabled>
                  <option value="">No trusted account adapter available</option>
                  {accounts
                    .filter(
                      (a) =>
                        a.provider === config.provider &&
                        accountSearch.test(`${a.displayName} ${a.email ?? ""}`),
                    )
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName}
                        {a.email ? ` · ${a.email}` : ""} ({a.state})
                      </option>
                    ))}
                </select>
                <div className="calendar-node__picker-search">
                  <input
                    ref={accountSearchRef}
                    value={accountSearch.value}
                    onChange={(e) => accountSearch.setValue(e.target.value)}
                    placeholder={ts(
                      "calendar.searchAccounts",
                      "Filter accounts",
                    )}
                    aria-label={ts(
                      "calendar.searchAccounts",
                      "Filter calendar accounts",
                    )}
                  />
                  <AnchoredRegexBuilder
                    search={accountSearch}
                    fieldRef={accountSearchRef}
                    label="Regex for calendar accounts"
                  />
                </div>
              </label>
              <button type="button" onClick={() => void connect()} disabled>
                Connect account unavailable
              </button>
              <p className="calendar-node__error" role="alert">
                Remote provider actions are disabled until a trusted OAuth/PKCE
                adapter is installed.
              </p>
            </>
          )}
          {config.provider !== "local" && config.provider !== "ics" && (
            <label>
              {ts("calendar.calendar", "Calendar")}
              <select
                value={config.calendarId ?? ""}
                onChange={(e) =>
                  setConfig({ calendarId: e.target.value || null })
                }
              >
                <option value="">Choose a calendar…</option>
                {sources
                  .filter((s) => calendarSearch.test(`${s.name} ${s.timezone}`))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} · {s.timezone}
                      {s.readOnly ? " (read only)" : ""}
                    </option>
                  ))}
              </select>
              <div className="calendar-node__picker-search">
                <input
                  ref={calendarSearchRef}
                  value={calendarSearch.value}
                  onChange={(e) => calendarSearch.setValue(e.target.value)}
                  placeholder={ts(
                    "calendar.searchCalendars",
                    "Filter calendars",
                  )}
                  aria-label={ts(
                    "calendar.searchCalendars",
                    "Filter calendars",
                  )}
                />
                <AnchoredRegexBuilder
                  search={calendarSearch}
                  fieldRef={calendarSearchRef}
                  label="Regex for calendars"
                />
              </div>
            </label>
          )}
          {account && (
            <p className="calendar-node__hint">
              Account status: {account.state}
              {account.reason ? ` — ${account.reason}` : ""}. Credential value
              is never shown.
            </p>
          )}
          {source && (
            <p className="calendar-node__hint">
              Selected calendar: {source.name}; writes are{" "}
              {source.writable
                ? "available"
                : "disabled because this calendar is read only"}
              .
            </p>
          )}
        </div>
        <div className="calendar-node__row">
          <label>
            {ts("calendar.timezone", "Timezone")}
            <select
              value={config.timezone}
              onChange={(e) => setConfig({ timezone: e.target.value })}
              aria-label="Calendar timezone"
            >
              {calendarTimezones()
                .filter((value) => timezoneSearch.test(value))
                .map((value) => (
                  <option key={value} value={value}>
                    {value === "local" ? "This computer" : value}
                  </option>
                ))}
            </select>
            <div className="calendar-node__picker-search">
              <input
                ref={timezoneSearchRef}
                value={timezoneSearch.value}
                onChange={(e) => timezoneSearch.setValue(e.target.value)}
                placeholder={ts("calendar.searchTimezones", "Filter timezones")}
                aria-label={ts("calendar.searchTimezones", "Filter timezones")}
              />
              <AnchoredRegexBuilder
                search={timezoneSearch}
                fieldRef={timezoneSearchRef}
                label="Regex for calendar timezones"
              />
            </div>
          </label>
          <label className="calendar-node__check">
            <input
              type="checkbox"
              checked={config.showWeekends}
              onChange={(e) => setConfig({ showWeekends: e.target.checked })}
            />{" "}
            {ts("calendar.showWeekends", "Show weekends")}
          </label>
        </div>
        <div className="calendar-node__actions">
          <button
            type="button"
            onClick={() => movePeriod(-1)}
            aria-label={ts("calendar.previous", "Previous period")}
          >
            {ts("calendar.previous", "Previous period")}
          </button>
          <strong>
            {config.view === "agenda"
              ? "Agenda"
              : cursorDate.toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
          </strong>
          <button
            type="button"
            onClick={() => movePeriod(1)}
            aria-label={ts("calendar.next", "Next period")}
          >
            {ts("calendar.next", "Next period")}
          </button>
          <button
            type="button"
            onClick={goToday}
            aria-label={ts("calendar.today", "Today")}
          >
            {ts("calendar.today", "Today")}
          </button>
          <button
            type="button"
            onClick={(event) => {
              editorOriginRef.current = event.currentTarget;
              setEditing(null);
            }}
            disabled={
              config.provider !== "local" &&
              config.provider !== "ics" &&
              !source?.writable
            }
          >
            {ts("calendar.create", "Create event")}
          </button>
          <button
            type="button"
            onClick={() =>
              void api.calendar
                .refresh(id, config)
                .then((cache) => {
                  updateEvents(cache.events);
                  setStatus(
                    cache.state === "offline"
                      ? (cache.reason ?? "Offline cache is in use.")
                      : "Calendar refreshed.",
                  );
                })
                .catch(() =>
                  setStatus(
                    "Refresh failed. The existing cache remains available.",
                  ),
                )
            }
          >
            {ts("calendar.refresh", "Refresh calendar")}
          </button>
        </div>
        <div
          id={`${id}-panel-${config.view}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${config.view}`}
          tabIndex={0}
        >
          <p className="calendar-node__cache" role="status">
            {viewEvents.length} visible event
            {viewEvents.length === 1 ? "" : "s"} · {selectedIds.size} selected ·{" "}
            {config.cacheEnabled
              ? "offline cache enabled"
              : "offline cache disabled"}
          </p>
          <div className="calendar-node__actions">
            {bulkProgress && (
              <>
                <span role="status">
                  {bulkProgress.done} of {bulkProgress.total} processed
                </span>
                <button
                  type="button"
                  onClick={() => {
                    bulkCancelRef.current = true;
                  }}
                  disabled={!busy}
                >
                  Cancel bulk action
                </button>
              </>
            )}
            <label className="calendar-node__export-format">
              {ts("calendar.exportFormat", "Export format")}
              <select
                value={exportFormat}
                onChange={(e) =>
                  setExportFormat(e.target.value as typeof exportFormat)
                }
                aria-label="Calendar export format"
              >
                <option value="json">JSON</option>
                <option value="ics">ICS</option>
                <option value="csv">CSV</option>
                <option value="markdown">Markdown</option>
              </select>
            </label>
            <button
              type="button"
              onClick={selectAllVisible}
              disabled={!viewEvents.length}
            >
              {ts("calendar.selectAll", "Select all visible")}
            </button>
            <button
              type="button"
              onClick={invertSelection}
              disabled={!viewEvents.length}
            >
              {ts("calendar.invert", "Invert selection")}
            </button>
            <button
              type="button"
              onClick={(event) => bulkDelete(event.currentTarget)}
              disabled={!selectedIds.size || busy}
            >
              {ts("calendar.deleteSelected", "Delete selected")}
            </button>
            <button
              type="button"
              onClick={duplicateSelected}
              disabled={!selectedIds.size || busy}
            >
              {ts("calendar.copySelected", "Copy selected")}
            </button>
            <button
              type="button"
              onClick={() => void exportEvents()}
              disabled={!viewEvents.length}
            >
              {ts("calendar.export", "Export visible or selected")}
            </button>
            <button
              type="button"
              onClick={() => void restoreLatestHistory()}
              disabled={busy}
            >
              {ts("calendar.restoreHistory", "Restore latest history")}
            </button>
            {historyRevision && (
              <span role="status">Restored {historyRevision.slice(0, 8)}</span>
            )}
          </div>
          <details className="calendar-node__history">
            <summary>Calendar history ({historyEntries.length})</summary>
            <div className="calendar-node__picker-search">
              <input
                ref={historySearchRef}
                value={historySearch.value}
                onChange={(event) => historySearch.setValue(event.target.value)}
                placeholder="Search calendar history"
                aria-label="Search calendar history"
              />
              <AnchoredRegexBuilder
                search={historySearch}
                fieldRef={historySearchRef}
                label="Regex for calendar history"
              />
            </div>
            <ul aria-label="Calendar history revisions">
              {historyEntries
                .filter((entry) =>
                  historySearch.test(
                    `${entry.label} ${entry.action} ${entry.sha}`,
                  ),
                )
                .map((entry) => (
                  <li key={entry.sha}>
                    <span>
                      {entry.label} · {entry.action} · {entry.sha.slice(0, 8)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void restoreRevision(entry.sha)}
                      disabled={busy}
                    >
                      Restore
                    </button>
                  </li>
                ))}
            </ul>
          </details>
          {gridCells.length > 0 && (
            <div
              className={`calendar-node__grid calendar-node__grid--${config.view}`}
              role="grid"
              aria-label={`${config.view} calendar grid`}
            >
              {gridCells.map((day) => (
                <div
                  key={day}
                  className="calendar-node__cell"
                  role="gridcell"
                  aria-label={day}
                >
                  <strong>{day}</strong>
                  {viewEvents
                    .filter(
                      (event) =>
                        calendarDateKey(event.start, config.timezone) === day,
                    )
                    .map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className={
                          selectedIds.has(event.id) ? "is-selected" : undefined
                        }
                        aria-pressed={selectedIds.has(event.id)}
                        onClick={() =>
                          toggleEventSelection(
                            event.id,
                            !selectedIds.has(event.id),
                            false,
                          )
                        }
                        onDoubleClick={(mouseEvent) => {
                          editorOriginRef.current = mouseEvent.currentTarget;
                          setEditing(event);
                        }}
                      >
                        {event.title}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          )}
          {editing !== undefined ? (
            <EventEditor
              nodeId={id}
              timezone={config.timezone}
              calendarId={config.calendarId ?? "local"}
              initial={editing ?? undefined}
              onCancel={() => setEditing(undefined)}
              onSave={(event) =>
                editing ? void updateEvent(event) : void createEvent(event)
              }
            />
          ) : config.view === "agenda" ? (
            <div
              className={`calendar-node__events calendar-node__events--${config.view}`}
              role="list"
              aria-label={`${config.view} calendar events`}
            >
              {viewEvents.length === 0 ? (
                <p className="calendar-node__empty">
                  No events match this view. Select a source or import an ICS
                  file.
                </p>
              ) : (
                viewEvents.map((event) => (
                  <article
                    key={event.id}
                    role="listitem"
                    className="calendar-node__event"
                  >
                    <div>
                      <label className="calendar-node__event-select">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(event.id)}
                          onChange={(e) =>
                            toggleEventSelection(
                              event.id,
                              e.target.checked,
                              !!(e.nativeEvent as MouseEvent).shiftKey,
                            )
                          }
                          aria-label={`Select ${event.title}`}
                        />
                        <strong>{event.title}</strong>
                      </label>
                      <span>
                        {dateLabel(event.start, config.timezone, event.allDay)}{" "}
                        to {dateLabel(event.end, config.timezone, event.allDay)}
                      </span>
                      {event.recurrence && (
                        <small>Repeats: {event.recurrence}</small>
                      )}
                      {event.location && <small>{event.location}</small>}
                    </div>
                    <div className="calendar-node__event-actions">
                      <button
                        type="button"
                        onClick={(mouseEvent) => {
                          editorOriginRef.current = mouseEvent.currentTarget;
                          setEditing(event);
                        }}
                        disabled={!!source && !source.writable}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={(e) => removeEvent(event, e.currentTarget)}
                        disabled={!!source && !source.writable}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
