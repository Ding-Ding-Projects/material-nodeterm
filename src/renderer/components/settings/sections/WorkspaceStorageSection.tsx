import { useSettings } from '../../../state/settings'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { NumberField } from '@renderer/ui/NumberField'
import { Select } from '@renderer/ui/Select'
import { DEFAULT_SETTINGS } from '@shared/types'

const ROWS = {
  partSize: {
    title: 'Split large projects into parts',
    keywords: [
      'split',
      'parts',
      'project.json',
      'manifest',
      'chunk',
      'size',
      'diff',
      'git',
      'canvas',
      'large'
    ]
  }
}
const ENTRIES = Object.values(ROWS)

/**
 * Only the DEFAULT size an explicit split offers — never a save-time switch. See
 * WorkspaceStore.splitProjectIntoParts's own doc comment: turning this on/off must never resize or
 * re-encode a project on its own. The actual split/join action (per project, needs a cwd) lives in
 * the project switcher's per-row actions panel, where it can show the project's CURRENT storage
 * state rather than a bare button.
 */
export function WorkspaceStorageSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  return (
    <SettingsSection
      id="workspace-storage"
      title="Project storage"
      description="Only affects the size an explicit split offers next — changing it never resizes or re-encodes a project on its own."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.partSize}>
        <FieldRow
          callsiteId="settings.workspace-storage.split"
          label="Split large projects into parts"
          description="A canvas's .nodeterm/project.json can be split into sized parts + a manifest instead of one ever-growing file — useful for a large canvas kept in git, for reviewable diffs, or when some tool chokes on one big file. Split or join a specific project from its ⋮ menu in the project switcher; this only sets the size a new split offers."
          noteSegments={
            settings.projectPartSizeValue === DEFAULT_SETTINGS.projectPartSizeValue &&
            settings.projectPartSizeUnit === DEFAULT_SETTINGS.projectPartSizeUnit
              ? [
                  { kind: 'copy', value: 'Using the built-in default (' },
                  { kind: 'fact', value: String(DEFAULT_SETTINGS.projectPartSizeValue) },
                  { kind: 'fact', value: ` ${DEFAULT_SETTINGS.projectPartSizeUnit}` },
                  { kind: 'copy', value: ') — nobody has changed this yet.' }
                ]
              : [
                  { kind: 'copy', value: 'Set to ' },
                  { kind: 'fact', value: String(settings.projectPartSizeValue) },
                  { kind: 'fact', value: ` ${settings.projectPartSizeUnit}` },
                  { kind: 'copy', value: ' (built-in default is ' },
                  { kind: 'fact', value: String(DEFAULT_SETTINGS.projectPartSizeValue) },
                  { kind: 'fact', value: ` ${DEFAULT_SETTINGS.projectPartSizeUnit}` },
                  { kind: 'copy', value: ').' }
                ]
          }
          control={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <NumberField
                value={settings.projectPartSizeValue}
                min={1}
                max={999}
                step={1}
                onChange={(v) =>
                  update({
                    projectPartSizeValue: Number.isFinite(v) && v > 0 ? v : settings.projectPartSizeValue
                  })
                }
              />
              <Select
                value={settings.projectPartSizeUnit}
                onChange={(e) =>
                  update({ projectPartSizeUnit: e.target.value as 'KB' | 'MB' | 'GB' })
                }
                aria-label="Part size unit"
              >
                <option value="KB">KB</option>
                <option value="MB">MB</option>
                <option value="GB">GB</option>
              </Select>
            </div>
          }
        />
      </SearchableRow>
    </SettingsSection>
  )
}
