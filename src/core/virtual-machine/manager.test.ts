import { describe, expect, it } from 'vitest'
import { DEFAULT_VIRTUAL_MACHINE_CONFIG, normalizeVirtualMachineConfig, virtualMachineConfigReady, absoluteVirtualMachinePath } from '../../shared/virtual-machine'
import { diskFormatFromHeader, iso9660SignatureFromHeader, isoSha256Matches, qemuDiskBlockdevArgs } from './manager'

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

  it('rejects relative and control-character asset paths before any process launch', () => {
    expect(absoluteVirtualMachinePath('relative.iso')).toBe(false)
    expect(absoluteVirtualMachinePath('C:\\guest\u0000.iso')).toBe(false)
    expect(absoluteVirtualMachinePath('C:\\images\\linux.iso')).toBe(true)
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
      expect(diskFormatFromHeader(new Uint8Array([0, 1, 2, 3]))).toBe('unknown')
      expect(diskFormatFromHeader(new Uint8Array())).toBe('unknown')
    })
    it('requires an explicit raw selection and keeps commas in a structured blockdev filename', () => {
      expect(diskFormatFromHeader(new Uint8Array([0x51, 0x46, 0x49, 0xfb]))).toBe('qcow2')
      expect(qemuDiskBlockdevArgs('C:\\VMs\\guest,unsafe.qcow2', 'qcow2').some((value) => value.includes('guest,unsafe.qcow2'))).toBe(true)
      expect(qemuDiskBlockdevArgs('C:\\VMs\\guest,unsafe.qcow2', 'qcow2')).not.toContain('-drive')
    })
  })

  describe('ISO checksum verification', () => {
    it('normalizes only a valid SHA-256 expectation', () => {
      expect(normalizeVirtualMachineConfig({ isoSha256: 'A'.repeat(64) }).isoSha256).toBe('a'.repeat(64))
      expect(normalizeVirtualMachineConfig({ isoSha256: 'not-a-digest' }).isoSha256).toBeUndefined()
      expect(isoSha256Matches('A'.repeat(64), 'a'.repeat(64))).toBe(true)
      expect(isoSha256Matches('A'.repeat(64), 'b'.repeat(64))).toBe(false)
      expect(iso9660SignatureFromHeader(new TextEncoder().encode('CD001'))).toBe(true)
      expect(iso9660SignatureFromHeader(new TextEncoder().encode('NOPE!'))).toBe(false)
    })
  })

  describe('disk creation, QMP, display, errors, cancellation, recovery, and ports', () => {
    it('keeps lifecycle arguments bounded and refuses an external display scheme', () => {
      const args = qemuDiskBlockdevArgs('C:\\VMs\\guest.qcow2', 'qcow2')
      expect(args).toContain('virtio-blk-pci,drive=vm-disk')
      expect(args.some((value) => value.startsWith('vnc://'))).toBe(false)
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
