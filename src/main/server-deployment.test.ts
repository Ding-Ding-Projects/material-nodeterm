import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ServerDeploymentService, classifyComposeFailure, resolveServerDeploymentRoot } from './server-deployment'

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

describe('classifyComposeFailure', () => {
  it('names the port as the blocker when Docker refuses to bind it, and keeps the raw evidence', () => {
    const msg = classifyComposeFailure('Error response from daemon: Ports are not available: exposing port TCP 0.0.0.0:8443 -> 0.0.0.0:0: listen tcp 0.0.0.0:8443: bind: address already in use')
    expect(msg).toMatch(/^Port 8443 is already in use/)
    expect(msg).toContain('address already in use')
  })

  it('names a build failure distinctly from a port/permission failure', () => {
    const msg = classifyComposeFailure('#12 ERROR: failed to solve: process "/bin/sh -c npm run build:app" did not complete successfully: exit code: 1')
    expect(msg).toMatch(/^The server image failed to build:/)
  })

  it('reports the build error instead of Docker Desktop dashboard metadata', () => {
    const msg = classifyComposeFailure([
      'failed to solve: process "npm run build" did not complete successfully: exit code: 1',
      'View build details: docker-desktop://dashboard/build/default/default/abc123'
    ].join('\n'))
    expect(msg).toBe(
      'The server image failed to build: failed to solve: process "npm run build" did not complete successfully: exit code: 1'
    )
    expect(msg).not.toContain('docker-desktop://')
  })

  it('names a permission failure distinctly', () => {
    const msg = classifyComposeFailure('Error response from daemon: mkdir /var/lib/docker/volumes/x: permission denied')
    expect(msg).toMatch(/^Docker refused a required action/)
  })

  it('falls back to the raw message for an error it does not recognize, rather than inventing a category', () => {
    const msg = classifyComposeFailure('some genuinely novel docker error nobody has seen before')
    expect(msg).toBe('some genuinely novel docker error nobody has seen before')
  })

  it('never claims an unknown reason when the raw message is empty', () => {
    expect(classifyComposeFailure('   ')).toBe('The server deployment failed for an unknown reason.')
  })
})

describe('ServerDeploymentService.status/onProgress', () => {
  it('reports not-running before any deployment has completed in this process', () => {
    const service = new ServerDeploymentService('C:\\wherever')
    expect(service.status()).toEqual({ running: false })
  })

  it('onProgress returns an unsubscribe function that actually stops delivery', () => {
    const service = new ServerDeploymentService('C:\\wherever')
    const seen: string[] = []
    const unsub = service.onProgress((stage) => seen.push(stage))
    // Reach the private emitter the same way `startOnce` does, without running a real deployment
    // (which needs win32 + Docker). This is testing the pub/sub contract, not the deployment flow.
    ;(service as unknown as { emitStage(s: string): void }).emitStage('checking-docker')
    expect(seen).toEqual(['checking-docker'])
    unsub()
    ;(service as unknown as { emitStage(s: string): void }).emitStage('installing-docker')
    expect(seen).toEqual(['checking-docker'])
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
        expect(result.error).toBe('The Server Edition deployment files are missing from this install. Reinstall nodeterm.')
      } finally {
        rmSync(emptyRoot, { recursive: true, force: true })
      }
    }
  )
})
