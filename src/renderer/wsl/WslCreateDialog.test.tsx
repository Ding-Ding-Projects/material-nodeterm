// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WslCreateDialog, WSL_COPY_IDS } from './WslCreateDialog'
import { resetDialogStack } from '../components/dialog-stack'
import type { WslCatalogueEntry } from './wslCoreApi'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { useSettings } from '../state/settings'
import { DEFAULT_SETTINGS } from '@shared/types'
import { CATALOG } from '@shared/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CATALOGUE: WslCatalogueEntry[] = [
  { id: 'ubuntu-24.04', label: 'Ubuntu 24.04 LTS' },
  { id: 'debian', label: 'Debian' },
  { id: 'alpine', label: 'Alpine' }
]

describe('WslCreateDialog', () => {
  let root: Root | undefined
  let host: HTMLElement

  beforeEach(() => {
    resetDialogStack()
    useSchoolMode.setState({ enabled: false, hydrated: true })
    useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: true })
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    host.remove()
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: true })
  })


  const setInputValue = (el: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  function render(overrides: Partial<React.ComponentProps<typeof WslCreateDialog>> = {}) {
    const onCreate = vi.fn()
    const onCancelCreate = vi.fn(async () => true)
    const onCancel = vi.fn()
    root = createRoot(host)
    act(() => {
      root!.render(
        <WslCreateDialog
          catalogue={CATALOGUE}
          catalogueLoading={false}
          catalogueError={null}
          existingNames={new Set(['docker-desktop'])}
          busy={false}
          error={null}
          onCreate={onCreate}
          onCancelCreate={onCancelCreate}
          onCancel={onCancel}
          {...overrides}
        />
      )
    })
    return { onCreate, onCancel, onCancelCreate }
  }

  it('lists the catalogue and disables Create until a distro and a valid name are chosen', () => {
    render()
    const createBtn = document.querySelector('button.confirm__actions button:last-child') as HTMLButtonElement
    // fall back to text match if class selectors above miss the exact structure
    const buttons = Array.from(document.querySelectorAll('button'))
    const create = buttons.find((b) => b.textContent === 'Create')!
    expect(create.disabled).toBe(true)
    expect(create.title).toMatch(/choose a distribution/i)
    void createBtn
  })

  it('enables Create and calls onCreate with the trimmed name once valid', () => {
    const { onCreate } = render()
    const option = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Ubuntu 24.04 LTS')!
    act(() => option.click())
    const nameInput = document.querySelector('input[aria-label="WSL instance name"]') as HTMLInputElement
    act(() => setInputValue(nameInput, 'my-project'))
    const create = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Create')!
    expect(create.disabled).toBe(false)
    act(() => create.click())
    act(() => create.click())
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ catalogueId: 'ubuntu-24.04', name: 'my-project' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('keeps Create disabled while an operation is busy', () => {
    render({ busy: true })
    const create = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Creating…') as HTMLButtonElement
    expect(create.disabled).toBe(true)
  })

  it('refuses a name colliding with a real distribution on this machine', () => {
    render()
    const option = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Debian')!
    act(() => option.click())
    const nameInput = document.querySelector('input[aria-label="WSL instance name"]') as HTMLInputElement
    act(() => setInputValue(nameInput, 'docker-desktop'))
    const create = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Create')!
    expect(create.disabled).toBe(true)
    expect(document.body.textContent).toMatch(/already exists/i)
  })

  it('Escape cancels', () => {
    const { onCancel } = render()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onCancel).toHaveBeenCalled()
  })

  it('filters the distro list via the search field', () => {
    render()
    const search = document.querySelector('input[aria-label="Filter distributions"]') as HTMLInputElement
    act(() => setInputValue(search, 'alp'))
    const options = Array.from(document.querySelectorAll('[role="option"]')).map((el) => el.textContent)
    expect(options).toEqual(['Alpine'])
  })

  it('maps authored dialog copy while keeping distribution and instance facts exact', () => {
    usePersonalVocabulary.setState({
      entries: {
        'New {brand} instance': 'New {brand} Linux workspace',
        'Filter distributions': 'Find distributions',
        Create: 'Make it happen'
      },
      status: 'loaded',
      entryCount: 3,
      loadedAt: Date.now(),
      lastError: null
    })
    render({ error: 'wsl.exe could not create "my-project" from "Ubuntu 24.04 LTS".' })
    expect(document.body.textContent).toContain('New WSL Linux workspace')
    expect(document.querySelector('input[aria-label="Find distributions"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Ubuntu 24.04 LTS')
    expect(document.body.textContent).toContain('my-project')
    expect(document.body.textContent).toContain('wsl.exe could not create')
    expect(document.body.textContent).toContain('Make it happen')
  })

  it('keeps catalogue and bridge error facts outside mapped authored copy', () => {
    const parserDetail = 'wsl.exe: parser rejected Ubuntu 24.04 LTS at C:\\work\\my-project.'
    render({
      catalogueError: parserDetail,
      error: 'wsl.exe could not create "my-project" from "Ubuntu 24.04 LTS".'
    })
    expect(document.body.textContent).toContain('Could not load available distributions:')
    expect(document.body.textContent).toContain(parserDetail)
    expect(document.body.textContent).toContain('The WSL operation reported an error:')
    expect(document.body.textContent).toContain('wsl.exe could not create "my-project" from "Ubuntu 24.04 LTS".')
  })

  it('suppresses uploaded vocabulary in School mode without hiding WSL facts', () => {
    usePersonalVocabulary.setState({
      entries: { 'New {brand} instance': 'Secret {brand} workspace', 'Filter distributions': 'Secret filter' },
      status: 'loaded',
      entryCount: 2,
      loadedAt: Date.now(),
      lastError: null
    })
    render()
    expect(document.body.textContent).toContain('Secret workspace')
    act(() => root?.unmount())
    root = undefined
    useSchoolMode.setState({ enabled: true, hydrated: true })
    render()
    expect(document.body.textContent).toContain('New WSL instance')
    expect(document.body.textContent).not.toContain('Secret workspace')
    expect(document.querySelector('input[aria-label="Filter distributions"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Ubuntu 24.04 LTS')
  })

  it('ships five English and Cantonese variants for every WSL dialog copy entry', () => {
    const ids = [...new Set(Object.values(WSL_COPY_IDS))]
    expect(ids.every((id) => !id.includes('WSL'))).toBe(true)
    expect(CATALOG[WSL_COPY_IDS.title]?.en[0]).toContain('{brand}')
    expect(CATALOG[WSL_COPY_IDS.progressTelemetry]?.en[0]).toContain('{exe}')
    for (const id of ids) {
      expect(CATALOG[id]?.en, id).toHaveLength(5)
      expect(CATALOG[id]?.yue, id).toHaveLength(5)
    }
  })

  it('renders the dialog copy in English, Cantonese, and bilingual modes at both funny levels', () => {
    const modes = ['en', 'yue', 'bilingual'] as const
    for (const mode of modes) {
      for (const level of [1, 5] as const) {
        useSettings.setState({
          settings: { ...DEFAULT_SETTINGS, languageMode: mode, funnyLevelEn: level, funnyLevelYue: level },
          base: { ...DEFAULT_SETTINGS, languageMode: mode, funnyLevelEn: level, funnyLevelYue: level },
          hydrated: true
        })
        render()
        const description = document.querySelector('.wsl-create-dialog__description')?.textContent ?? ''
        expect(description.length, `${mode}/${level}`).toBeGreaterThan(0)
        if (mode === 'en' && level === 1) expect(description).toContain('Choose a distribution')
        if (mode === 'yue' && level === 1) expect(description).toContain('喺即時 WSL')
        if (mode === 'bilingual') expect(description).toContain(' · ')
        act(() => root?.unmount())
        root = undefined
      }
    }
  })

  it('renders live phase progress while preserving raw distribution, name, and operation facts', () => {
    let onProgress: ((progress: {
      operationId: string
      stage: 'validating' | 'checking' | 'installing' | 'recording' | 'completed' | 'failed' | 'cancelled'
      step: number
      steps: number
      determinate: boolean
      elapsedMs: number
      message: string
    }) => void) | null = null
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      wsl: {
        onCreateProgress: (listener: typeof onProgress) => {
          onProgress = listener
          return () => {
            onProgress = null
          }
        }
      }
    }
    const { onCreate } = render()
    const option = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Ubuntu 24.04 LTS')!
    act(() => option.click())
    const nameInput = document.querySelector('input[aria-label="WSL instance name"]') as HTMLInputElement
    act(() => setInputValue(nameInput, 'my-project'))
    const create = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Create')!
    act(() => create.click())
    expect(document.querySelector('[role="progressbar"]')).not.toBeNull()
    const createdOperationId = onCreate.mock.calls[0][0].operationId as string
    act(() => {
      onProgress?.({
        operationId: createdOperationId,
        stage: 'installing',
        step: 3,
        steps: 4,
        determinate: false,
        elapsedMs: 2500,
        message: `Installing Ubuntu 24.04 LTS for my-project, operation ${createdOperationId}.`
      })
    })
    expect(document.body.textContent).toContain('Ubuntu 24.04 LTS')
    expect(document.body.textContent).toContain('my-project')
    expect(document.body.textContent).toContain(createdOperationId)
    expect(document.querySelector('[aria-label="WSL creation phase progress"]')).not.toBeNull()
  })
})
