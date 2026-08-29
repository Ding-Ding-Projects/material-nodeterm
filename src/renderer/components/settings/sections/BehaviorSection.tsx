import { useSettings } from '../../../state/settings'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'
import { NumberField } from '@renderer/ui/NumberField'
import { Select } from '@renderer/ui/Select'
import { SegmentedPill } from '@renderer/ui/SegmentedPill'
import { Input } from '@renderer/ui/Input'
import { hintLabel } from '@shared/platform-utils'
import { DEFAULT_WORKTREE_PATH_TEMPLATE } from '@shared/worktree'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useI18n } from '@renderer/lib/i18n'
import { clampWheelZoomSpeed } from '@renderer/canvas/wheel-zoom'
import { Slider } from '@renderer/ui/md3'
import { SectionReset } from '../SectionReset'
import { BEHAVIOR_RESET_KEYS } from '@renderer/lib/settingsReset'

const ROWS = {
  defaultView: {
    title: 'Default view',
    keywords: ['default', 'view', 'kanban', 'board', 'canvas', 'project']
  },
  gridSize: { title: 'Grid size', keywords: ['grid', 'size', 'snap'] },
  nodeSize: {
    title: 'Default node size',
    keywords: ['node', 'size', 'width', 'height', 'terminal', 'default']
  },
  snap: { title: 'Snap to grid', keywords: ['snap', 'grid', 'align'] },
  autoAlign: {
    title: 'Snap to grid mode (auto-arrange)',
    keywords: ['snap', 'grid', 'align', 'arrange', 'auto', 'mode']
  },
  panHover: { title: 'Pan-hover delay (ms)', keywords: ['pan', 'hover', 'delay', 'focus', 'guard'] },
  doubleClick: { title: 'Double-click to focus', keywords: ['double', 'click', 'focus'] },
  mdPreview: {
    title: 'Open Markdown in preview',
    keywords: ['markdown', 'md', 'mdown', 'mkd', 'preview', 'render', 'editor', 'docs', 'readme', 'file']
  },
  sidebarCollapse: {
    title: 'Sidebar: collapse inactive by default',
    keywords: ['sidebar', 'sessions', 'collapse', 'expand', 'project', 'switch', 'group', 'tree']
  },
  sidebarGrouping: {
    title: 'Sidebar: group by',
    keywords: ['sidebar', 'sessions', 'group', 'status', 'project', 'attention']
  },
  worktreePath: {
    title: 'Worktree path template',
    keywords: ['worktree', 'git', 'path', 'folder', 'repo', 'branch', 'template']
  },
  wheelZoom: { title: 'Scroll wheel zooms', keywords: ['zoom', 'wheel', 'scroll', 'mouse', 'pan'] },
  wheelZoomSpeed: {
    title: 'Wheel zoom speed',
    keywords: ['zoom', 'wheel', 'speed', 'sensitivity', 'step', 'jump', 'mouse', 'scroll']
  },
  trackpadPan: {
    title: 'Trackpad scroll pans',
    keywords: ['trackpad', 'pan', 'scroll', 'zoom', 'magic', 'mouse', 'two-finger', 'macos']
  },
  dragMode: {
    title: 'Canvas left-drag',
    keywords: ['pan', 'drag', 'select', 'canvas', 'mouse', 'grab', 'figma', 'miro']
  },
  browserSaver: {
    title: 'Browser memory saver',
    keywords: ['browser', 'memory', 'saver', 'ram', 'webview', 'discard', 'page', 'web']
  },
  keepAwake: {
    title: 'Keep awake while agents work',
    keywords: ['sleep', 'awake', 'power', 'battery', 'suspend', 'run']
  },
  confirmQuit: {
    title: 'Confirm before quitting',
    keywords: ['quit', 'exit', 'close', 'confirm', 'dialog', 'ask']
  },
  reset: { title: 'Reset behavior', keywords: ['reset', 'defaults', 'behavior'] }
}
const ENTRIES = Object.values(ROWS)

export function BehaviorSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const baseSettings = useSettings((s) => s.base)
  const settingsHydrated = useSettings((s) => s.hydrated)
  const update = useSettings((s) => s.update)
  const { t, ts } = useI18n()
  const wheelZoomSpeed = clampWheelZoomSpeed(settings.wheelZoomSpeed)
  const baseWheelZoomSpeed = clampWheelZoomSpeed(baseSettings.wheelZoomSpeed)
  const rawBaseWheelZoomSpeed = baseSettings.wheelZoomSpeed as unknown
  const rawBaseWheelZoomSpeedNumber =
    typeof rawBaseWheelZoomSpeed === 'number' ? rawBaseWheelZoomSpeed : null
  const baseWheelZoomSpeedIsInvalid =
    rawBaseWheelZoomSpeedNumber === null || !Number.isFinite(rawBaseWheelZoomSpeedNumber)
  const baseWheelZoomSpeedIsOutOfRange =
    rawBaseWheelZoomSpeedNumber !== null &&
    Number.isFinite(rawBaseWheelZoomSpeedNumber) &&
    (rawBaseWheelZoomSpeedNumber < 0.2 || rawBaseWheelZoomSpeedNumber > 2)
  let wheelZoomSpeedProvenance
  if (!settingsHydrated) {
    wheelZoomSpeedProvenance = t(
      'settings.behavior.wheelZoomSpeed.provenance.loading',
      'Using the compiled-in 1.0× value while saved settings load.'
    )
  } else if (wheelZoomSpeed !== baseWheelZoomSpeed) {
    wheelZoomSpeedProvenance = t(
      'settings.behavior.wheelZoomSpeed.provenance.scheduled',
      'A scheduled value is active. The saved base value is {speed}×.',
      { speed: baseWheelZoomSpeed.toFixed(1) }
    )
  } else if (baseWheelZoomSpeedIsInvalid) {
    wheelZoomSpeedProvenance = t(
      'settings.behavior.wheelZoomSpeed.provenance.invalid',
      'The saved value is invalid; using the compiled-in 1.0× value.'
    )
  } else if (baseWheelZoomSpeedIsOutOfRange) {
    wheelZoomSpeedProvenance = t(
      'settings.behavior.wheelZoomSpeed.provenance.clamped',
      'The saved value is outside 0.2×–2.0×; using the clamped value of {speed}×.',
      { speed: baseWheelZoomSpeed.toFixed(1) }
    )
  } else if (baseWheelZoomSpeed === DEFAULT_SETTINGS.wheelZoomSpeed) {
    wheelZoomSpeedProvenance = t(
      'settings.behavior.wheelZoomSpeed.provenance.default',
      'Matches the compiled-in default of 1.0×. An explicit saved 1.0× cannot be distinguished from that same value.'
    )
  } else {
    wheelZoomSpeedProvenance = t(
      'settings.behavior.wheelZoomSpeed.provenance.saved',
      'Using the saved value from settings.json.'
    )
  }
  const wheelZoomSpeedLabel = ts('settings.behavior.wheelZoomSpeed.label', 'Wheel zoom speed')
  const wheelZoomSpeedDescription = t(
    'settings.behavior.wheelZoomSpeed.description',
    'How far one plain wheel click zooms. Lower it if one click jumps too far.'
  )
  return (
    <SettingsSection id="behavior" title="Behavior" isActive={isActive} searchEntries={ENTRIES}>
      <SearchableRow {...ROWS.defaultView}>
        <FieldRow
          label="Default view"
          description="How a project opens when you haven't switched it. Projects you toggle keep their own choice."
          control={
            <Select
              aria-label="Default view"
              value={settings.defaultProjectView === 'kanban' ? 'kanban' : 'canvas'}
              onChange={(e) => update({ defaultProjectView: e.target.value as 'canvas' | 'kanban' })}
            >
              <option value="canvas">Canvas</option>
              <option value="kanban">Kanban board</option>
            </Select>
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.gridSize}>
        <FieldRow
          label="Grid size"
          control={
            <NumberField
              value={settings.gridSize}
              min={8}
              max={96}
              onChange={(v) => update({ gridSize: v || 24 })}
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.nodeSize}>
        <FieldRow
          label="Default node size (px)"
          description="Size new terminal and agent nodes open at. Existing nodes keep their size."
          control={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <NumberField
                value={settings.defaultNodeWidth}
                min={280}
                max={2400}
                step={20}
                onChange={(v) => update({ defaultNodeWidth: v || 640 })}
              />
              <span style={{ opacity: 0.6 }}>×</span>
              <NumberField
                value={settings.defaultNodeHeight}
                min={160}
                max={1600}
                step={20}
                onChange={(v) => update({ defaultNodeHeight: v || 440 })}
              />
            </div>
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.snap}>
        <FieldRow
          label="Snap to grid"
          control={
            <Switch
              checked={settings.snapToGrid}
              onChange={(v) => update({ snapToGrid: v })}
              ariaLabel="Snap to grid"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.autoAlign}>
        <FieldRow
          label="Snap to grid mode"
          description="Arranges every node to the grid at the moment you turn it on — like a desktop “Auto arrange”. Distinct from the drag-snap toggle above, which only constrains dragging."
          control={
            <Switch
              checked={settings.autoAlignGrid}
              onChange={(v) => update({ autoAlignGrid: v })}
              ariaLabel="Snap to grid mode"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.panHover}>
        <FieldRow
          label="Pan-hover delay (ms)"
          control={
            <NumberField
              value={settings.panHoverDelay}
              min={0}
              max={2000}
              step={50}
              onChange={(v) => update({ panHoverDelay: v || 0 })}
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.doubleClick}>
        <FieldRow
          label="Double-click to focus"
          control={
            <Switch
              checked={settings.doubleClickFocus}
              onChange={(v) => update({ doubleClickFocus: v })}
              ariaLabel="Double-click to focus"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.mdPreview}>
        <FieldRow
          label="Open Markdown in preview"
          description="Markdown files open rendered instead of as editable text. The Preview/Edit toggle still switches either way."
          control={
            <Switch
              checked={settings.openMarkdownPreview}
              onChange={(v) => update({ openMarkdownPreview: v })}
              ariaLabel="Open Markdown in preview"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.sidebarCollapse}>
        <FieldRow
          label="Sidebar: collapse inactive by default"
          description="Projects without an explicit choice start collapsed when inactive. Your project and group chevron choices are remembered."
          control={
            <Switch
              checked={settings.sidebarAutoCollapse}
              onChange={(v) => update({ sidebarAutoCollapse: v })}
              ariaLabel="Sidebar: collapse inactive by default"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.sidebarGrouping}>
        <FieldRow
          label="Sidebar: group sessions by"
          description="Group the sessions sidebar by project (the default) or by live status, so sessions needing attention float to the top across all projects. Status reflects local-core sessions; remote sessions show as idle."
          control={
            <SegmentedPill<'project' | 'status'>
              value={settings.sidebarGrouping}
              ariaLabel="Group sessions by"
              options={[
                { value: 'project', label: 'Project' },
                { value: 'status', label: 'Status' }
              ]}
              onChange={(v) => update({ sidebarGrouping: v })}
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.worktreePath}>
        <FieldRow
          label="Worktree path template"
          description={
            'Resolved from the repository root. Supports $repoName (also $reponame or $defaultFolderName) and $branch; a missing branch is appended automatically.'
          }
          control={
            <Input
              className="w-80 font-mono"
              aria-label="Worktree path template"
              placeholder={DEFAULT_WORKTREE_PATH_TEMPLATE}
              value={settings.worktreePathTemplate}
              onChange={(e) => update({ worktreePathTemplate: e.target.value })}
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.wheelZoom}>
        <FieldRow
          label={t('settings.behavior.wheelZoom.label', 'Scroll wheel zooms').primary}
          description={t('settings.behavior.wheelZoom.description', 'Zoom with a plain mouse wheel (no Command). Two-finger trackpad scroll still pans.').primary}
          control={
            <Switch
              checked={settings.wheelZoom}
              onChange={(v) => update({ wheelZoom: v })}
              ariaLabel={t('settings.behavior.wheelZoom.label', 'Scroll wheel zooms').primary}
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.wheelZoomSpeed}>
        <FieldRow
          label={wheelZoomSpeedLabel}
          description={`${wheelZoomSpeedDescription.primary}${wheelZoomSpeedDescription.secondary ? ` ${wheelZoomSpeedDescription.secondary}` : ''} ${wheelZoomSpeedProvenance.primary}${wheelZoomSpeedProvenance.secondary ? ` ${wheelZoomSpeedProvenance.secondary}` : ''}`}
          control={
            <div className="flex min-w-0 items-center gap-3">
              <Slider
                min={0.2}
                max={2}
                step={0.1}
                value={wheelZoomSpeed}
                aria-label={wheelZoomSpeedLabel}
                aria-valuetext={`${wheelZoomSpeed.toFixed(1)}×`}
                onChange={(e) => update({ wheelZoomSpeed: Number(e.target.value) })}
                className="w-40 accent-[var(--accent)]"
              />
              <span className="w-12 shrink-0 text-right text-[12px] text-muted tabular-nums">
                {wheelZoomSpeed.toFixed(1)}×
              </span>
            </div>
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.trackpadPan}>
        <FieldRow
          label="Trackpad scroll pans"
          description={hintLabel(
            'macOS: a two-finger trackpad scroll pans the canvas even with wheel zoom on. The desktop app tells mouse and trackpad apart directly, so a wheel mouse still zooms; in the browser (Server Edition) detection is heuristic - turn off there if a precise-pixel mouse (Magic Mouse, MX) pans when you meant to zoom.'
          )}
          control={
            <Switch
              checked={settings.trackpadPan}
              onChange={(v) => update({ trackpadPan: v })}
              ariaLabel="Trackpad scroll pans"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.dragMode}>
        <FieldRow
          label="Canvas left-drag"
          description="What dragging empty canvas does. Pan moves the map directly (box-select moves to Shift+drag); Select rubber-band selects, panning stays on middle-drag / two-finger scroll."
          control={
            <Select
              aria-label="Canvas left-drag"
              value={settings.canvasDragMode}
              onChange={(e) => update({ canvasDragMode: e.target.value as 'select' | 'pan' })}
            >
              <option value="select">Select (default)</option>
              <option value="pan">Pan the canvas</option>
            </Select>
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.browserSaver}>
        <FieldRow
          label="Browser memory saver"
          description="Free a hidden browser page's memory after 5 minutes; it reloads when shown. Each page is a whole Chromium process."
          control={
            <Switch
              checked={settings.browserMemorySaver}
              onChange={(v) => update({ browserMemorySaver: v })}
              ariaLabel="Browser memory saver"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.keepAwake}>
        <FieldRow
          label="Keep awake while agents work"
          description="Holds off idle sleep while a local agent is running. A closed lid still sleeps the machine."
          control={
            <Switch
              checked={settings.keepAwakeWhileAgentsWork}
              onChange={(v) => update({ keepAwakeWhileAgentsWork: v })}
              ariaLabel="Keep awake while agents work"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.confirmQuit}>
        <FieldRow
          label="Confirm before quitting"
          description="Ask before the app quits (⌘Q / Ctrl+Q or the title-bar close). Terminal sessions survive a quit either way."
          control={
            <Switch
              checked={settings.confirmBeforeQuit}
              onChange={(v) => update({ confirmBeforeQuit: v })}
              ariaLabel="Confirm before quitting"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.reset}>
        <SectionReset
          keys={BEHAVIOR_RESET_KEYS}
          label="Reset behavior"
          what="the behavior settings"
        />
      </SearchableRow>
    </SettingsSection>
  )
}
