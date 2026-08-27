declare module 'js-yaml' {
  export function load(source: string, options?: { json?: boolean; schema?: unknown }): unknown
}
