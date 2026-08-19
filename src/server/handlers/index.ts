import { stat } from 'node:fs/promises'
import type { DownloadTicket, Settings } from '../../shared/types'
import type { ServerPlatform } from '../platform-server'
import type { DownloadTickets } from '../../core/download-tickets'
import { DOWNLOAD_PATH, downloadName } from '../download'
import { GitService } from '../../core/git-service'
import { generateCommitMessage } from '../../core/commit-message'
import { registerFsHandlers } from '../../core/fs-handlers'
import { registerConverterIpc } from '../../core/converter/register-ipc'
import { registerOllamaIpc } from '../../core/ollama/register-ipc'
import { registerMinecraftIpc } from '../../core/minecraft/register-ipc'
import type { MinecraftServerManager } from '../../core/minecraft/server-manager'
import { registerVsCodeHandlers } from '../../core/vscode-handlers'
import { LocalHistoryStore } from '../../core/local-history'
import { registerLocalHistoryHandlers } from '../../core/local-history-handlers'
import type { SettingsStore } from '../../core/settings-store'
import { describeSettingsChange } from '../../shared/settings-diff'
import { claudeCliCaps, registerClaudeCliIpc } from '../../core/claude-cli'
import { registerCodexIdentityIpc } from '../../core/codex-identity-caps'
import { UNKNOWN_CODEX_IDENTITY_CAPS } from '@shared/types'
import { startUsageService } from '../../core/usage/usage-service'
import {
  setMirrorUsageProvider,
  buildMirrorUsage,
  flush as flushAgentStatusMirror
} from '../../core/agent-status-mirror'
import { IPC } from '../../shared/ipc'

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
  }
): { gitService: GitService; minecraftServers: MinecraftServerManager } {
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

  // Universal file converter + local Ollama suite manager + local Minecraft server create-and-
  // manage — the SAME registrars main/index.ts calls, over the SAME CorePlatform.handle seam, so
  // the engine cannot drift between desktop and the browser. See docs/file-converter.md,
  // docs/ollama-manager.md and docs/minecraft-server-manager.md.
  registerConverterIpc(platform)
  registerOllamaIpc(platform)
  const { manager: minecraftServers } = registerMinecraftIpc(platform)
  // "Open in Visual Studio Code" + local settings history — same registrars the desktop shell
  // uses (src/main/index.ts), over the generic platform.handle seam, so the browser gets the
  // identical feature acting on the SERVER's own machine (docs/exports.md, docs/local-history.md).
  registerVsCodeHandlers(platform)
  const localHistoryStore = new LocalHistoryStore(platform.userDataDir)
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
    domainFilenames: { settings: 'settings.json' },
    restoreHandlers: {
      settings: async (content: string, sha: string) => {
        if (!deps.settingsStore) throw new Error('Settings history is unavailable.')
        const parsed = JSON.parse(content) as Settings
        await deps.settingsStore.applyRestoredSettings(parsed, `Restored settings to ${sha.slice(0, 7)}`)
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
  void claudeCliCaps()

  // ---- Codex shared identity: a DELIBERATE degrade, not an omission ----------------------------
  // The Server Edition answers "no shared identity", so every Codex node here launches the bare
  // `codex` it always did — a working node with its own app-server, just without the shared one.
  //
  // The secret question that used to block this is ANSWERED: src/server/index.ts arms
  // `hookServer.setNodeAuthSecret(await loadOrCreateNodeAuthSecret())` at boot, which on a headless
  // host is raw 0600 bytes in the data dir — a decision taken explicitly, not quietly (see
  // src/core/agents/node-auth-secret.ts). What is still missing is only the codex-specific
  // plumbing: `setCodexThreadIdentityAuthSecret(secret)`, `refreshCodexIdentityCaps()`, and the two
  // `setCodexThread*Handler` registrations src/main/index.ts makes. Everything they call already
  // lives in src/core and boots from CorePlatform, so this stays a scope line, not a blocker —
  // until it is drawn differently, saying "no" here keeps the browser's Codex nodes identical to
  // what they are today rather than half-armed.
  registerCodexIdentityIpc(() => UNKNOWN_CODEX_IDENTITY_CAPS)

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
  const usageService = startUsageService({
    localAccounts: localClaudeAccountIds,
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

  return { gitService, minecraftServers }
}
