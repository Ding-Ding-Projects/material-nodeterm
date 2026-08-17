import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker'
import CssWorker from 'monaco-editor/languages/features/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/languages/features/html/html.worker?worker'
import TsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker'
import { createMonacoWorker } from './monaco-worker-routing'

const workerConstructors = {
  editor: EditorWorker,
  json: JsonWorker,
  css: CssWorker,
  html: HtmlWorker,
  typescript: TsWorker
}

// Bundle Monaco's language workers locally (no CDN) so it works offline in Electron.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return createMonacoWorker(label, workerConstructors)
  }
}

export { monaco }
