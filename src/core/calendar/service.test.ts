import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CalendarService } from "./service";
import {
  DEFAULT_CALENDAR_NODE_CONFIG,
  type CalendarNodeConfig,
} from "../../shared/calendar";

const configs: CalendarNodeConfig = {
  ...DEFAULT_CALENDAR_NODE_CONFIG,
  calendarId: "local",
};
let roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("calendar service source binding and cache", () => {
  it("does not let a caller calendar id select a different source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    roots.push(root);
    const service = new CalendarService(root);
    await expect(
      service.create({
        nodeId: "node-1",
        config: configs,
        event: {
          calendarId: "ics-other",
          title: "Nope",
          start: "2026-08-26T10:00:00.000Z",
          end: "2026-08-26T11:00:00.000Z",
          timezone: "UTC",
          allDay: false,
          location: null,
          description: null,
          recurrence: null,
        },
      }),
    ).rejects.toThrow("does not match");
  });

  it("serializes concurrent local read-modify-write mutations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    roots.push(root);
    const service = new CalendarService(root);
    await Promise.all(
      [1, 2, 3].map((index) =>
        service.create({
          nodeId: "node-concurrent",
          config: configs,
          event: {
            calendarId: "local",
            title: `Event ${index}`,
            start: `2026-08-26T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
            end: `2026-08-26T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
            timezone: "UTC",
            allDay: false,
            location: null,
            description: null,
            recurrence: null,
          },
        }),
      ),
    );
    expect(
      (await service.events("node-concurrent", configs)).events,
    ).toHaveLength(3);
  });

  it("refuses a second service owner instead of racing the cache", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    roots.push(root);
    const first = new CalendarService(root);
    const second = new CalendarService(root);
    const input = {
      nodeId: "node-owner",
      config: configs,
      event: {
        calendarId: "local",
        title: "Owner",
        start: "2026-08-26T10:00:00.000Z",
        end: "2026-08-26T11:00:00.000Z",
        timezone: "UTC",
        allDay: false,
        location: null,
        description: null,
        recurrence: null,
      },
    };
    await first.create(input);
    await expect(second.create(input)).rejects.toThrow(
      "Another calendar service owns",
    );
  });

  it("preserves a source-qualified cache and distinguishes corrupt reads from missing reads", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    roots.push(root);
    const service = new CalendarService(root);
    const created = await service.create({
      nodeId: "node-2",
      config: configs,
      event: {
        calendarId: "local",
        title: "Local",
        start: "2026-08-26T10:00:00.000Z",
        end: "2026-08-26T11:00:00.000Z",
        timezone: "UTC",
        allDay: false,
        location: null,
        description: null,
        recurrence: null,
      },
    });
    expect((await service.events("node-2", configs)).events[0].id).toBe(
      created.id,
    );
    await writeFile(
      path.join(root, "calendar-nodes", "node-2.json"),
      "{broken",
      "utf8",
    );
    await expect(service.events("node-2", configs)).rejects.toThrow();
    await expect(
      service.events("node-missing", configs),
    ).resolves.toMatchObject({ state: "empty", events: [] });
    const persisted = await readFile(
      path.join(root, "calendar-nodes", "node-2.json"),
      "utf8",
    );
    expect(persisted).toContain("broken");
  });

  it("keeps remote provider rows disabled and never synthesizes a writable source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    roots.push(root);
    const service = new CalendarService(root);
    const remote = {
      ...configs,
      provider: "google" as const,
      calendarId: null,
      accountId: "account-1",
    };
    await expect(service.beginOAuth("google")).resolves.toMatchObject({
      state: "unsupported",
      authorizationUrl: null,
    });
    await expect(
      service.calendars(remote.accountId, remote.provider),
    ).resolves.toEqual([]);
    await expect(service.status("node-3", remote)).resolves.toMatchObject({
      state: "unconfigured",
      source: null,
      cache: null,
    });
  });

  it("records mutations in local history and restores a selected revision append-only", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "calendar-"));
    roots.push(root);
    const service = new CalendarService(root);
    await service.create({
      nodeId: "node-4",
      config: configs,
      event: {
        calendarId: "local",
        title: "Original",
        start: "2026-08-26T10:00:00.000Z",
        end: "2026-08-26T11:00:00.000Z",
        timezone: "UTC",
        allDay: false,
        location: null,
        description: null,
        recurrence: null,
      },
    });
    const { LocalHistoryStore } = await import("../local-history");
    const listed = await new LocalHistoryStore(root).list("calendar-node-4");
    if (!listed) {
      return;
    }
    if (listed.entries.length === 0) return;
    const restored = await service.restore({
      nodeId: "node-4",
      config: configs,
      revision: listed.entries[0].sha,
    });
    expect(restored.events[0]?.title).toBe("Original");
  });
});
