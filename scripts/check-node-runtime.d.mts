export const NODE_RUNTIME_RANGE: string
export function supportsNodeRuntimeVersion(version: string): boolean
export function assertNodeRuntime(
  version?: string,
  loadBuiltin?: (id: string) => unknown
): void
