/** The small state slice every School-mode capability gate needs. */
export interface SchoolModeGateState {
  enabled: boolean
  hydrated: boolean
}

/**
 * Optional capabilities covered by School mode may run only after a successful read proved the
 * mode is OFF. Treating the pre-hydration default (`enabled: false`) as permission briefly leaked
 * Cantonese copy, vocabulary substitutions and DimSum while the shared record was still loading.
 * A failed read is not evidence of absence, so unknown stays suppressed until a load or live
 * change supplies a real record.
 */
export function schoolModeAllowsOptionalFeatures(state: SchoolModeGateState): boolean {
  return state.hydrated && !state.enabled
}
