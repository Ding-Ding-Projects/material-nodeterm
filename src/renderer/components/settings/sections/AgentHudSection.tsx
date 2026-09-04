import { useSettings } from '../../../state/settings'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'
import { Slider } from '@renderer/ui/md3'

/** Keep in sync with AGENT_HUD_WIDTH_MIN/MAX in src/main/agent-hud.ts. */
const WIDTH_MIN = 100
const WIDTH_MAX = 320

const ROWS = {
  enabled: {
    title: 'Agent HUD',
    keywords: ['agent', 'hud', 'mascot', 'overlay', 'status', 'session', 'standalone', 'Windows']
  },
  width: {
    title: 'HUD width',
    keywords: ['hud', 'width', 'indicator', 'panel', 'size', 'tune']
  },
  hover: {
    title: 'Expand on hover',
    keywords: ['hud', 'hover', 'expand', 'panel', 'click', 'open', 'sessions']
  }
}
const ENTRIES = Object.values(ROWS)

/**
 * Settings → Interface → Agent HUD.
 *
 * The standalone Windows status tool exposes its enable toggle, collapsed indicator width, and
 * hover-versus-click expansion here. All three apply live while the HUD is running.
 */
export function AgentHudSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const agentHud = useSettings((s) => s.settings.agentHud)
  const agentHudWidth = useSettings((s) => s.settings.agentHudWidth)
  const hoverExpand = useSettings((s) => s.settings.agentHudHoverExpand)
  const update = useSettings((s) => s.update)
  return (
    <SettingsSection
      id="agent-hud"
      title="Agent HUD"
      description="A standalone Windows status tool that shows working agents and opens a live session panel."
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.enabled}>
        <FieldRow
          label="Show the Agent HUD"
          description="Shows a non-blocking status indicator for working agents, needs-you sessions, and unseen completed sessions."
          control={
            <Switch
              checked={agentHud}
              ariaLabel="Agent HUD"
              onChange={(on) => update({ agentHud: on })}
            />
          }
        />
      </SearchableRow>

      <div
        className={
          'mt-3 space-y-3 border-l border-border pl-4' +
          (agentHud ? '' : ' pointer-events-none opacity-40')
        }
        aria-disabled={!agentHud}
      >
        <SearchableRow {...ROWS.width}>
          <FieldRow
            label="HUD width"
            description="Sets the width of the collapsed Agent HUD indicator. The standalone tool window keeps its own stable size."
            control={
              <div className="flex items-center gap-3">
                <Slider
                  min={WIDTH_MIN}
                  max={WIDTH_MAX}
                  step={2}
                  value={agentHudWidth}
                  aria-label="Agent HUD width in pixels"
                  onChange={(e) => update({ agentHudWidth: Number(e.target.value) })}
                  className="w-40 accent-[var(--accent)]"
                />
                <span className="w-12 text-right text-[12px] text-muted tabular-nums">
                  {agentHudWidth} px
                </span>
              </div>
            }
          />
        </SearchableRow>

        <SearchableRow {...ROWS.hover}>
          <FieldRow
            label="Expand on hover"
            description="Point at the capsule to open the session panel. Off = it only opens when you click it. Either way it closes when you move away — and that's when a finished session stops glowing green."
            control={
              <Switch
                checked={hoverExpand}
                ariaLabel="Expand the Agent HUD panel on hover"
                onChange={(on) => update({ agentHudHoverExpand: on })}
              />
            }
          />
        </SearchableRow>
      </div>
    </SettingsSection>
  )
}
