import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR_NODE_CONFIG,
  calendarWallTimeToInstant,
  isCalendarConfig,
  parseIcsDetailed,
} from "./calendar";

const ics = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:America/Toronto\r\n${body}\r\nEND:VCALENDAR\r\n`;
const event = (body: string) => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT\r\n`;

describe("calendar source contracts", () => {
  it("rejects unknown config keys and invalid node intent", () => {
    expect(isCalendarConfig(DEFAULT_CALENDAR_NODE_CONFIG)).toBe(true);
    expect(
      isCalendarConfig({ ...DEFAULT_CALENDAR_NODE_CONFIG, extra: true }),
    ).toBe(false);
    expect(
      isCalendarConfig({
        ...DEFAULT_CALENDAR_NODE_CONFIG,
        timezone: "Not/Iana",
      }),
    ).toBe(false);
  });

  it("converts IANA wall time around DST with deterministic gap handling", () => {
    expect(
      calendarWallTimeToInstant("2026-03-08T02:30:00", "America/Toronto"),
    ).toBe("2026-03-08T07:30:00.000Z");
    expect(
      calendarWallTimeToInstant("2026-11-01T01:30:00", "America/Toronto"),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("accepts valid events, deduplicates UID, and reports malformed records individually", () => {
    const parsed = parseIcsDetailed(
      ics(
        event(
          "UID:one\r\nDTSTART:20260826T100000\r\nDTEND:20260826T110000\r\nSUMMARY:One",
        ) +
          event(
            "UID:one\r\nDTSTART:20260826T120000\r\nDTEND:20260826T130000\r\nSUMMARY:Duplicate",
          ) +
          event(
            "UID:bad\r\nDTSTART:not-a-date\r\nDTEND:20260826T130000\r\nSUMMARY:Bad",
          ),
      ),
    );
    expect(parsed.events).toHaveLength(1);
    expect(parsed.report.accepted).toBe(1);
    expect(parsed.report.skipped).toBe(1);
    expect(parsed.report.rejected).toBe(1);
  });

  it("expands bounded weekly recurrence and applies EXDATE", () => {
    const parsed = parseIcsDetailed(
      ics(
        event(
          "UID:weekly\r\nDTSTART;TZID=America/Toronto:20260824T100000\r\nDTEND;TZID=America/Toronto:20260824T110000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEXDATE;TZID=America/Toronto:20260831T100000\r\nSUMMARY:Weekly",
        ),
      ),
    );
    expect(parsed.events).toHaveLength(2);
    expect(
      parsed.events.every((entry) => entry.timezone === "America/Toronto"),
    ).toBe(true);
  });

  it("supports all-day end dates and bounded duration", () => {
    const parsed = parseIcsDetailed(
      ics(
        event(
          "UID:day\r\nDTSTART;VALUE=DATE:20260826\r\nDTEND;VALUE=DATE:20260827\r\nSUMMARY:Day",
        ) +
          event(
            "UID:duration\r\nDTSTART:20260826T100000Z\r\nDURATION:PT30M\r\nSUMMARY:Half hour",
          ),
      ),
    );
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events.find((entry) => entry.id === "day")?.allDay).toBe(
      true,
    );
    expect(parsed.events.find((entry) => entry.id === "duration")?.end).toBe(
      "2026-08-26T10:30:00.000Z",
    );
  });

  it("keeps RDATE additions and refuses unsupported recurrence instead of guessing", () => {
    const parsed = parseIcsDetailed(
      ics(
        event(
          "UID:rdate\r\nDTSTART:20260826T100000Z\r\nDTEND:20260826T110000Z\r\nRDATE:20260827T100000Z,20260828T100000Z\r\nSUMMARY:R dates",
        ) +
          event(
            "UID:unsupported\r\nDTSTART:20260826T100000Z\r\nDTEND:20260826T110000Z\r\nRRULE:FREQ=HOURLY;COUNT=2\r\nSUMMARY:Unsupported",
          ),
      ),
    );
    expect(
      parsed.events.filter((entry) => entry.id.startsWith("rdate")).length,
    ).toBe(3);
    expect(parsed.report.rejected).toBe(1);
    expect(parsed.report.issues[0]?.action).toBe("rejected");
  });

  it("expands recurring wall times across a daylight-saving transition", () => {
    const parsed = parseIcsDetailed(
      ics(
        event(
          "UID:dst\r\nDTSTART;TZID=America/Toronto:20261031T013000\r\nDTEND;TZID=America/Toronto:20261031T023000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:DST",
        ),
      ),
    );
    expect(parsed.events.map((entry) => entry.start)).toEqual([
      "2026-10-31T05:30:00.000Z",
      "2026-11-01T05:30:00.000Z",
      "2026-11-02T06:30:00.000Z",
    ]);
  });

  it("uses an IANA location declared by a VTIMEZONE component", () => {
    const parsed = parseIcsDetailed(
      `BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nTZID:Toronto Alias\r\nX-LIC-LOCATION:America/Toronto\r\nEND:VTIMEZONE\r\nBEGIN:VEVENT\r\nUID:alias\r\nDTSTART;TZID=Toronto Alias:20260826T100000\r\nDTEND;TZID=Toronto Alias:20260826T110000\r\nSUMMARY:Alias\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    );
    expect(parsed.events[0]?.timezone).toBe("America/Toronto");
    expect(parsed.events[0]?.start).toBe("2026-08-26T14:00:00.000Z");
  });
});
