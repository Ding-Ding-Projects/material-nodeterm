export const REPO_ROOT: string
export const ALLOWLIST_PATH: string
export function scanRawControls(root?: string): string[]
export function readAllowlist(file?: string): string[]
export function evaluate(offenders: string[], allowlist: string[]): { newOffenders: string[]; stale: string[] }
