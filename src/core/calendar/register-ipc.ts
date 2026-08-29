import { IPC } from "../../shared/ipc";
import type {
  CalendarCreateInput,
  CalendarNodeConfig,
  CalendarProvider,
  CalendarRemoveInput,
  CalendarRestoreInput,
  CalendarUpdateInput,
} from "../../shared/calendar";
import type { CorePlatform } from "../platform";
import { CalendarService } from "./service";

export function registerCalendarIpc(platform: CorePlatform): CalendarService {
  const service = new CalendarService(platform.userDataDir);
  platform.handle(
    IPC.calendarStatus,
    (id: string, config: CalendarNodeConfig) => {
      if (typeof id !== "string")
        throw new Error("Calendar node id is invalid.");
      return service.status(id, config);
    },
  );
  platform.handle(IPC.calendarAccounts, () => service.accounts());
  platform.handle(
    IPC.calendarCalendars,
    (accountId: string | null, provider: CalendarProvider) => {
      if (accountId !== null && typeof accountId !== "string")
        throw new Error("Calendar account id is invalid.");
      if (
        !["local", "ics", "caldav", "google", "microsoft365"].includes(provider)
      )
        throw new Error("Calendar provider is invalid.");
      return service.calendars(accountId, provider);
    },
  );
  platform.handle(
    IPC.calendarEvents,
    (id: string, config: CalendarNodeConfig) => {
      if (typeof id !== "string")
        throw new Error("Calendar node id is invalid.");
      return service.events(id, config);
    },
  );
  platform.handle(
    IPC.calendarImportIcs,
    (id: string, text: string, name?: string) =>
      service.importIcs(id, text, name),
  );
  platform.handle(
    IPC.calendarRefresh,
    (id: string, config: CalendarNodeConfig) => {
      if (typeof id !== "string")
        throw new Error("Calendar node id is invalid.");
      return service.refresh(id, config);
    },
  );
  platform.handle(
    IPC.calendarBeginOAuth,
    (provider: Exclude<CalendarProvider, "local" | "ics">) => {
      if (!["caldav", "google", "microsoft365"].includes(provider))
        throw new Error("Remote calendar provider is invalid.");
      return service.beginOAuth(provider);
    },
  );
  platform.handle(IPC.calendarCreate, (input: CalendarCreateInput) =>
    service.create(input),
  );
  platform.handle(IPC.calendarUpdate, (input: CalendarUpdateInput) =>
    service.update(input),
  );
  platform.handle(IPC.calendarRemove, (input: CalendarRemoveInput) =>
    service.remove(input),
  );
  platform.handle(IPC.calendarRestore, (input: CalendarRestoreInput) =>
    service.restore(input),
  );
  return service;
}
