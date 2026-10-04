/**
 * The key an environment object ALREADY holds its search path under. POSIX spells it `PATH`; a
 * spread of Windows' `process.env` spells it `Path` (the OS is case-insensitive, a plain object is
 * not). Writing `PATH` onto a Windows copy therefore does not update the path: reading only `PATH`
 * drops the user's path, and writing it adds a second, case-insensitively equal variable beside
 * it, and which one the child reads is up to the child's runtime. An exact `PATH` wins when
 * present; no key at all answers `PATH`.
 */
export function envPathKey(env: Record<string, string | undefined>): string {
  if ('PATH' in env) return 'PATH'
  return Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
}
