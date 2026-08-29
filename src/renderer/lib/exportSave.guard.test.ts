import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// These are the renderer's export call sites. Preview and attachment lifecycles have a different
// ownership contract, so the source check is deliberately scoped to export helpers rather than treating
// every temporary Blob URL as a download.
const EXPORT_CALL_SITES = [
  resolve(rendererRoot, 'nodes', 'RepositoryGraphNode.tsx'),
  resolve(rendererRoot, 'components', 'ollama', 'OllamaManagerPanel.tsx'),
  resolve(rendererRoot, 'components', 'settings', 'sections', 'AuthenticatorSection.tsx'),
  resolve(rendererRoot, 'components', 'NotificationCenter.tsx')
]

describe('renderer download ownership', () => {
  it('keeps object URL creation and revocation in the shared download primitive', () => {
    const offenders = EXPORT_CALL_SITES.filter((path) => {
      const source = readFileSync(path, 'utf8')
      return /URL\.(?:createObjectURL|revokeObjectURL)\s*\(/.test(source)
    })
    expect(offenders).toEqual([])
  })
})
