// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useWsl } from './wsl'
import type { WslCatalogueError } from '@shared/wsl'

describe('useWsl catalogue error boundary', () => {
  beforeEach(() => {
    useWsl.setState({ catalogue: [], catalogueLoading: false, catalogueError: null })
  })

  it('keeps a typed production catalogue failure for the dialog renderer', async () => {
    const raw = Object.assign(new Error('wsl.exe parser detail'), {
      code: 'parse-failed',
      messageId: 'catalogueParseFailed',
      facts: ['wsl.exe'],
      detail: 'wsl.exe parser detail'
    }) satisfies Error & WslCatalogueError
    ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      wsl: {
        catalogue: async () => { throw raw }
      }
    }

    await useWsl.getState().loadCatalogue()

    expect(useWsl.getState().catalogueError).toEqual({
      ownership: 'external-factual',
      text: 'wsl.exe parser detail',
      facts: ['wsl.exe'],
      authoredTemplate: 'catalogueParseFailed'
    })
  })
})
