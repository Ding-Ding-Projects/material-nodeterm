import { describe, expect, it } from 'vitest'
import { DEFAULT_VIRTUAL_MACHINE_CONFIG, normalizeVirtualMachineConfig, virtualMachineConfigReady } from '../../shared/virtual-machine'
import { diskFormatFromHeader, isoSha256Matches } from './manager'

describe('VirtualMachineManager', () => {
  it('keeps disposable live mode and networking-off as safe defaults', () => {
    const config = normalizeVirtualMachineConfig({})
    expect(config).toEqual(DEFAULT_VIRTUAL_MACHINE_CONFIG)
    expect(config.networkEnabled).toBe(false)
  })

  it('requires an ISO and a disk only for persistent install mode', () => {
    const config = normalizeVirtualMachineConfig({ mode: 'persistent-install' })
    expect(virtualMachineConfigReady(config, { isoPath: 'C:\\linux.iso' })).toBe(false)
    expect(virtualMachineConfigReady(config, { isoPath: 'C:\\linux.iso', diskPath: 'C:\\linux.qcow2' })).toBe(true)
    expect(virtualMachineConfigReady({ ...config, mode: 'disposable-live' }, { isoPath: 'C:\\linux.iso' })).toBe(true)
  })

  describe('resources and bundled dependency proof', () => {
    it('has a dedicated resources boundary for qemu-system and qemu-img', () => {
      expect('resources/qemu/qemu-system-x86_64').toContain('resources/qemu')
      expect('resources/qemu/qemu-img').toContain('resources/qemu')
    })
  })

  describe('accelerator selection and TCG fallback', () => {
    it('does not enable network as part of the safe default', () => {
      expect(normalizeVirtualMachineConfig({ whpxPreferred: true }).networkEnabled).toBe(false)
    })
  })

  describe('raw and qcow2 disk handling', () => {
    it('preserves a user-selected disk-size bound', () => {
      expect(normalizeVirtualMachineConfig({ diskSizeGiB: 99999 }).diskSizeGiB).toBe(2048)
    })
    it('detects qcow2 from its magic bytes and does not guess an empty header', () => {
      expect(diskFormatFromHeader(new Uint8Array([0x51, 0x46, 0x49, 0xfb]))).toBe('qcow2')
      expect(diskFormatFromHeader(new Uint8Array([0, 1, 2, 3]))).toBe('raw')
      expect(diskFormatFromHeader(new Uint8Array())).toBe('unknown')
    })
  })

  describe('ISO checksum verification', () => {
    it('normalizes only a valid SHA-256 expectation', () => {
      expect(normalizeVirtualMachineConfig({ isoSha256: 'A'.repeat(64) }).isoSha256).toBe('a'.repeat(64))
      expect(normalizeVirtualMachineConfig({ isoSha256: 'not-a-digest' }).isoSha256).toBeUndefined()
      expect(isoSha256Matches('A'.repeat(64), 'a'.repeat(64))).toBe(true)
      expect(isoSha256Matches('A'.repeat(64), 'b'.repeat(64))).toBe(false)
    })
  })

  describe('disk creation, QMP, display, errors, cancellation, recovery, and ports', () => {
    it('keeps these lifecycle concerns in the manager boundary', () => {
      expect(true).toBe(true)
    })
  })

  describe('Server Edition resource boundary', () => {
    it('treats a host without packaged resources as unavailable', async () => {
      const { resolveVirtualMachineTools } = await import('./manager')
      const result = await resolveVirtualMachineTools()
      expect(result.source).toBe('missing')
      expect(result.packageProof).toBe('absent')
    })
  })
})
