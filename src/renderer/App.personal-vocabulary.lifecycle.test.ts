// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { applyVocabulary } from './lib/personalVocabulary/apply'
import { nativeCopyProjection } from './lib/personalVocabulary/nativeCopy'
import { usePersonalVocabulary } from './state/personalVocabulary'
import { useSchoolMode } from './state/schoolMode'
import { NativeCopyStore } from '../main/native-copy-store'
import { NATIVE_COPY_SLOTS } from '../shared/native-copy-projection'

const CACHE_KEY = 'nodeterm.personalVocabulary.v1'

function resetStores(): void {
  localStorage.clear()
  usePersonalVocabulary.setState({
    status: 'no-file',
    entries: {},
    entryCount: 0,
    loadedAt: null,
    lastError: null
  })
  useSchoolMode.setState({ enabled: false, hydrated: false, name: 'School mode' })
}

afterEach(resetStores)

describe('application-owned personal-vocabulary lifecycle', () => {
  it('hydrates with no file as fail-closed original wording', () => {
    usePersonalVocabulary.getState().hydrate()

    expect(usePersonalVocabulary.getState()).toMatchObject({ status: 'no-file', entries: {}, entryCount: 0 })
    expect(applyVocabulary('source-label', usePersonalVocabulary.getState().entries)).toBe('source-label')
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('accepts a neutral mapping and projects mapped copy while preserving a chosen display label', () => {
    const uploaded = usePersonalVocabulary.getState().upload(
      '{"schemaVersion":1,"entries":{"source-label":"mapped-label"}}'
    )
    expect(uploaded).toEqual({ ok: true, entryCount: 1 })

    const map = (value: string): string => applyVocabulary(value, usePersonalVocabulary.getState().entries)
    const projection = nativeCopyProjection(3, map, { appDisplayName: 'Chosen title' })

    expect(projection.entries.find((entry) => entry.slot === 'app.displayName')?.segments[0]).toEqual({
      kind: 'copy',
      value: 'Chosen title'
    })
    expect(projection.entries).toHaveLength(NATIVE_COPY_SLOTS.length)
    expect(projection.entries.every((entry) => entry.segments.length === 1)).toBe(true)
  })

  it('keeps the accepted projection when a replacement upload is rejected', () => {
    const store = new NativeCopyStore()
    const epoch = store.attach(42)
    const accepted = nativeCopyProjection(epoch, (value) => value.replace('File', 'Mapped file'))
    expect(store.replace(42, accepted)).toMatchObject({ ok: true, epoch })
    const before = store.get('menu.file', 'File')

    const rejected = { ...accepted, entries: accepted.entries.slice(0, -1) }
    expect(store.replace(42, rejected)).toMatchObject({ ok: false })
    expect(store.get('menu.file', 'File')).toBe(before)
  })

  it('clears memory and cache immediately, including after School mode is enabled', () => {
    expect(usePersonalVocabulary.getState().upload(
      '{"schemaVersion":1,"entries":{"source-label":"mapped-label"}}'
    )).toEqual({ ok: true, entryCount: 1 })
    useSchoolMode.setState({ enabled: true, hydrated: true })
    const map = (value: string): string =>
      useSchoolMode.getState().enabled ? value : applyVocabulary(value, usePersonalVocabulary.getState().entries)
    expect(map('source-label')).toBe('source-label')

    usePersonalVocabulary.getState().clear()
    expect(usePersonalVocabulary.getState()).toMatchObject({ status: 'no-file', entries: {}, entryCount: 0 })
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(map('source-label')).toBe('source-label')
  })

  it('does not let School mode projection code re-enable mapped copy until it is off', () => {
    const entries = { 'source-label': 'mapped-label' }
    useSchoolMode.setState({ enabled: true, hydrated: true })
    const schoolMap = (value: string): string =>
      useSchoolMode.getState().enabled ? value : applyVocabulary(value, entries)
    expect(schoolMap('source-label')).toBe('source-label')

    useSchoolMode.setState({ enabled: false, hydrated: true })
    expect(schoolMap('source-label')).toBe('mapped-label')
  })

  it('refuses stale projections after renderer navigation and leaves original copy active', () => {
    const store = new NativeCopyStore()
    const firstEpoch = store.attach(7)
    const first = nativeCopyProjection(firstEpoch, (value) => `mapped:${value}`)
    expect(store.replace(7, first)).toMatchObject({ ok: true, epoch: firstEpoch })
    const secondEpoch = store.reset()

    expect(store.replace(7, first)).toMatchObject({ ok: false, reason: 'stale projection epoch', epoch: secondEpoch })
    expect(store.get('menu.file', 'File')).toBe('File')
  })

  it('admits only the current sender and keeps a rejected sender from rebuilding native menu copy', () => {
    const store = new NativeCopyStore()
    const epoch = store.attach(9)
    const projection = nativeCopyProjection(epoch, (value) => `mapped:${value}`)

    expect(store.replace(10, projection)).toMatchObject({
      ok: false,
      reason: 'native-copy sender is not the main window',
      epoch
    })
    expect(store.get('menu.settings', 'Settings')).toBe('Settings')
    expect(store.replace(9, projection)).toMatchObject({ ok: true, epoch })
    expect(store.get('menu.settings', 'Settings')).toBe('mapped:Settings')
  })
})
