import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ServerDeploymentService, resolveServerDeploymentRoot } from './server-deployment'

describe('resolveServerDeploymentRoot', () => {
  const repoRoot = 'C:\\repo'
  const resourcesPath = 'C:\\install\\resources'
  const packagedRoot = path.join(resourcesPath, 'server-deployment')
  const packagedHostBat = path.join(packagedRoot, 'host.bat')

  it('returns the packaged server-deployment directory when packaged and host.bat exists there', () => {
    const exists = (p: string) => p === packagedHostBat
    const result = resolveServerDeploymentRoot({ isPackaged: true, resourcesPath, repoRoot, exists })
    expect(result).toBe(packagedRoot)
  })

  it('returns the repo root in dev (unpackaged), even if resourcesPath is set', () => {
    const exists = (p: string) => p === packagedHostBat
    const result = resolveServerDeploymentRoot({ isPackaged: false, resourcesPath, repoRoot, exists })
    expect(result).toBe(repoRoot)
  })

  it('falls back to the repo root when packaged but the packaged host.bat is missing', () => {
    const exists = () => false
    const result = resolveServerDeploymentRoot({ isPackaged: true, resourcesPath, repoRoot, exists })
    expect(result).toBe(repoRoot)
  })

  it('falls back to the repo root when packaged but resourcesPath is unavailable', () => {
    const exists = (p: string) => p === packagedHostBat
    const result = resolveServerDeploymentRoot({ isPackaged: true, resourcesPath: null, repoRoot, exists })
    expect(result).toBe(repoRoot)
  })

  it('falls back to the repo root when the existence check throws', () => {
    const exists = () => {
      throw new Error('unreadable')
    }
    const result = resolveServerDeploymentRoot({ isPackaged: true, resourcesPath, repoRoot, exists })
    expect(result).toBe(repoRoot)
  })
})

describe('ServerDeploymentService.start', () => {
  it.skipIf(process.platform !== 'win32')(
    'reports the honest "deployment files are missing" error when host.bat is absent at the resolved root',
    async () => {
      const emptyRoot = mkdtempSync(path.join(tmpdir(), 'nodeterm-server-deployment-test-'))
      try {
        const service = new ServerDeploymentService(emptyRoot)
        const result = await service.start()
        expect(result.ok).toBe(false)
        expect(result.state).toBe('failed')
        expect(result.error).toBe('The Server Edition deployment files are missing.')
      } finally {
        rmSync(emptyRoot, { recursive: true, force: true })
      }
    }
  )
})
