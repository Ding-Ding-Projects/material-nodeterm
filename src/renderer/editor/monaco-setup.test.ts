import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const workerClasses = vi.hoisted(() => ({
  EditorWorker: class EditorWorker {},
  JsonWorker: class JsonWorker {},
  CssWorker: class CssWorker {},
  HtmlWorker: class HtmlWorker {},
  TypeScriptWorker: class TypeScriptWorker {}
}))

vi.mock('monaco-editor', () => ({}))
vi.mock('monaco-editor/editor/editor.worker?worker', () => ({
  default: workerClasses.EditorWorker
}))
vi.mock('monaco-editor/languages/features/json/json.worker?worker', () => ({
  default: workerClasses.JsonWorker
}))
vi.mock('monaco-editor/languages/features/css/css.worker?worker', () => ({
  default: workerClasses.CssWorker
}))
vi.mock('monaco-editor/languages/features/html/html.worker?worker', () => ({
  default: workerClasses.HtmlWorker
}))
vi.mock('monaco-editor/languages/features/typescript/ts.worker?worker', () => ({
  default: workerClasses.TypeScriptWorker
}))

interface MonacoEnvironmentFixture {
  MonacoEnvironment: {
    getWorker(workerId: string, label: string): unknown
  }
}

let environment: MonacoEnvironmentFixture['MonacoEnvironment']

beforeAll(async () => {
  vi.stubGlobal('self', {})
  await import('./monaco-setup')
  environment = (self as unknown as MonacoEnvironmentFixture).MonacoEnvironment
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('Monaco worker routing', () => {
  it.each([
    ['json', workerClasses.JsonWorker],
    ['css', workerClasses.CssWorker],
    ['scss', workerClasses.CssWorker],
    ['less', workerClasses.CssWorker],
    ['html', workerClasses.HtmlWorker],
    ['handlebars', workerClasses.HtmlWorker],
    ['razor', workerClasses.HtmlWorker],
    ['typescript', workerClasses.TypeScriptWorker],
    ['javascript', workerClasses.TypeScriptWorker],
    ['editorWorkerService', workerClasses.EditorWorker],
    ['', workerClasses.EditorWorker],
    ['JSON', workerClasses.EditorWorker]
  ])('constructs the correct worker for the %s label', (label, ExpectedWorker) => {
    expect(environment.getWorker('worker-id', label)).toBeInstanceOf(ExpectedWorker)
  })
})
