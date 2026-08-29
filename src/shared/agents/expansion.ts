/** Controlled `${env:NAME}` expansion for custom-agent launch data. Values are supplied by the
 * caller, never read from a renderer-global environment, so previews and trusted launch paths can
 * share the same decision. */
const ENV_TOKEN = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}/g

export interface ExpansionResult {
  value: string
  missing: string[]
}

export function expandEnvVars(
  input: string,
  env: Record<string, string | undefined>
): ExpansionResult {
  if (!input.includes('${env:')) return { value: input, missing: [] }
  const missing: string[] = []
  const value = input.replace(ENV_TOKEN, (_token, name: string, fallback: string | undefined) => {
    const current = env[name]
    if (current !== undefined && current !== '') return current
    if (fallback !== undefined) return fallback
    missing.push(name)
    return ''
  })
  return { value, missing }
}

export function preservesInheritedPath(value: string | undefined): boolean {
  return !value || value.includes('${env:PATH}')
}
