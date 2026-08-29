import { readFileSync } from 'fs'
import path from 'path'
import { IPC } from '../shared/ipc'
import { platform } from './platform'
import { writeFileAtomic } from './fs-atomic'
import {
  DEFAULT_ACCENT,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  type CanvasWidgetState,
  type Settings,
} from '../shared/types'
import { DEFAULT_FUNNY_LEVEL, normalizeFunnyLevel, normalizeLanguageMode } from '../shared/i18n'
import type { HistoryAction } from '../shared/local-history'
import { mergeCanvasWidgetState } from './canvas-widget'

const NAMED_PROFILE_ID = /^named:[^\u0000-\u001f\u007f]{1,159}$/u

function normalizeNamedTerminalProfiles(value: unknown): Settings['namedTerminalProfiles'] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: Settings['namedTerminalProfiles'] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const record = candidate as Record<string, unknown>
    const id = typeof record.id === 'string' && NAMED_PROFILE_ID.test(record.id) ? record.id : undefined
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const cwd = typeof record.cwd === 'string' ? record.cwd.trim() : ''
    const startupCommand = typeof record.startupCommand === 'string' ? record.startupCommand : undefined
    if (
      !id ||
      seen.has(id) ||
      !name ||
      name.length > 120 ||
      !cwd ||
      cwd.length > 4096 ||
      startupCommand === undefined ||
      startupCommand.length > 8192 ||
      [...name, ...cwd, ...startupCommand].some((character) => character <= '\u001f' || character === '\u007f')
    ) continue
    seen.add(id)
    result.push({ id, name, cwd, startupCommand })
  }
  return result
}

/** Merge partial and legacy settings while preserving nested user choices. */
function mergeSettings(saved: Partial<Settings> | null | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...saved }
  merged.speech = { ...DEFAULT_SETTINGS.speech, ...saved?.speech }
  merged.dockerHost = { ...DEFAULT_SETTINGS.dockerHost, ...saved?.dockerHost }
  merged.modelGateway = { ...DEFAULT_SETTINGS.modelGateway, ...saved?.modelGateway }
  merged.shortcuts = { ...DEFAULT_SETTINGS.shortcuts, ...saved?.shortcuts }

  // Preserve an explicit profile id, including an unavailable id, so the resolver can fail closed.
  if (!saved || !Object.prototype.hasOwnProperty.call(saved, 'defaultTerminalProfileId')) {
    merged.defaultTerminalProfileId =
      typeof saved?.defaultShell === 'string' && saved.defaultShell.length > 0 ? 'custom' : 'auto'
  }

  // A customized legacy dictation chord becomes an explicit keybinding once, while an existing
  // keybinding, including an intentional empty override, remains authoritative.
  if (
    merged.speech.shortcut !== DEFAULT_SETTINGS.speech.shortcut &&
    !(merged.keybindings && 'speech.dictation' in merged.keybindings)
  ) {
    merged.keybindings = {
      ...(merged.keybindings ?? {}),
      'speech.dictation': [merged.speech.shortcut],
    }
  }

  // An unstamped file may contain a materialized false from the old default. Flip once, then
  // preserve the user's later opt-out permanently.
  if (!saved?.openMarkdownPreviewMigrated) {
    merged.openMarkdownPreview = true
    merged.openMarkdownPreviewMigrated = true
  }

  // The old boolean GPU setting maps into the current four-state setting.
  const gpu = (saved as { terminalGpuRendering?: unknown } | null | undefined)?.terminalGpuRendering
  if (gpu === false) merged.terminalGpuRendering = 'off'
  else if (gpu !== 'on' && gpu !== 'off' && gpu !== 'auto' && gpu !== 'shared') {
    merged.terminalGpuRendering = 'auto'
  }

  merged.languageMode = normalizeLanguageMode(saved?.languageMode)
  const savedSchema = (saved as { settingsSchemaVersion?: unknown } | null | undefined)?.settingsSchemaVersion
  if (savedSchema !== SETTINGS_SCHEMA_VERSION) merged.settingsSchemaVersion = SETTINGS_SCHEMA_VERSION
  merged.funnyLevelEn = normalizeFunnyLevel(saved?.funnyLevelEn, DEFAULT_FUNNY_LEVEL)
  merged.funnyLevelYue = normalizeFunnyLevel(saved?.funnyLevelYue, DEFAULT_FUNNY_LEVEL)

  // Carry existing installations from the former shipped accent to the current seed once.
  if (saved?.accent === '#0a84ff') merged.accent = DEFAULT_ACCENT
  if (saved?.wheelZoom === false && saved?.canvasDragMode === 'select') {
    merged.wheelZoom = true
    merged.canvasDragMode = 'pan'
  }

  merged.namedTerminalProfiles = normalizeNamedTerminalProfiles(saved?.namedTerminalProfiles)
  const defaultNamedProfileId = saved?.defaultNamedTerminalProfileId
  merged.defaultNamedTerminalProfileId =
    defaultNamedProfileId === null ||
    (typeof defaultNamedProfileId === 'string' &&
      defaultNamedProfileId.length <= 160 &&
      !/[\u0000-\u001f\u007f]/u.test(defaultNamedProfileId))
      ? defaultNamedProfileId
      : null

  return merged
}

/** Stores settings with a synchronous cache and serialized durable writes. */
export class SettingsStore {
  private cache: Settings = DEFAULT_SETTINGS
  private listeners = new Set<(s: Settings) => void>()
  private saveChain: Promise<unknown> = Promise.resolve()
  private historyRecorder?: (
    before: Settings,
    after: Settings,
    override?: { action: HistoryAction; label: string }
  ) => void | Promise<void>

  private get filePath(): string {
    return path.join(platform().userDataDir, 'settings.json')
  }

  onChange(cb: (s: Settings) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  setHistoryRecorder(
    fn: (
      before: Settings,
      after: Settings,
      override?: { action: HistoryAction; label: string }
    ) => void | Promise<void>
  ): void {
    this.historyRecorder = fn
  }

  async applyRestoredSettings(settings: Settings, label: string): Promise<void> {
    const run = this.saveChain.then(() => this.saveNow(settings, { action: 'restored', label }))
    this.saveChain = run.catch(() => {})
    return run
  }

  init(): void {
    try {
      this.cache = mergeSettings(JSON.parse(readFileSync(this.filePath, 'utf-8')))
    } catch {
      this.cache = DEFAULT_SETTINGS
    }
  }

  get(): Settings {
    return this.cache
  }

  save(settings: Settings): Promise<void> {
    const run = this.saveChain.then(() => this.saveNow(settings))
    this.saveChain = run.catch(() => {})
    return run
  }

  async updateCanvasWidget(nodeId: string, patch: Partial<CanvasWidgetState>): Promise<void> {
    const run = this.saveChain.then(() => {
      const next: Settings = {
        ...this.cache,
        canvasWidgets: {
          ...this.cache.canvasWidgets,
          [nodeId]: mergeCanvasWidgetState(this.cache.canvasWidgets[nodeId], patch),
        },
      }
      return this.saveNow(next)
    })
    this.saveChain = run.catch(() => {})
    return run
  }

  registerIpc(): void {
    platform().handle(IPC.settingsLoad, () => this.cache)
    platform().handle(IPC.settingsSave, (settings: Settings) => this.save(settings))
  }

  private async saveNow(
    settings: Settings,
    historyOverride?: { action: HistoryAction; label: string }
  ): Promise<void> {
    const before = this.cache
    this.cache = mergeSettings(settings)
    try {
      await writeFileAtomic(this.filePath, JSON.stringify(this.cache, null, 2), { mode: 0o600 })
    } catch (error) {
      this.cache = before
      throw error
    }

    for (const cb of this.listeners) {
      try {
        cb(this.cache)
      } catch {
        // A listener must never break a settings save.
      }
    }
    try {
      await this.historyRecorder?.(before, this.cache, historyOverride)
    } catch {
      // History is best effort and must never fail the settings save.
    }
  }
}
