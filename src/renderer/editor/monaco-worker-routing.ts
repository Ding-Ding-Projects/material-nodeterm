export interface MonacoWorkerConstructors<T> {
  editor: new () => T
  json: new () => T
  css: new () => T
  html: new () => T
  typescript: new () => T
}

/**
 * Constructs the worker Monaco expects for a language label. Keeping this decision independent
 * from Vite's worker imports lets the routing contract run without loading the editor bundle.
 */
export function createMonacoWorker<T>(
  label: string,
  constructors: MonacoWorkerConstructors<T>
): T {
  if (label === 'json') return new constructors.json()
  if (label === 'css' || label === 'scss' || label === 'less') return new constructors.css()
  if (label === 'html' || label === 'handlebars' || label === 'razor') {
    return new constructors.html()
  }
  if (label === 'typescript' || label === 'javascript') return new constructors.typescript()
  return new constructors.editor()
}
