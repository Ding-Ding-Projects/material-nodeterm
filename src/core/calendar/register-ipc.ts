import { IPC } from '../../shared/ipc'
import type { CalendarCalDavConnectInput, CalendarCreateInput, CalendarNodeConfig, CalendarProvider, CalendarUpdateInput } from '../../shared/calendar'
import type { CorePlatform } from '../platform'
import { CalendarService } from './service'

export function registerCalendarIpc(platform: CorePlatform): CalendarService {
  const service = new CalendarService(platform)
  platform.handle(IPC.calendarStatus, (id: string, config: CalendarNodeConfig) => service.status(id, config))
  platform.handle(IPC.calendarAccounts, () => service.accounts())
  platform.handle(IPC.calendarCalendars, (accountId: string | null, provider: CalendarProvider) => service.calendars(accountId, provider))
  platform.handle(IPC.calendarEvents, (id: string, config: CalendarNodeConfig) => service.events(id, config))
  platform.handle(IPC.calendarImportIcs, (id: string, text: string, name?: string) => service.importIcs(id, text, name))
  platform.handle(IPC.calendarRefresh, (id: string, config: CalendarNodeConfig) => service.refresh(id, config))
  platform.handle(IPC.calendarBeginOAuth, (provider: Exclude<CalendarProvider, 'local' | 'ics'>) => service.beginOAuth(provider))
  platform.handle(IPC.calendarConnectCalDav, (input: CalendarCalDavConnectInput) => service.connectCalDav(input))
  platform.handle(IPC.calendarDisconnectAccount, (accountId: string) => service.disconnectAccount(accountId))
  platform.handle(IPC.calendarCreate, (input: CalendarCreateInput) => service.create(input))
  platform.handle(IPC.calendarUpdate, (input: CalendarUpdateInput) => service.update(input))
  platform.handle(IPC.calendarRemove, (id: string, eventId: string) => service.remove(id, eventId))
  return service
}
