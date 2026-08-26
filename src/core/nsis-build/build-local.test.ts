import { describe, it, expect } from 'vitest'
import { buildLocal } from './build-local'

const input = {
  script: '; nsis script\nOutFile "out.exe"\n',
  outputPath: 'C:\\out\\out.exe',
  cwd: 'C:\\project',
}

const foundOnPath = {
  run: async () => ({ stdout: 'v3.10', stderr: '' }),
  platform: 'win32' as const,
}

describe('buildLocal', () => {
  it('refuses to build when makensis cannot be found', async () => {
    const result = await buildLocal(input, {
      find: {
        run: async () => {
          throw new Error('not found')
        },
        exists: () => false,
        platform: 'win32',
      },
      run: async () => {
        throw new Error('compile should never be attempted')
      },
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('makensis-not-found')
    expect(result.makensis.found).toBe(false)
  })

  it('reports compile-failed on a non-zero makensis exit, with real stdout/stderr', async () => {
    const result = await buildLocal(input, {
      find: foundOnPath,
      run: async () => ({ exitCode: 1, stdout: 'compiling...', stderr: 'Error: undefined symbol' }),
      writeFile: async () => {},
      statSize: () => null,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('compile-failed')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('undefined symbol')
  })

  it('never claims success from exit 0 alone -- refuses when the output file is missing', async () => {
    const result = await buildLocal(input, {
      find: foundOnPath,
      run: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      writeFile: async () => {},
      statSize: () => null, // output file does not exist
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-output')
  })

  it('never claims success when the output file exists but is empty', async () => {
    const result = await buildLocal(input, {
      find: foundOnPath,
      run: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      writeFile: async () => {},
      statSize: () => 0,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-output')
  })

  it('reports ok:true only when exit 0 AND a real non-empty output file exist', async () => {
    let scriptWritten: string | null = null
    const result = await buildLocal(input, {
      find: foundOnPath,
      run: async () => ({ exitCode: 0, stdout: 'compiled ok', stderr: '' }),
      writeFile: async (_p, data) => {
        scriptWritten = data
      },
      statSize: () => 123456,
    })
    expect(result.ok).toBe(true)
    expect(result.outputBytes).toBe(123456)
    expect(scriptWritten).toContain('OutFile')
  })

  it('never invokes makensis through a shell string (always an argument array)', async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = []
    await buildLocal(input, {
      find: foundOnPath,
      run: async (file, args, cwd) => {
        calls.push({ file, args, cwd })
        return { exitCode: 0, stdout: 'ok', stderr: '' }
      },
      writeFile: async () => {},
      statSize: () => 10,
    })
    expect(calls.length).toBe(1)
    // The script path is one argv entry, never embedded in a larger string.
    expect(calls[0].args.length).toBe(1)
    expect(calls[0].args[0]).toMatch(/\.nsi$/)
    expect(calls[0].cwd).toBe(input.cwd)
  })
})
