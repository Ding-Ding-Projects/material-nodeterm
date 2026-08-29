// Compatibility entry point for the Home Assistant integration modules.
// The implementation is kept in the shell-agnostic sibling module so both the desktop and Server
// Edition registrars share exactly one client and one validation boundary.
export {
  HomeAssistantClient,
  HomeAssistantManager,
  registerHomeAssistantIpc,
  validateHomeAssistantBaseUrl
} from '../home-assistant'
