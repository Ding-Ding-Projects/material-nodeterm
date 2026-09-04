import { stat } from 'node:fs/promises'
import type { DownloadTicket, Settings } from '../../shared/types'
import type { ServerPlatform } from '../platform-server'
import type { DownloadTickets } from '../../core/download-tickets'
import { DOWNLOAD_PATH, downloadName } from '../download'
import { GitService } from '../../core/git-service'
import { generateCommitMessage } from '../../core/commit-message'
import { registerFsHandlers } from '../../core/fs-handlers'
import { registerConverterIpc } from '../../core/converter/register-ipc'
import { registerNodeDependencyIpc } from '../../core/node-dependencies/register-ipc'
import { registerAwsResourceIpc } from '../../core/aws-resource-register-ipc'
import { AwsWizardModelService } from '../../core/aws-wizard/service'
import { registerOllamaIpc } from '../../core/ollama/register-ipc'
import { registerAwsProfileManagerIpc } from '../../core/aws/register-identity-ipc'
import { registerUniGetUiIpc } from '../../core/unigetui/register-ipc'
import { registerMinecraftIpc } from '../../core/minecraft/register-ipc'
import { registerDockerHostIpc } from '../../core/docker-host/register-ipc'
import { registerTorrentIpc } from '../../core/torrent/register-ipc'
import { registerRepositoryGraphIpc } from '../../core/repository-graph-register-ipc'
import { registerVirtualMachineIpc } from '../../core/virtual-machine/register-ipc'
import { registerCalendarIpc } from '../../core/calendar/register-ipc'
import { registerCloudflareCoreManagersIpc } from '../../core/cloudflare-core-managers'
import { registerProviderServicesIpc } from '../../core/provider-services'
import { registerRemoteOAuthCallbackIpc } from '../../core/remote-oauth-callback'
import { registerHomeAssistantIpc } from '../../core/home-assistant/register-ipc'
import { registerHomeAssistantControlIpc } from '../../core/home-assistant-control/register-ipc'
import { registerHomeAssistantSensorIpc } from '../../core/home-assistant-sensor/register-ipc'
import { registerCloudflareTunnelIpc } from '../../core/cloudflare/register-ipc'
import { registerCloudflareZeroTrustIpc } from '../../core/cloudflare-zero-trust/service'
import { registerAwsIdentityIpc } from '../../core/aws-identity'
import type { MinecraftServerManager } from '../../core/minecraft/server-manager'
import { registerVsCodeHandlers } from '../../core/vscode-handlers'
import { LocalHistoryStore } from '../../core/local-history'
import { registerLocalHistoryHandlers } from '../../core/local-history-handlers'
import type { SettingsStore } from '../../core/settings-store'
import type { WorkspaceStore } from '../../core/workspace-store'
import { describeSettingsChange } from '../../shared/settings-diff'
import { claudeCliCaps, registerClaudeCliIpc } from '../../core/claude-cli'
import { discoverLocalClaudeSkills } from '../../core/claude-skills'
import { registerCodexIdentityIpc } from '../../core/codex-identity-caps'
import { UNKNOWN_CODEX_IDENTITY_CAPS } from '@shared/types'
import { startUsageService } from '../../core/usage/usage-service'
import { registerClaudeAccountsIpc } from '../../core/claude-accounts-service'
import { codexUsageAccounts } from '../../core/codex-accounts-core'
import { codexHomeFor } from '../../core/codex-config-dir'
import {
  setMirrorUsageProvider,
  buildMirrorUsage,
  flush as flushAgentStatusMirror
} from '../../core/agent-status-mirror'
import { IPC } from '../../shared/ipc'
import { DurableOccurrenceService, FileDurableOccurrenceStore, durableOccurrenceFile, registerDurableOccurrenceHandlers } from '../../core/durable-occurrence-service'

/** Register the Phase-3a handler surface (fs + git + commit) on the server platform.
 *  git.setActiveRemote is a local-only no-op here: it exists to arm SSH-project remote
 *  routing on desktop, which the server edition does not have (terminals are local). */
export function registerCoreHandlers(
  platform: ServerPlatform,
  deps: {
    getSettings: () => Settings
    downloadTickets?: DownloadTickets
    /** See fs-handlers' dep of the same name — the canvas-image write directory. */
    localProjectCwd?: (projectId: string) => string | undefined
    /** Present so this registrar can wire the settings history recorder AND the restore path
     *  (core/local-history.ts). Optional only for tests that construct this registrar without a
     *  real SettingsStore; the server's own boot (src/server/index.ts) always supplies it. */
    settingsStore?: SettingsStore
    workspaceStore?: WorkspaceStore
  }
): { gitService: GitService; minecraftServers: MinecraftServerManager; virtualMachineManager: import('../../core/virtual-machine/manager').VirtualMachineManager } {
  // Explorer downloads: mint a one-shot ticket over this (authenticated) channel; the transfer
  // itself is a plain HTTP GET the browser performs (src/server/download.ts). Statting here keeps
  // the URL honest about the name — a folder arrives as `<name>.tar.gz`.
  const { downloadTickets } = deps
  registerFsHandlers(platform, {
    issueDownloadTicket: downloadTickets
      ? async (p: string): Promise<DownloadTicket | null> => {
          let dir = false
          try {
            dir = (await stat(p)).isDirectory()
          } catch {
            return null
          }
          const token = downloadTickets.issue(p, dir)
          return { url: `${DOWNLOAD_PATH}?t=${encodeURIComponent(token)}`, name: downloadName(p, dir) }
        }
      : undefined,
    localProjectCwd: deps.localProjectCwd
  })
  const localHistoryStore = new LocalHistoryStore(platform.userDataDir)

  // Universal file converter + local Ollama suite manager + local Minecraft server create-and-
  // manage + local Torrent Downloader — the SAME registrars main/index.ts calls, over the SAME
  // CorePlatform.handle seam, so
  // the engine cannot drift between desktop and the browser. See docs/file-converter.md,
  // docs/ollama-manager.md and docs/minecraft-server-manager.md.
  registerConverterIpc(platform)
  const nodeDependencyService = registerNodeDependencyIpc(platform)
  const awsWizardModels = new AwsWizardModelService(nodeDependencyService)
  registerOllamaIpc(platform)
  // AWS identity manager. Pure core over `platform.handle`, so the browser manages the AWS
  // configuration of the machine actually running this shell — the same one the terminals are
  // on. Credentials stay inside the host's AWS boundary; only profile metadata crosses.
  registerAwsProfileManagerIpc(platform)
  registerRepositoryGraphIpc(platform, { projectTargetInfo: (projectId) => {
    const info = deps.workspaceStore?.projectTargetInfo(projectId)
    return info ? { cwd: info.cwd, ssh: info.ssh, name: info.name } : null
  } })
  registerUniGetUiIpc(platform)
  const { manager: minecraftServers } = registerMinecraftIpc(platform)
  registerDockerHostIpc(platform)
  registerTorrentIpc(platform)
  const { manager: virtualMachineManager } = registerVirtualMachineIpc(platform)
  registerCalendarIpc(platform)
  const cloudflareCoreManagers = registerCloudflareCoreManagersIpc(platform)
  registerProviderServicesIpc(platform)
  registerRemoteOAuthCallbackIpc(platform)
  registerHomeAssistantIpc(platform)
  registerHomeAssistantControlIpc(platform)
  registerHomeAssistantSensorIpc(platform)
  registerCloudflareTunnelIpc(platform, cloudflareCoreManagers)
  registerCloudflareZeroTrustIpc(platform)
  registerAwsIdentityIpc(platform, {
    resolveAwsCli: async () => {
      const dependency = await nodeDependencyService.status('aws-cli-v2')
      return { path: dependency.executablePath, reason: dependency.disabledReason }
    }
  })
  registerAwsResourceIpc(platform, async () => {
    const dependency = await nodeDependencyService.status('aws-cli-v2')
    return { path: dependency.executablePath ?? null, reason: dependency.disabledReason }
  }, awsWizardModels)
  // "Open in Visual Studio Code" + local settings history — same registrars the desktop shell
  // uses (src/main/index.ts), over the generic platform.handle seam, so the browser gets the
  // identical feature acting on the SERVER's own machine (docs/exports.md, docs/local-history.md).
  registerVsCodeHandlers(platform)
  deps.workspaceStore?.setProjectHistoryRecorder((project, content, change) =>
    localHistoryStore.record({
      domain: `project_${project.id}`,
      filename: 'project.json',
      content,
      // What actually happened on the canvas, not that a save happened — see shared/project-diff.ts.
      // Kept identical to the desktop shell's wiring on purpose: this repo has shipped a one-shell
      // history change before, and the boundary tests cannot tell you a label is missing.
      label: change.label,
      action: change.action
    })
  )
  if (deps.settingsStore) {
    const settingsStore = deps.settingsStore
    settingsStore.setHistoryRecorder(async (before, after, override) => {
      if (override) {
        await localHistoryStore.record({
          domain: 'settings',
          filename: 'settings.json',
          content: JSON.stringify(after, null, 2),
          label: override.label,
          action: override.action
        })
        return
      }
      const change = describeSettingsChange(before, after)
      if (!change) return
      await localHistoryStore.record({
        domain: 'settings',
        filename: 'settings.json',
        content: JSON.stringify(after, null, 2),
        label: change.label,
        action: change.action
      })
    })
  }
  registerLocalHistoryHandlers(platform, {
    historyStore: localHistoryStore,
    domainFilenames: { settings: 'settings.json', torrent: 'tasks.json' },
    restoreHandlers: {
      settings: async (content: string, sha: string) => {
        if (!deps.settingsStore) throw new Error('Settings history is unavailable.')
        const parsed = JSON.parse(content) as Settings
        await deps.settingsStore.applyRestoredSettings(parsed, `Restored settings to ${sha.slice(0, 7)}`)
      },
      torrent: async (content: string) => {
        await torrentService.restoreHistory(content)
      }
    }
  })

  const gitService = new GitService()
  // registers all git:* channels via the global core platform().handle
  gitService.registerIpc()

  // Desktop: ipcMain.handle(IPC.commitGenerate, (_e, cwd) => generateCommitMessage(cwd, settingsStore.get()))
  platform.handle(IPC.commitGenerate, (cwd: string) =>
    generateCommitMessage(cwd, deps.getSettings())
  )
  // Local server has no SSH projects; keep git running against the local remote.
  platform.handle(IPC.gitSetActiveRemote, () => null)

  // Desktop: ipcMain.handle(IPC.appUserDataDir, () => app.getPath('userData')).
  // The browser needs the REAL data dir: it is the writable base the worktree dialog derives its
  // default path from, and an empty answer there proposes `/worktrees/…` at the filesystem root.
  platform.handle(IPC.appUserDataDir, () => platform.userDataDir)

  // The browser needs the same `--permission-mode auto` version gate as desktop: the server's own
  // claude CLI is the one that will run the terminal nodes. Warm it so the first call is cached.
  registerClaudeCliIpc()
  platform.handle(IPC.claudeSkillsList, () =>
    discoverLocalClaudeSkills(
      deps
        .getSettings()
        .claudeAccounts.filter((account) => !account.pending && !account.host)
        .map((account) => account.id)
    )
  )
  void claudeCliCaps()

  // ---- Codex shared identity: a DELIBERATE degrade, not an omission ----------------------------
  // The Server Edition answers "no shared identity", so every Codex node here launches the bare
  // `codex` it always did — a working node with its own app-server, just without the shared one.
  //
  // The secret question that used to block this is ANSWERED: src/server/index.ts arms
  // `hookServer.setNodeAuthSecret(await loadOrCreateNodeAuthSecret())` at boot, which on a headless
  // host is raw 0600 bytes in the data dir — a decision taken explicitly, not quietly (see
  // src/core/agents/node-auth-secret.ts). As of S6 PR 5 the same boot path also calls
  // `setCodexThreadIdentityAuthSecret(secret)`, so a MANAGED Codex account's thread→node→account
  // ownership records sign and verify on this headless host instead of throwing "identity
  // authentication is unavailable" (the carried PR-2 obligation). What stays deliberately absent
  // here is the shared-app-server plumbing (`refreshCodexIdentityCaps()` + the two
  // `setCodexThread*Handler` registrations src/main/index.ts makes): the Server Edition answers "no
  // shared identity" so its Codex nodes launch the bare `codex` — a working node with its own
  // app-server, just without the shared one. Arming the record secret is orthogonal to that
  // degrade: it never launches an app-server, it only lets the record layer sign.
  registerCodexIdentityIpc(() => UNKNOWN_CODEX_IDENTITY_CAPS)

  // Managed CLAUDE accounts (issue #313). The lifecycle is core, so a browser-only deployment can
  // create, log into and remove them exactly as the desktop does — env injection, the transcript
  // readers, usage and the account pickers were already core and had nothing to bind to here.
  // No `installSkill`: canvas control is not wired on this edition (its hook server answers
  // `control unavailable` by name), so a per-account skill file would point at nothing.
  // No `remote`: the Server Edition has no SSH-project manager, so an `AccountCtx` carrying a
  // projectId takes the LOCAL path — the same degrade desktop takes before its manager exists.
  registerClaudeAccountsIpc()

  // Claude subscription usage. Previously desktop-only — the browser bridge answered `null`, so
  // the pill never rendered in the Server Edition. The poll runs UNGATED here (the default), not
  // browser-gated: the phone reads this host's agent-status mirror over plain SSH with no browser
  // attached, so "no client connected" does NOT mean "nobody is looking" — a connected-clients
  // gate starved the mirror's `usage` block empty forever on a headless host (the field bug that
  // shipped v1). The 15-min cadence is 4 requests/hour — well inside the endpoint's budget.
  // Feeds the agent-status mirror's per-account `usage` block for the phone (mobile-usage-inbox):
  // poll all local managed accounts, and re-flush the mirror on every cache update.
  const localClaudeAccountIds = (): string[] =>
    (deps.getSettings().claudeAccounts ?? []).filter((a) => !a.host && !a.pending).map((a) => a.id)
  // Local managed Codex accounts + their isolated homes, for the per-account usage fan-out
  // (S6 §4.3). Managed Codex accounts run on the headless host too, so the Server Edition serves
  // them the same way desktop does — a src/core change ships on both shells by construction.
  const localCodexAccounts = (): Array<{
    id: string
    home: string
    label: string
    email?: string | null
  }> =>
    codexUsageAccounts(
      (deps.getSettings().codexAccounts ?? []).filter((a) => !a.host && !a.pending),
      codexHomeFor
    )
  const usageService = startUsageService({
    localAccounts: localClaudeAccountIds,
    codexAccounts: localCodexAccounts,
    onCacheUpdate: () => {
      void flushAgentStatusMirror()
    }
  })
  // The provider is consulted fresh at every flush, pairing the usage service's cache with the
  // settings account labels. Dropped from SSH slices by filterMirrorForNodes (no SSH server-side
  // anyway). Wired here (not index.ts) since the usage service is created here.
  setMirrorUsageProvider(() =>
    buildMirrorUsage(usageService.snapshot(), deps.getSettings().claudeAccounts ?? [], Date.now())
  )

  return { gitService, minecraftServers, virtualMachineManager }
}
