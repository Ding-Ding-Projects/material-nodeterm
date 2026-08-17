// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppLogoCustomImage, AppLogoSettings } from '@shared/types'

const { processLogoFileMock } = vi.hoisted(() => ({ processLogoFileMock: vi.fn() }))
vi.mock('@renderer/lib/appearance/logoProcess', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/lib/appearance/logoProcess')>()
  return { ...actual, processLogoFile: processLogoFileMock }
})

import { useSettings } from '../../../state/settings'
import { AppIdentitySection } from './AppIdentitySection'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function image(sourceName: string, fit: AppLogoCustomImage['fit'] = 'contain'): AppLogoCustomImage {
  return {
    dataUrl: `data:image/png;base64,${sourceName}`,
    mime: 'image/png',
    width: 512,
    height: 512,
    sourceName,
    fit,
    backgroundColor: '#00000000',
    crop: { x: 0, y: 0, width: 1, height: 1 }
  }
}

function setLogo(appLogo: AppLogoSettings): void {
  useSettings.setState((state) => ({
    base: { ...state.base, appLogo },
    settings: { ...state.settings, appLogo }
  }))
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function fileInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input).toBeTruthy()
  return input!
}

function chooseFile(name: string): void {
  const input = fileInput()
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })]
  })
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
}

function clickPreset(label: string): void {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Use the ${label} logo"]`)
  expect(button, label).toBeTruthy()
  act(() => button!.click())
}

beforeEach(() => {
  processLogoFileMock.mockReset()
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    settings: { save: vi.fn(async () => undefined) }
  }
  setLogo({ selection: 'shipped' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<AppIdentitySection isActive />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setLogo({ selection: 'shipped' })
})

describe('app logo selection', () => {
  it('keeps a custom image when a shipped preset is chosen, so it can be selected again', () => {
    const kept = image('kept.png')
    act(() => setLogo({ selection: 'custom', customImage: kept }))
    clickPreset('Ocean')
    expect(useSettings.getState().settings.appLogo).toEqual({
      selection: 'ocean',
      customImage: kept
    })

    const custom = host.querySelector<HTMLButtonElement>('button[aria-label="Use the custom uploaded logo"]')
    expect(custom?.disabled).toBe(false)
    act(() => custom!.click())
    expect(useSettings.getState().settings.appLogo).toEqual({
      selection: 'custom',
      customImage: kept
    })
  })

  it('does not let an older upload completion overwrite a newer preset choice', async () => {
    const kept = image('kept.png')
    act(() => setLogo({ selection: 'custom', customImage: kept }))
    const old = deferred<{ ok: true; image: AppLogoCustomImage }>()
    processLogoFileMock.mockReturnValueOnce(old.promise)

    chooseFile('slow-old.png')
    expect(host.textContent).toContain('Processing…')
    clickPreset('Ember')
    expect(host.textContent).not.toContain('Processing…')

    await act(async () => {
      old.resolve({ ok: true, image: image('slow-old.png') })
      await old.promise
    })
    expect(useSettings.getState().settings.appLogo).toEqual({
      selection: 'ember',
      customImage: kept
    })
  })

  it('keeps the newest fit when two canvas processes complete out of order', async () => {
    processLogoFileMock.mockResolvedValueOnce({ ok: true, image: image('initial.png') })
    await act(async () => {
      chooseFile('initial.png')
      await Promise.resolve()
    })

    const cover = deferred<{ ok: true; image: AppLogoCustomImage }>()
    const fill = deferred<{ ok: true; image: AppLogoCustomImage }>()
    processLogoFileMock.mockReturnValueOnce(cover.promise).mockReturnValueOnce(fill.promise)

    const chooseFit = (value: string) => {
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Logo fit"]')
      expect(select).toBeTruthy()
      act(() => {
        select!.value = value
        select!.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    chooseFit('cover')
    chooseFit('fill')

    await act(async () => {
      fill.resolve({ ok: true, image: image('initial.png', 'fill') })
      await fill.promise
    })
    await act(async () => {
      cover.resolve({ ok: true, image: image('initial.png', 'cover') })
      await cover.promise
    })
    expect(useSettings.getState().settings.appLogo.customImage?.fit).toBe('fill')
  })
})
