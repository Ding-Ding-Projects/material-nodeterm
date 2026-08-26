import { describe, it, expect } from 'vitest'
import { renderCiWorkflow } from './ci-workflow'

describe('renderCiWorkflow', () => {
  const base = {
    scriptPath: 'installer/installer.nsi',
    artifactName: 'my-app-installer',
    outputPath: 'installer/dist/Setup.exe',
  }

  it('targets a Windows runner and pins actions to a major version', () => {
    const yaml = renderCiWorkflow(base)
    expect(yaml).toContain('runs-on: windows-latest')
    expect(yaml).toMatch(/uses: actions\/checkout@v\d+/)
    expect(yaml).toMatch(/uses: actions\/upload-artifact@v\d+/)
  })

  it('uploads the compiled installer as an artifact under the given name', () => {
    const yaml = renderCiWorkflow(base)
    expect(yaml).toContain('name: my-app-installer')
    expect(yaml).toContain('path: installer/dist/Setup.exe')
    expect(yaml).toContain('if-no-files-found: error')
  })

  it('compiles the exact given script path', () => {
    const yaml = renderCiWorkflow(base)
    expect(yaml).toContain('installer/installer.nsi')
  })

  it('has a concurrency group, matching this repo house style', () => {
    const yaml = renderCiWorkflow(base)
    expect(yaml).toMatch(/concurrency:\s*\n\s*group:/)
    expect(yaml).toContain('cancel-in-progress: true')
  })

  it('never emits a release/publish step -- building and shipping are different authorities', () => {
    const yaml = renderCiWorkflow(base)
    expect(yaml).not.toMatch(/gh release/)
    expect(yaml).not.toMatch(/softprops\/action-gh-release/)
    expect(yaml).not.toMatch(/release:\s*create|create-release/i)
  })
})
