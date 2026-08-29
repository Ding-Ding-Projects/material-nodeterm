/**
 * Opt-in acceptance against the shells installed on THIS Windows machine.
 *
 * This is deliberately absent from ordinary test evidence: node-pty in this repository is built
 * for Electron's ABI, and the result depends on locally installed profiles. Run it only through
 * `node scripts/run-windows-terminal-profiles-real.mjs`; that launcher rebuilds the session host
 * and starts Vitest with the repository Electron binary plus ELECTRON_RUN_AS_NODE=1.
 *
 * The enabled run is fail-closed. Every descriptor which the trusted service calls available is
 * resolved and exercised twice: once through node-pty directly, then through the real detached
 * session host. Fixed profiles which are missing are printed with their catalog reason. `custom`
 * participates only when NODETERM_WINDOWS_PROFILE_CUSTOM is explicitly set; because an arbitrary
 * executable has no discoverable command language, that fixture also needs
 * NODETERM_WINDOWS_PROFILE_CUSTOM_DIALECT=powershell|cmd|git-bash.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { stripVTControlCharacters } from "util";
import type * as NodePty from "node-pty";
import type {
  WindowsTerminalProfile,
  WindowsTerminalProfileKind,
} from "../shared/types";
import { sessionHostPaths } from "../session-host/paths";
import {
  encodeFrame,
  LineFramer,
  SESSION_HOST_PROTOCOL_VERSION,
  type AttachResult,
  type CaptureResult,
  type HasSessionResult,
  type KillSessionResult,
  type SessionHostFrame,
  type SessionHostRequestBody,
  type SessionHostResponse,
  type SessionHostSpawnOptions,
} from "../session-host/protocol";
import { SessionHostClient } from "./session-host-client";
import { SessionHostPty } from "./session-host-pty";
import {
  WindowsTerminalProfileService,
  type ResolvedWindowsTerminalProfile,
} from "./windows-terminal-profiles";

const OPT_IN =
  process.platform === "win32" &&
  process.env.NODETERM_WINDOWS_PROFILE_REAL === "1";
const suite = OPT_IN ? describe : describe.skip;
const DIRECT_COLS = 111;
const DIRECT_ROWS = 37;
const SCROLLBACK = 2_000;
const OUTPUT_TIMEOUT_MS = 25_000;
const HOST_EXIT_TIMEOUT_MS = 38_000;
const CONFIRMED_KILL_TIMEOUT_MS = 25_000;
const PROCESS_EXIT_TIMEOUT_MS = 12_000;
const LOG_PREFIX = "[real-windows-profiles]";
const WSL_CWD_FAILURE =
  "nodeterm: WSL working directory became unavailable; choose another directory.";

type ShellDialect = "powershell" | "cmd" | "git-bash" | "wsl";

interface ProbePlan {
  input: string;
  exitInput: string;
  ioLine: string;
  unicodeLine: string;
  sizeLine: string;
  expectedCwd: string;
  cwdStyle: "windows" | "linux";
}

interface WindowsProcessRecord {
  processId: number;
  parentProcessId: number;
  name: string;
  creationDate: string;
  commandLine?: string;
}

interface SilentSessionEvidence {
  client: SessionHostClient;
  pty: SessionHostPty;
  generation: string;
  hostPid: number;
  shellPid: number;
  childPid: number;
  trackedPids: number[];
  trackedProcesses: WindowsProcessRecord[];
  output: OutputCollector;
}

class OutputCollector {
  private value = "";

  append(chunk: string): void {
    this.value += chunk;
    // A broken profile which continuously paints must not make the acceptance process unbounded.
    if (this.value.length > 2 * 1024 * 1024)
      this.value = this.value.slice(-1024 * 1024);
  }

  text(): string {
    return this.value;
  }

  async waitFor(
    predicate: (text: string) => boolean,
    description: string,
  ): Promise<void> {
    const deadline = Date.now() + OUTPUT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (predicate(this.value)) return;
      await delay(50);
    }
    throw new Error(
      `${description} did not arrive within ${OUTPUT_TIMEOUT_MS}ms. Tail: ${JSON.stringify(
        visible(this.value).slice(-1_200),
      )}`,
    );
  }
}

async function waitForStartupQuiescence(
  output: OutputCollector,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let previous = output.text();
  let lastChange = Date.now();
  while (Date.now() < deadline) {
    await delay(50);
    const current = output.text();
    if (current !== previous) {
      previous = current;
      lastChange = Date.now();
      continue;
    }
    if (current.length > 0 && Date.now() - lastChange >= 750) return;
  }
  throw new Error(
    `${description} did not reach a quiescent interactive prompt. Tail: ${JSON.stringify(
      visible(output.text()).slice(-1_200),
    )}`,
  );
}

let nativePty: typeof NodePty;
let tempRoot = "";
let userDataDir = "";
let workingDir = "";
let repoRoot = "";
let runId = "";
let sessionSequence = 0;
const createdSessionNames = new Set<string>();
const trackedFixtureProcesses = new Map<number, WindowsProcessRecord>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`${description} did not settle within ${timeoutMs}ms`),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function execFileResult(
  file: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `${path.basename(file)} failed: ${error.message}; stderr=${JSON.stringify(stderr)}`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function windowsPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new Error(
      "Cannot inspect harness-owned Windows processes because SystemRoot is invalid.",
    );
  }
  const executable = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  if (!fs.existsSync(executable)) {
    throw new Error(
      `Cannot inspect harness-owned Windows processes because Windows PowerShell is missing at ${executable}.`,
    );
  }
  return executable;
}

async function windowsProcessSnapshot(): Promise<WindowsProcessRecord[]> {
  const command = [
    "$ErrorActionPreference='Stop'",
    "$ntp=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine)",
    "ConvertTo-Json -Compress -Depth 3 -InputObject $ntp",
  ].join(";");
  const { stdout } = await execFileResult(
    windowsPowerShellPath(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    15_000,
  );
  const parsed = JSON.parse(stdout.trim() || "[]") as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const result: WindowsProcessRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as Record<string, unknown>;
    const processId = Number(candidate.ProcessId);
    const parentProcessId = Number(candidate.ParentProcessId);
    const name = candidate.Name;
    if (!Number.isSafeInteger(processId) || processId <= 0) continue;
    if (!Number.isSafeInteger(parentProcessId) || parentProcessId < 0) continue;
    if (typeof name !== "string" || name.length === 0) continue;
    result.push({
      processId,
      parentProcessId,
      name,
      creationDate:
        typeof candidate.CreationDate === "string"
          ? candidate.CreationDate
          : "",
      ...(typeof candidate.CommandLine === "string"
        ? { commandLine: candidate.CommandLine }
        : {}),
    });
  }
  return result;
}

function processIdentity(record: WindowsProcessRecord): string {
  return `${record.processId}:${record.creationDate}`;
}

function descendantPids(
  snapshot: readonly WindowsProcessRecord[],
  rootPid: number,
): number[] {
  const found = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of snapshot) {
      if (!found.has(process.parentProcessId) || found.has(process.processId))
        continue;
      found.add(process.processId);
      changed = true;
    }
  }
  return [...found];
}

function newConhostPids(
  before: readonly WindowsProcessRecord[],
  after: readonly WindowsProcessRecord[],
  hostPid: number,
): number[] {
  const beforeIdentities = new Set(before.map(processIdentity));
  return after
    .filter(
      (process) =>
        process.parentProcessId === hostPid &&
        process.name.toLocaleLowerCase("en-US") === "conhost.exe" &&
        !beforeIdentities.has(processIdentity(process)),
    )
    .map((process) => process.processId);
}

async function waitForProcessEvidence(
  predicate: (snapshot: readonly WindowsProcessRecord[]) => boolean,
  description: string,
  timeoutMs = PROCESS_EXIT_TIMEOUT_MS,
): Promise<WindowsProcessRecord[]> {
  const deadline = Date.now() + timeoutMs;
  let snapshot: WindowsProcessRecord[] = [];
  while (Date.now() < deadline) {
    snapshot = await windowsProcessSnapshot();
    if (predicate(snapshot)) return snapshot;
    await delay(100);
  }
  throw new Error(`${description} was not observed within ${timeoutMs}ms.`);
}

async function requirePidsGone(
  pids: readonly number[],
  description: string,
): Promise<void> {
  const unique = [...new Set(pids)];
  try {
    await waitForProcessEvidence(
      (snapshot) =>
        !snapshot.some((process) => unique.includes(process.processId)),
      description,
    );
  } catch (error) {
    const snapshot = await windowsProcessSnapshot();
    const survivors = snapshot
      .filter((process) => unique.includes(process.processId))
      .map(
        (process) =>
          `${process.processId}:${process.name}(parent=${process.parentProcessId})`,
      );
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Survivor(s): ${
        survivors.join(", ") || "none at final diagnostic snapshot"
      }`,
    );
  }
  const finalSnapshot = await windowsProcessSnapshot();
  for (const pid of unique) {
    expect(
      finalSnapshot.some((process) => process.processId === pid),
      `${description}: PID ${pid} is still present`,
    ).toBe(false);
  }
}

async function requirePidsAlive(
  pids: readonly number[],
  description: string,
): Promise<void> {
  const snapshot = await windowsProcessSnapshot();
  for (const pid of [...new Set(pids)]) {
    expect(
      snapshot.some((process) => process.processId === pid),
      `${description}: PID ${pid} is absent`,
    ).toBe(true);
  }
}

function envRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.TERM = "xterm-256color";
  return env;
}

function visible(value: string): string {
  return stripVTControlCharacters(value).replace(/\u0000/g, "");
}

function normalizeWindowsPath(value: string): string {
  const normalized = value.replace(/\//g, "\\").replace(/[\\/]+$/, "");
  return normalized.toLocaleLowerCase("en-US");
}

function normalizeLinuxPath(value: string): string {
  return value === "/" ? value : value.replace(/\/+$/, "");
}

function expectedAutoKind(
  catalog: readonly WindowsTerminalProfile[],
): WindowsTerminalProfileKind {
  for (const id of ["pwsh", "windows-powershell", "cmd"] as const) {
    if (catalog.find((profile) => profile.id === id)?.available) return id;
  }
  throw new Error(
    "The automatic profile is available without an available fallback candidate.",
  );
}

function expectedResolvedKind(
  profile: WindowsTerminalProfile,
  catalog: readonly WindowsTerminalProfile[],
): WindowsTerminalProfileKind {
  if (profile.id === "auto") return expectedAutoKind(catalog);
  if (
    profile.id === "pwsh" ||
    profile.id === "windows-powershell" ||
    profile.id === "cmd" ||
    profile.id === "git-bash" ||
    profile.id === "custom"
  ) {
    return profile.id;
  }
  if (profile.id.startsWith("wsl:")) return "wsl";
  throw new Error(
    `Trusted catalog returned unknown available profile ${profile.id}.`,
  );
}

function assertResolvedIdentity(
  profile: WindowsTerminalProfile,
  resolved: ResolvedWindowsTerminalProfile,
  catalog: readonly WindowsTerminalProfile[],
  customExecutable?: string,
): void {
  const expectedKind = expectedResolvedKind(profile, catalog);
  expect(
    profile.kind,
    `${profile.id} catalog descriptor has a kind inconsistent with its stable ID`,
  ).toBe(profile.id === "auto" ? "auto" : expectedKind);
  expect(
    resolved.profileId,
    `${profile.id} resolution changed the requested stable ID`,
  ).toBe(profile.id);
  expect(
    resolved.kind,
    `${profile.id} resolved to a different profile kind`,
  ).toBe(expectedKind);
  expect(
    resolved.cwd,
    `${profile.id} did not preserve the requested Windows cwd`,
  ).toBe(workingDir);
  expect(
    path.win32.isAbsolute(resolved.shell),
    `${profile.id} did not resolve to an absolute trusted executable`,
  ).toBe(true);

  const executable = path.win32
    .basename(resolved.shell)
    .toLocaleLowerCase("en-US");
  switch (expectedKind) {
    case "pwsh":
      expect(executable).toBe("pwsh.exe");
      expect(resolved.shellArgs).toEqual([]);
      break;
    case "windows-powershell":
      expect(executable).toBe("powershell.exe");
      expect(resolved.shellArgs).toEqual([]);
      break;
    case "cmd":
      expect(executable).toBe("cmd.exe");
      expect(resolved.shellArgs).toEqual([]);
      break;
    case "git-bash":
      expect(executable).toBe("bash.exe");
      expect(resolved.shellArgs).toEqual(["--login", "-i"]);
      break;
    case "wsl": {
      expect(executable).toBe("wsl.exe");
      const distribution = profile.id.slice("wsl:".length);
      expect(resolved.shellArgs.slice(0, 3)).toEqual([
        "-d",
        distribution,
        "--cd",
      ]);
      expect(resolved.shellArgs).toHaveLength(10);
      expect(resolved.shellArgs[3]?.startsWith("/")).toBe(true);
      expect(resolved.shellArgs.slice(4, 7)).toEqual([
        "--exec",
        "/bin/sh",
        "-c",
      ]);
      expect(resolved.shellArgs[7]).toContain(
        "WSL working directory became unavailable",
      );
      expect(resolved.shellArgs[7]).toContain('exec "$SHELL"');
      expect(resolved.shellArgs[8]).toBe("nodeterm-wsl");
      expect(resolved.shellArgs[9]).toBe(resolved.shellArgs[3]);
      break;
    }
    case "custom":
      expect(resolved.shellArgs).toEqual([]);
      if (customExecutable && path.win32.isAbsolute(customExecutable)) {
        expect(resolved.shell).toBe(customExecutable);
      }
      break;
    case "auto":
      throw new Error(
        "Automatic profile resolution must return a concrete profile kind.",
      );
  }
}

function profileDialect(
  profile: WindowsTerminalProfile,
  catalog: readonly WindowsTerminalProfile[],
): ShellDialect {
  switch (expectedResolvedKind(profile, catalog)) {
    case "pwsh":
    case "windows-powershell":
      return "powershell";
    case "cmd":
      return "cmd";
    case "git-bash":
      return "git-bash";
    case "wsl":
      return "wsl";
    case "custom": {
      const configured = process.env.NODETERM_WINDOWS_PROFILE_CUSTOM_DIALECT;
      if (
        configured === "powershell" ||
        configured === "cmd" ||
        configured === "git-bash"
      ) {
        return configured;
      }
      throw new Error(
        "The custom profile was detected as available, but its acceptance fixture has no command " +
          "dialect. Set NODETERM_WINDOWS_PROFILE_CUSTOM_DIALECT to powershell, cmd, or git-bash.",
      );
    }
    case "auto":
      // `auto` is a catalog kind only; trusted resolution must identify the executable it chose.
      throw new Error(
        "Trusted auto resolution returned kind=auto instead of its concrete shell kind.",
      );
  }
}

function wslLinuxCwd(resolved: ResolvedWindowsTerminalProfile): string {
  const cdIndex = resolved.shellArgs.indexOf("--cd");
  const value = cdIndex >= 0 ? resolved.shellArgs[cdIndex + 1] : undefined;
  if (!value || !value.startsWith("/")) {
    throw new Error(
      "Trusted WSL resolution did not produce an absolute --cd Linux path.",
    );
  }
  return value;
}

function probePlan(
  dialect: ShellDialect,
  resolved: ResolvedWindowsTerminalProfile,
  suffix: string,
): ProbePlan {
  const lowerToken = `nt${runId.slice(0, 8)}${suffix}`.toLocaleLowerCase(
    "en-US",
  );
  const unicodeLine = `NTUNICODE:${suffix}:雪λ`;
  const sizeLine = `NTSIZE:${suffix}:${DIRECT_COLS}x${DIRECT_ROWS}`;

  if (dialect === "powershell") {
    const ioLine = `NTIO:${suffix}:${lowerToken.toLocaleUpperCase("en-US")}`;
    return {
      input:
        [
          "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
          `$ntv='${lowerToken}'; Write-Output ('NTIO:${suffix}:' + $ntv.ToUpperInvariant())`,
          `Write-Output ('NTUNICODE:${suffix}:' + [char]0x96EA + [char]0x03BB)`,
          `Write-Output ('NTCWD:${suffix}:' + (Get-Location).Path)`,
          `$nts=$Host.UI.RawUI.WindowSize; Write-Output ('NTSIZE:${suffix}:' + $nts.Width + 'x' + $nts.Height)`,
        ].join("\r") + "\r",
      exitInput: "exit\r",
      ioLine,
      unicodeLine,
      sizeLine,
      expectedCwd: workingDir,
      cwdStyle: "windows",
    };
  }

  if (dialect === "cmd") {
    const ioLine = `NTIO:${suffix}:${lowerToken}`;
    return {
      input:
        [
          "@chcp 65001 >nul",
          `@set "NTV=${lowerToken}"`,
          '@set "NTU=雪λ"',
          `@echo NTIO:${suffix}:%NTV%`,
          `@echo NTUNICODE:${suffix}:%NTU%`,
          `@echo NTCWD:${suffix}:%CD%`,
          `@"${windowsPowerShellPath()}" -NoLogo -NoProfile -NonInteractive -Command "$nts=$Host.UI.RawUI.WindowSize; [Console]::WriteLine(('NTSIZE:${suffix}:' + $nts.Width + 'x' + $nts.Height))"`,
        ].join("\r") + "\r",
      exitInput: "exit\r",
      ioLine,
      unicodeLine,
      sizeLine,
      expectedCwd: workingDir,
      cwdStyle: "windows",
    };
  }

  const ioLine = `NTIO:${suffix}:${lowerToken}`;
  const cwdCommand = dialect === "wsl" ? "pwd -P" : "pwd -W";
  return {
    input:
      (dialect === "wsl" ? "/bin/sh\r" : "") +
      [
        `ntv='${lowerToken}'; printf 'NTIO:${suffix}:%s\\n' "$ntv"`,
        `printf 'NTUNICODE:${suffix}:\\351\\233\\252\\316\\273\\n'`,
        `printf 'NTCWD:${suffix}:%s\\n' "$(${cwdCommand})"`,
        `set -- $(stty size); printf 'NTSIZE:${suffix}:%sx%s\\n' "$2" "$1"`,
      ].join("\r") +
      "\r",
    exitInput: dialect === "wsl" ? "exit\rexit\r" : "exit\r",
    ioLine,
    unicodeLine,
    sizeLine,
    expectedCwd: dialect === "wsl" ? wslLinuxCwd(resolved) : workingDir,
    cwdStyle: dialect === "wsl" ? "linux" : "windows",
  };
}

function assertProbe(text: string, plan: ProbePlan): void {
  const rendered = visible(text);
  expect(
    rendered,
    `missing computed input/output marker ${plan.ioLine}`,
  ).toContain(plan.ioLine);
  expect(
    rendered,
    `missing computed Unicode marker ${plan.unicodeLine}`,
  ).toContain(plan.unicodeLine);
  expect(
    rendered,
    `resize did not reach the child process as ${plan.sizeLine}`,
  ).toContain(plan.sizeLine);

  const cwdPrefix = plan.ioLine
    .replace(/^NTIO:/, "NTCWD:")
    .replace(/:[^:]+$/, ":");
  if (plan.cwdStyle === "windows") {
    expect(
      normalizeWindowsPath(rendered),
      `missing Windows cwd marker ${cwdPrefix}`,
    ).toContain(normalizeWindowsPath(`${cwdPrefix}${plan.expectedCwd}`));
  } else {
    expect(
      normalizeLinuxPath(rendered),
      `missing Linux cwd marker ${cwdPrefix}`,
    ).toContain(normalizeLinuxPath(`${cwdPrefix}${plan.expectedCwd}`));
  }
}

function probeComplete(text: string, plan: ProbePlan): boolean {
  const rendered = visible(text);
  const cwdPrefix = plan.ioLine
    .replace(/^NTIO:/, "NTCWD:")
    .replace(/:[^:]+$/, ":");
  const cwdNeedle = `${cwdPrefix}${plan.expectedCwd}`;
  const hasCwd =
    plan.cwdStyle === "windows"
      ? normalizeWindowsPath(rendered).includes(normalizeWindowsPath(cwdNeedle))
      : normalizeLinuxPath(rendered).includes(normalizeLinuxPath(cwdNeedle));
  return (
    rendered.includes(plan.ioLine) &&
    rendered.includes(plan.unicodeLine) &&
    rendered.includes(plan.sizeLine) &&
    hasCwd
  );
}

async function waitForExit(
  exited: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited()) return true;
    await delay(50);
  }
  return exited();
}

async function exerciseDirectPty(
  profile: WindowsTerminalProfile,
  resolved: ResolvedWindowsTerminalProfile,
  catalog: readonly WindowsTerminalProfile[],
): Promise<void> {
  const dialect = profileDialect(profile, catalog);
  const plan = probePlan(dialect, resolved, "direct");
  let terminal: NodePty.IPty | null = null;
  let exited = false;
  const output = new OutputCollector();

  try {
    terminal = nativePty.spawn(resolved.shell, [...resolved.shellArgs], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: resolved.cwd,
      env: envRecord(),
    });
    terminal.onData((data) => output.append(data));
    terminal.onExit(() => {
      exited = true;
    });
    console.info(
      `${LOG_PREFIX} PID ${profile.id} direct-shell=${terminal.pid}`,
    );
    terminal.resize(DIRECT_COLS, DIRECT_ROWS);
    await waitForStartupQuiescence(
      output,
      `${profile.id} direct shell startup`,
    );
    terminal.write(plan.input);
    await output.waitFor(
      (text) => probeComplete(text, plan),
      `${profile.id} direct PTY probe`,
    );
    assertProbe(output.text(), plan);
    terminal.write(plan.exitInput);
    await waitForExit(() => exited, 5_000);
  } finally {
    if (terminal && !exited) {
      // Prefer a normal shell exit. On Windows, force-killing cmd while its ConPTY helper is
      // enumerating descendants can strand a headless conhost which keeps cwd handles open.
      try {
        terminal.write("\x03");
        await delay(100);
        terminal.write(plan.exitInput);
      } catch {
        // The shell may have exited between the failed assertion and cleanup.
      }
      await waitForExit(() => exited, 3_000);
      if (!exited) terminal.kill();
      if (!(await waitForExit(() => exited, 5_000))) {
        throw new Error(
          `${profile.id} direct PTY did not exit after its harness-owned kill.`,
        );
      }
    }
  }
}

async function exerciseWslMissingCwd(
  profile: WindowsTerminalProfile,
  resolved: ResolvedWindowsTerminalProfile,
): Promise<void> {
  const distribution = profile.id.slice("wsl:".length);
  const missingLinuxCwd = `/tmp/nodeterm-real-missing-${runId}-${crypto
    .randomUUID()
    .replace(/-/g, "")}`;
  await execFileResult(
    resolved.shell,
    [
      "-d",
      distribution,
      "--exec",
      "/bin/sh",
      "-c",
      'test ! -e "$1"',
      "nodeterm-check",
      missingLinuxCwd,
    ],
    15_000,
  );

  const args = [...resolved.shellArgs];
  const cdIndex = args.indexOf("--cd");
  if (cdIndex < 0 || args[cdIndex + 1] !== args.at(-1)) {
    throw new Error(
      `${profile.id} WSL plan did not carry one positional cwd guard.`,
    );
  }
  args[cdIndex + 1] = missingLinuxCwd;
  args[args.length - 1] = missingLinuxCwd;

  const output = new OutputCollector();
  const fallbackMarker = `NTWSLFALLBACK${runId.toLocaleUpperCase("en-US")}`;
  let exitCode: number | undefined;
  let terminal: NodePty.IPty | null = null;
  try {
    terminal = nativePty.spawn(resolved.shell, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: workingDir,
      env: envRecord(),
    });
    terminal.onData((data) => output.append(data));
    terminal.onExit((event) => {
      exitCode = event.exitCode;
    });
    console.info(
      `${LOG_PREFIX} PID ${profile.id} missing-cwd-direct-shell=${terminal.pid}`,
    );
    // If WSL incorrectly falls back to `/` and opens the distro shell, queued input paints a
    // computed marker containing that cwd. A correct guard exits before any shell reads it.
    terminal.write(
      `/bin/sh -c 'x=${fallbackMarker}; printf "%s:%s\\n" "$x" "$PWD"'\rexit\r`,
    );
    const exited = await waitForExit(() => exitCode !== undefined, 15_000);
    expect(
      exited,
      `${profile.id} missing-cwd launch opened a persistent fallback shell`,
    ).toBe(true);
    expect(
      exitCode,
      `${profile.id} missing-cwd guard returned the wrong exit code`,
    ).toBe(125);

    const rendered = visible(output.text());
    expect(
      rendered,
      `${profile.id} missing-cwd launch did not show its fixed error`,
    ).toContain(WSL_CWD_FAILURE);
    // WSL itself may print its selected cwd to the terminal before the fixed guard runs. That is
    // terminal output, not a catalog/API/log failure object; the fail-closed contract here is the
    // fixed exit plus proof that no fallback shell consumed the queued marker.
    expect(
      rendered,
      `${profile.id} missing-cwd launch opened a shell in a fallback directory`,
    ).not.toMatch(new RegExp(`${fallbackMarker}:[^\\r\\n]+`));
    await requirePidsGone(
      [terminal.pid],
      `${profile.id} missing-cwd WSL frontend cleanup`,
    );
  } finally {
    if (terminal && exitCode === undefined) {
      try {
        terminal.write("\x03exit\r");
        terminal.kill();
      } catch {
        // A racing guard exit is already the desired cleanup state.
      }
      await waitForExit(() => exitCode !== undefined, 5_000);
      if (exitCode === undefined) {
        const snapshot = await windowsProcessSnapshot();
        const owned = snapshot.find(
          (process) => process.processId === terminal?.pid,
        );
        if (
          owned &&
          owned.name.toLocaleLowerCase("en-US") === "wsl.exe" &&
          owned.commandLine?.includes(missingLinuxCwd)
        ) {
          await execFileResult(
            trustedTaskkillPath(),
            ["/PID", String(owned.processId), "/T", "/F"],
            15_000,
          );
          await requirePidsGone(
            [owned.processId],
            `${profile.id} missing-cwd fallback cleanup`,
          );
        } else if (owned) {
          throw new Error(
            `Refusing fallback cleanup because PID ${owned.processId} is not the harness-owned WSL probe.`,
          );
        }
      }
    }
  }
}

async function assertWslCoreFailureSanitized(
  service: WindowsTerminalProfileService,
  profile: WindowsTerminalProfile,
): Promise<void> {
  const privateMissingCwd = path.join(
    tempRoot,
    `private missing WSL cwd ${crypto.randomUUID()}`,
  );
  expect(fs.existsSync(privateMissingCwd)).toBe(false);
  let failure: unknown;
  try {
    await service.resolveForSpawn({
      profileId: profile.id,
      cwd: privateMissingCwd,
    });
  } catch (error) {
    failure = error;
  }
  if (!(failure instanceof Error)) {
    throw new Error(
      `${profile.id} missing Windows cwd did not return a core failure object.`,
    );
  }
  expect((failure as Error & { code?: unknown }).code).toBe("wsl-cwd-invalid");
  expect(failure.message).not.toContain(privateMissingCwd);
  expect(failure.message).not.toContain(tempRoot);
}

async function captureUntil(
  client: SessionHostClient,
  name: string,
  predicate: (text: string) => boolean,
  description: string,
): Promise<string> {
  const deadline = Date.now() + OUTPUT_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    last = await client.capture(name, true);
    if (predicate(last)) return last;
    await delay(75);
  }
  throw new Error(
    `${description} was not present in the host capture. Tail: ${JSON.stringify(
      visible(last).slice(-1_200),
    )}`,
  );
}

function uniqueSessionName(profileId: string): string {
  sessionSequence += 1;
  const safeProfile =
    profileId.replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 32) || "profile";
  return `nt-real-${runId}-${sessionSequence}-${safeProfile}`;
}

function newHostClient(): SessionHostClient {
  return new SessionHostClient({ userDataDir, repoRoot });
}

function rawSessionHostRequest<T>(
  body: SessionHostRequestBody,
): Promise<T | undefined> {
  const paths = sessionHostPaths(userDataDir);
  const token = fs.readFileSync(paths.tokenPath, "utf8").trim();
  if (!token)
    return Promise.reject(
      new Error("The isolated session-host token is empty."),
    );

  return new Promise((resolve, reject) => {
    const HELLO_ID = 1;
    const REQUEST_ID = 2;
    let settled = false;
    let requestSent = false;
    const socket = net.connect(paths.endpoint);
    const framer = new LineFramer();
    const timer = setTimeout(
      () =>
        finish(new Error(`Raw session-host ${body.cmd} request timed out.`)),
      CONFIRMED_KILL_TIMEOUT_MS,
    );

    function finish(error?: Error, result?: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(result);
    }

    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled)
        finish(
          new Error(`Raw session-host ${body.cmd} connection closed early.`),
        );
    });
    socket.once("connect", () => {
      socket.write(
        encodeFrame({
          id: HELLO_ID,
          cmd: "hello",
          token,
          protocolVersion: SESSION_HOST_PROTOCOL_VERSION,
        }),
      );
    });
    socket.on("data", (chunk: Buffer) => {
      for (const frame of framer.push<SessionHostFrame>(
        chunk.toString("utf8"),
      )) {
        if (!("id" in frame)) continue;
        const response = frame as SessionHostResponse;
        if (response.id === HELLO_ID) {
          if (!response.ok) {
            finish(
              new Error(
                `Raw session-host authentication failed: ${response.error}`,
              ),
            );
            return;
          }
          if (!requestSent) {
            requestSent = true;
            socket.write(encodeFrame({ id: REQUEST_ID, ...body }));
          }
          continue;
        }
        if (response.id !== REQUEST_ID) continue;
        if (!response.ok) {
          finish(
            new Error(`Raw session-host ${body.cmd} failed: ${response.error}`),
          );
          return;
        }
        finish(undefined, response.result as T | undefined);
        return;
      }
    });
  });
}

/** Authenticate, flush exactly one request to the isolated host, then discard the socket without
 * reading that request's reply. Pausing before the write makes the lost-reply boundary explicit:
 * the retry can rely only on the host's operation/generation state, never on local response data. */
function rawSessionHostRequestAndDropReply(
  body: SessionHostRequestBody,
): Promise<void> {
  const paths = sessionHostPaths(userDataDir);
  const token = fs.readFileSync(paths.tokenPath, "utf8").trim();
  if (!token)
    return Promise.reject(
      new Error("The isolated session-host token is empty."),
    );

  return new Promise((resolve, reject) => {
    const HELLO_ID = 1;
    const REQUEST_ID = 2;
    let settled = false;
    let requestFlushed = false;
    const socket = net.connect(paths.endpoint);
    const framer = new LineFramer();
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `Raw session-host ${body.cmd} dropped-reply request timed out.`,
          ),
        ),
      CONFIRMED_KILL_TIMEOUT_MS,
    );

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    }

    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled && !requestFlushed) {
        finish(
          new Error(
            `Raw session-host ${body.cmd} connection closed before request flush.`,
          ),
        );
      }
    });
    socket.once("connect", () => {
      socket.write(
        encodeFrame({
          id: HELLO_ID,
          cmd: "hello",
          token,
          protocolVersion: SESSION_HOST_PROTOCOL_VERSION,
        }),
      );
    });
    socket.on("data", (chunk: Buffer) => {
      for (const frame of framer.push<SessionHostFrame>(
        chunk.toString("utf8"),
      )) {
        if (!("id" in frame) || frame.id !== HELLO_ID) continue;
        const response = frame as SessionHostResponse;
        if (!response.ok) {
          finish(
            new Error(
              `Raw session-host authentication failed: ${response.error}`,
            ),
          );
          return;
        }
        // No response for REQUEST_ID may be delivered to this process after this boundary.
        socket.pause();
        socket.write(encodeFrame({ id: REQUEST_ID, ...body }), (error) => {
          if (error) {
            finish(error);
            return;
          }
          requestFlushed = true;
          finish();
        });
        return;
      }
    });
  });
}

async function waitForRawSessionGeneration(name: string): Promise<string> {
  const deadline = Date.now() + OUTPUT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await rawSessionHostRequest<HasSessionResult>({
      cmd: "hasSession",
      name,
    });
    if (
      result?.exists === true &&
      typeof result.generation === "string" &&
      /^[A-Za-z0-9_-]{8,128}$/.test(result.generation)
    ) {
      return result.generation;
    }
    await delay(50);
  }
  throw new Error(
    `Raw session-host probe never observed a generation for ${name}.`,
  );
}

async function waitForRawCapture(
  name: string,
  predicate: (text: string) => boolean,
  description: string,
): Promise<string> {
  const deadline = Date.now() + OUTPUT_TIMEOUT_MS;
  let last = "";
  while (Date.now() < deadline) {
    const result = await rawSessionHostRequest<CaptureResult>({
      cmd: "capture",
      name,
      full: true,
    });
    last = result?.text ?? "";
    if (predicate(last)) return last;
    await delay(75);
  }
  throw new Error(
    `${description} was not present in the raw host capture. Tail: ${JSON.stringify(
      visible(last).slice(-1_200),
    )}`,
  );
}

function occurrenceCount(text: string, marker: string): number {
  if (!marker) throw new Error("Cannot count an empty marker.");
  return text.split(marker).length - 1;
}

function silentSpawn(
  cwd: string,
  evidencePath: string,
): SessionHostSpawnOptions {
  const fixture = path.join(
    repoRoot,
    "src",
    "core",
    "__fixtures__",
    "silent-session-host-child.cjs",
  );
  if (!fs.existsSync(fixture))
    throw new Error(`Silent session-host fixture is missing: ${fixture}`);
  return {
    cwd,
    shell: process.execPath,
    args: [fixture, evidencePath],
    env: { ...envRecord(), ELECTRON_RUN_AS_NODE: "1" },
    cols: 80,
    rows: 24,
  };
}

async function waitForSilentPidEvidence(
  evidencePath: string,
): Promise<{ parentPid: number; childPid: number }> {
  const deadline = Date.now() + OUTPUT_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as {
        parentPid?: unknown;
        childPid?: unknown;
      };
      if (
        Number.isSafeInteger(parsed.parentPid) &&
        Number(parsed.parentPid) > 0 &&
        Number.isSafeInteger(parsed.childPid) &&
        Number(parsed.childPid) > 0
      ) {
        return {
          parentPid: Number(parsed.parentPid),
          childPid: Number(parsed.childPid),
        };
      }
      lastError = new Error(
        "PID evidence did not contain two positive integers",
      );
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `Silent fixture did not publish PID evidence at ${evidencePath}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function attachSilentSession(
  name: string,
  cwd: string,
  expectedColdCount: number,
): Promise<SilentSessionEvidence> {
  fs.mkdirSync(cwd, { recursive: true });
  createdSessionNames.add(name);
  const evidencePath = path.join(cwd, `${name}.pid.json`);
  if (fs.existsSync(evidencePath)) {
    throw new Error(
      `Refusing to reuse stale silent-fixture evidence ${evidencePath}`,
    );
  }
  const before = await windowsProcessSnapshot();
  const client = newHostClient();
  const pty = new SessionHostPty(
    client,
    name,
    silentSpawn(cwd, evidencePath),
    SCROLLBACK,
  );
  const output = new OutputCollector();
  pty.onData((data) => output.append(data));

  try {
    const ready = await withTimeout(
      pty.ready,
      OUTPUT_TIMEOUT_MS,
      `silent session ${name} attach`,
    );
    expect(ready.fresh, `${name} did not cold-spawn its silent fixture`).toBe(
      true,
    );
    if (!ready.generation)
      throw new Error(`${name} returned no opaque process generation.`);
    const shellPid = await waitForColdSpawnPid(name, expectedColdCount);
    const pidEvidence = await waitForSilentPidEvidence(evidencePath);
    expect(
      pidEvidence.parentPid,
      `${name} PID evidence named a different root`,
    ).toBe(shellPid);
    const hostPid = isolatedHostPid();
    const live = await waitForProcessEvidence(
      (snapshot) =>
        snapshot.some((process) => process.processId === shellPid) &&
        snapshot.some(
          (process) =>
            process.processId === pidEvidence.childPid &&
            process.parentProcessId === shellPid,
        ) &&
        newConhostPids(before, snapshot, hostPid).length > 0,
      `${name} shell/conhost process tree`,
    );
    const conhostPids = newConhostPids(before, live, hostPid);
    const trackedPids = [
      ...new Set([...descendantPids(live, shellPid), ...conhostPids]),
    ];
    expect(trackedPids, `${name} descendant PID was not captured`).toContain(
      pidEvidence.childPid,
    );
    const trackedProcesses = live.filter((process) =>
      trackedPids.includes(process.processId),
    );
    for (const process of trackedProcesses)
      trackedFixtureProcesses.set(process.processId, process);
    expect(
      conhostPids.length,
      `${name} produced no independently observed ConPTY conhost`,
    ).toBeGreaterThan(0);
    await delay(250);
    expect(output.text(), `${name} emitted data before its explicit kill`).toBe(
      "",
    );
    console.info(
      `${LOG_PREFIX} PID silent session-host=${hostPid} root=${shellPid} tree=${trackedPids.join(",")} session=${name}`,
    );
    return {
      client,
      pty,
      generation: ready.generation,
      hostPid,
      shellPid,
      childPid: pidEvidence.childPid,
      trackedPids,
      trackedProcesses,
      output,
    };
  } catch (error) {
    pty.destroy();
    throw error;
  }
}

async function confirmedKillSilent(
  name: string,
  evidence: SilentSessionEvidence,
): Promise<void> {
  await withTimeout(
    evidence.client.killSession(name),
    CONFIRMED_KILL_TIMEOUT_MS,
    `confirmed kill for ${name}`,
  );
  createdSessionNames.delete(name);
  expect(
    await evidence.client.hasSession(name),
    `${name} still exists after confirmed kill`,
  ).toBe(false);
  await requirePidsGone(
    evidence.trackedPids,
    `${name} exact process tree cleanup`,
  );
  for (const process of evidence.trackedProcesses) {
    trackedFixtureProcesses.delete(process.processId);
  }
  evidence.pty.destroy();
}

function removeAcceptanceCwd(cwd: string): void {
  fs.rmSync(cwd, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
  expect(
    fs.existsSync(cwd),
    `Session cleanup left a cwd handle open at ${cwd}`,
  ).toBe(false);
}

function isolatedHostPid(): number {
  const state = JSON.parse(
    fs.readFileSync(sessionHostPaths(userDataDir).statePath, "utf8"),
  ) as { pid?: unknown; endpoint?: unknown; tokenPath?: unknown };
  const expected = sessionHostPaths(userDataDir);
  if (!Number.isSafeInteger(state.pid) || Number(state.pid) <= 0) {
    throw new Error(
      "The isolated session-host state did not contain a valid PID.",
    );
  }
  if (
    state.endpoint !== expected.endpoint ||
    state.tokenPath !== expected.tokenPath
  ) {
    throw new Error(
      "The isolated session-host state points outside the harness userData boundary.",
    );
  }
  return Number(state.pid);
}

function coldSpawnPids(name: string): number[] {
  const log = fs.readFileSync(
    path.join(userDataDir, "session-host.log"),
    "utf8",
  );
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...log.matchAll(
      new RegExp(`attach \\(cold\\) name=${escaped} pid=(\\d+)`, "g"),
    ),
  ].map((match) => Number(match[1]));
}

async function waitForColdSpawnPid(
  name: string,
  expectedCount: number,
): Promise<number> {
  const deadline = Date.now() + OUTPUT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const pids = coldSpawnPids(name);
      if (pids.length === expectedCount && pids[expectedCount - 1]) {
        return pids[expectedCount - 1];
      }
    } catch {
      // The detached host may not have flushed its first log record yet.
    }
    await delay(50);
  }
  throw new Error(
    `Session ${name} did not produce exactly ${expectedCount} cold-spawn log record(s).`,
  );
}

async function killOwnedSession(
  name: string,
  clients: readonly SessionHostClient[],
): Promise<void> {
  let lastError: unknown;
  for (const client of [...clients, newHostClient()]) {
    try {
      await client.killSession(name);
      createdSessionNames.delete(name);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Could not kill harness-owned session ${name}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function requestGracefulSessionExit(
  name: string,
  clients: readonly SessionHostClient[],
): Promise<boolean> {
  const candidates = [...clients, newHostClient()];
  for (const client of candidates) {
    try {
      if (!(await client.hasSession(name))) return true;
      await client.sendKeys(name, "\x03", false);
      await delay(100);
      await client.sendKeys(name, "exit", true);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (!(await client.hasSession(name))) return true;
        await delay(75);
      }
    } catch {
      // Try the next independently connected client; killSession remains the final boundary.
    }
  }
  return false;
}

function logHostPids(profileId: string, name: string): void {
  try {
    const hostPid = isolatedHostPid();
    const shellPid = coldSpawnPids(name).at(-1);
    console.info(
      `${LOG_PREFIX} PID ${profileId} session-host=${String(hostPid)} hosted-shell=${
        shellPid || "not-yet-recorded"
      } session=${name}`,
    );
  } catch {
    console.info(
      `${LOG_PREFIX} PID ${profileId} session=${name} (host evidence unavailable)`,
    );
  }
}

async function exerciseSessionHost(
  profile: WindowsTerminalProfile,
  resolved: ResolvedWindowsTerminalProfile,
  catalog: readonly WindowsTerminalProfile[],
): Promise<void> {
  const dialect = profileDialect(profile, catalog);
  const firstPlan = probePlan(dialect, resolved, "host1");
  const secondPlan = probePlan(dialect, resolved, "host2");
  const name = uniqueSessionName(profile.id);
  createdSessionNames.add(name); // Register BEFORE attach so every partial create is cleaned.

  const spawn = {
    cwd: resolved.cwd,
    shell: resolved.shell,
    args: [...resolved.shellArgs],
    env: envRecord(),
    cols: 80,
    rows: 24,
  };
  const firstClient = newHostClient();
  const secondClient = newHostClient();
  let firstPty: SessionHostPty | null = null;
  let secondPty: SessionHostPty | null = null;

  try {
    const firstOutput = new OutputCollector();
    firstPty = new SessionHostPty(firstClient, name, spawn, SCROLLBACK);
    firstPty.onData((data) => firstOutput.append(data));
    const cold = await firstPty.ready;
    const coldPid = await waitForColdSpawnPid(name, 1);
    logHostPids(profile.id, name);
    expect(
      cold.fresh,
      `${profile.id} first session-host attach was not cold`,
    ).toBe(true);
    expect(
      cold.generation,
      `${profile.id} cold attach returned no process generation`,
    ).toMatch(/^[0-9a-f-]{20,}$/i);
    expect(
      (await windowsProcessSnapshot()).some(
        (process) => process.processId === coldPid,
      ),
      `${profile.id} cold-spawn PID ${coldPid} is not alive`,
    ).toBe(true);
    expect(await firstClient.hasSession(name)).toBe(true);

    firstPty.resize(DIRECT_COLS, DIRECT_ROWS);
    await waitForStartupQuiescence(
      firstOutput,
      `${profile.id} session-host shell startup`,
    );
    firstPty.write(firstPlan.input);
    await firstOutput.waitFor(
      (text) => probeComplete(text, firstPlan),
      `${profile.id} first session-host probe`,
    );
    assertProbe(firstOutput.text(), firstPlan);
    const firstCapture = await captureUntil(
      firstClient,
      name,
      (text) => probeComplete(text, firstPlan),
      `${profile.id} persistent screen`,
    );
    assertProbe(firstCapture, firstPlan);

    // SessionHostPty.destroy is detach-only. A distinct authenticated client proves warm attach
    // does not reuse the first subscription or its reconstructed-screen response.
    firstPty.destroy();
    firstPty = null;
    await delay(150);
    expect(await secondClient.hasSession(name)).toBe(true);

    const secondOutput = new OutputCollector();
    secondPty = new SessionHostPty(secondClient, name, spawn, SCROLLBACK);
    secondPty.onData((data) => secondOutput.append(data));
    const warm = await secondPty.ready;
    expect(
      warm.fresh,
      `${profile.id} reattach incorrectly created a different process`,
    ).toBe(false);
    expect(
      warm.generation,
      `${profile.id} reattach changed the process generation`,
    ).toBe(cold.generation);
    expect(
      warm.screen,
      `${profile.id} warm reattach returned no reconstructed screen`,
    ).toBeTruthy();
    expect(
      coldSpawnPids(name),
      `${profile.id} reattach produced a second cold-spawn process`,
    ).toEqual([coldPid]);
    expect(
      (await windowsProcessSnapshot()).some(
        (process) => process.processId === coldPid,
      ),
      `${profile.id} original PID ${coldPid} did not survive detach/reattach`,
    ).toBe(true);
    assertProbe(warm.screen as string, firstPlan);

    // Prove the reattached shim is live, not merely a historical capture.
    secondPty.write(secondPlan.input);
    await secondOutput.waitFor(
      (text) => probeComplete(text, secondPlan),
      `${profile.id} reattached session-host probe`,
    );
    assertProbe(secondOutput.text(), secondPlan);
    const secondCapture = await captureUntil(
      secondClient,
      name,
      (text) => probeComplete(text, secondPlan),
      `${profile.id} post-reattach screen`,
    );
    assertProbe(secondCapture, secondPlan);

    await requestGracefulSessionExit(name, [secondClient, firstClient]);
    secondPty.destroy();
    secondPty = null;
    await killOwnedSession(name, [secondClient, firstClient]);
    expect(await secondClient.hasSession(name)).toBe(false);
    await requirePidsGone([coldPid], `${profile.id} hosted shell cleanup`);
  } finally {
    firstPty?.destroy();
    secondPty?.destroy();
    if (createdSessionNames.has(name)) {
      await requestGracefulSessionExit(name, [secondClient, firstClient]);
      await killOwnedSession(name, [secondClient, firstClient]);
    }
  }
}

function hostLogTail(): string {
  try {
    const log = fs.readFileSync(
      path.join(userDataDir, "session-host.log"),
      "utf8",
    );
    return log.slice(-4_000);
  } catch {
    return "(session-host log unavailable)";
  }
}

async function waitForIsolatedHostExit(): Promise<void> {
  const { statePath } = sessionHostPaths(userDataDir);
  if (!fs.existsSync(statePath)) return;
  const deadline = Date.now() + HOST_EXIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!fs.existsSync(statePath)) {
      await delay(200);
      return;
    }
    await delay(100);
  }
  throw new Error(
    `The isolated session host did not remove its state file after all harness sessions were killed. ` +
      `Log tail:\n${hostLogTail()}`,
  );
}

function assertHarnessTempBoundary(): void {
  const resolvedRoot = path.resolve(tempRoot);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (
    path.dirname(resolvedRoot) !== resolvedTemp ||
    !path.basename(resolvedRoot).startsWith("nodeterm profiles real ")
  ) {
    throw new Error(
      `Refusing cleanup outside the exact harness temp boundary: ${resolvedRoot}`,
    );
  }
}

function trustedTaskkillPath(): string {
  const executable = path.win32.join(
    process.env.SystemRoot || process.env.WINDIR || "",
    "System32",
    "taskkill.exe",
  );
  if (!path.win32.isAbsolute(executable) || !fs.existsSync(executable)) {
    throw new Error(
      "Cannot locate trusted System32 taskkill.exe for isolated cleanup.",
    );
  }
  return executable;
}

async function terminateIsolatedHostForCleanup(): Promise<void> {
  assertHarnessTempBoundary();
  const paths = sessionHostPaths(userDataDir);
  if (!fs.existsSync(paths.statePath)) return;
  const pid = isolatedHostPid();
  const before = await windowsProcessSnapshot();
  const host = before.find((process) => process.processId === pid);
  if (!host) return; // Stale state only; the exact process is independently absent.
  const commandLine = host.commandLine?.toLocaleLowerCase("en-US");
  const expectedUserData = userDataDir.toLocaleLowerCase("en-US");
  if (
    !commandLine ||
    !commandLine.includes("session-host") ||
    !commandLine.includes("host.cjs") ||
    !commandLine.includes(expectedUserData)
  ) {
    throw new Error(
      `Refusing fallback termination because PID ${pid} is not the exact isolated harness host.`,
    );
  }
  const trackedPids = descendantPids(before, pid);
  await execFileResult(
    trustedTaskkillPath(),
    ["/PID", String(pid), "/T", "/F"],
    15_000,
  );
  await requirePidsGone(
    trackedPids,
    "isolated fallback host/process-tree cleanup",
  );
  createdSessionNames.clear();
  console.info(
    `${LOG_PREFIX} CLEANUP fallback terminated isolated host=${pid} tree=${trackedPids.join(",")}`,
  );
}

async function cleanupTrackedFixtureProcesses(): Promise<number[]> {
  const killed: number[] = [];
  for (const recorded of [...trackedFixtureProcesses.values()]) {
    const snapshot = await windowsProcessSnapshot();
    const current = snapshot.find(
      (process) => process.processId === recorded.processId,
    );
    if (!current || processIdentity(current) !== processIdentity(recorded)) {
      trackedFixtureProcesses.delete(recorded.processId);
      continue;
    }
    const isConhost =
      recorded.name.toLocaleLowerCase("en-US") === "conhost.exe";
    const isFixture = recorded.commandLine
      ?.toLocaleLowerCase("en-US")
      .includes("silent-session-host-child.cjs");
    if (!isConhost && !isFixture) {
      throw new Error(
        `Refusing fallback termination because PID ${recorded.processId} no longer identifies a harness fixture.`,
      );
    }
    try {
      await execFileResult(
        trustedTaskkillPath(),
        ["/PID", String(recorded.processId), "/T", "/F"],
        15_000,
      );
    } catch (error) {
      const afterError = await windowsProcessSnapshot();
      if (
        afterError.some(
          (process) => processIdentity(process) === processIdentity(recorded),
        )
      ) {
        throw error;
      }
    }
    await waitForProcessEvidence(
      (after) =>
        !after.some(
          (process) => processIdentity(process) === processIdentity(recorded),
        ),
      `fallback cleanup for recorded fixture PID ${recorded.processId}`,
    );
    killed.push(recorded.processId);
    trackedFixtureProcesses.delete(recorded.processId);
  }
  return killed;
}

beforeAll(async () => {
  if (!process.versions.electron || process.env.ELECTRON_RUN_AS_NODE !== "1") {
    throw new Error(
      "Real Windows profile acceptance must run under the repository Electron binary with " +
        "ELECTRON_RUN_AS_NODE=1. Use: node scripts/run-windows-terminal-profiles-real.mjs",
    );
  }
  try {
    nativePty = await import("node-pty");
  } catch (error) {
    throw new Error(
      `Electron could not load its node-pty native binding. Run npm run rebuild first. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  repoRoot = path.resolve(__dirname, "../..");
  runId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nodeterm profiles real "));
  userDataDir = path.join(tempRoot, "isolated user data");
  workingDir = path.join(tempRoot, "working directory with spaces");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(workingDir, { recursive: true });
});

afterAll(async () => {
  const cleanupErrors: string[] = [];
  let safeToRemove = false;
  if (userDataDir) {
    const cleanupResults = await Promise.allSettled(
      [...createdSessionNames].map((name) =>
        withTimeout(
          killOwnedSession(name, []),
          CONFIRMED_KILL_TIMEOUT_MS,
          `afterAll confirmed kill for ${name}`,
        ),
      ),
    );
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        cleanupErrors.push(
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        );
      }
    }
    if (createdSessionNames.size === 0) {
      try {
        await waitForIsolatedHostExit();
        safeToRemove = true;
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    if (!safeToRemove) {
      try {
        await terminateIsolatedHostForCleanup();
        safeToRemove = true;
      } catch (error) {
        cleanupErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    try {
      const fallbackPids = await cleanupTrackedFixtureProcesses();
      if (fallbackPids.length > 0) {
        cleanupErrors.push(
          `Harness fallback had to terminate recorded fixture PID(s): ${fallbackPids.join(",")}`,
        );
      }
    } catch (error) {
      cleanupErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (tempRoot && safeToRemove) {
    try {
      assertHarnessTempBoundary();
      fs.rmSync(tempRoot, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      });
    } catch (error) {
      cleanupErrors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (cleanupErrors.length > 0) {
    throw new Error(
      `Real Windows profile cleanup encountered an error; isolated directory ${
        fs.existsSync(tempRoot) ? `was retained at ${tempRoot}` : "was cleaned"
      }.\n` + cleanupErrors.join("\n"),
    );
  }
}, 2 * 60_000);

suite(
  "REAL Windows terminal profiles (explicit Electron-as-Node acceptance)",
  () => {
    it(
      "runs every detected available profile through node-pty and detach/reattach session-host persistence",
      async () => {
        const hasCustomFixture = Object.prototype.hasOwnProperty.call(
          process.env,
          "NODETERM_WINDOWS_PROFILE_CUSTOM",
        );
        const customExecutable = hasCustomFixture
          ? process.env.NODETERM_WINDOWS_PROFILE_CUSTOM
          : undefined;
        const service = new WindowsTerminalProfileService({
          getCustomExecutable: () => customExecutable,
        });
        const catalog = await service.refresh();

        expect(
          new Set(catalog.map((profile) => profile.id)).size,
          "profile IDs are not unique",
        ).toBe(catalog.length);
        for (const fixedId of [
          "auto",
          "pwsh",
          "windows-powershell",
          "cmd",
          "git-bash",
          "custom",
        ]) {
          expect(
            catalog.filter((profile) => profile.id === fixedId),
            `trusted catalog omitted fixed profile ${fixedId}`,
          ).toHaveLength(1);
        }

        for (const profile of catalog.filter(
          (candidate) => !candidate.available,
        )) {
          expect(
            typeof profile.unavailableReason === "string" &&
              profile.unavailableReason.trim().length > 0,
            `${profile.id} must name why it is unavailable`,
          ).toBe(true);
          const reason = profile.unavailableReason as string;
          console.info(
            `${LOG_PREFIX} UNAVAILABLE ${profile.id} (${profile.label}): ${reason}`,
          );
        }

        const available = catalog.filter((candidate) => candidate.available);
        expect(
          available.length,
          "trusted detection returned no usable Windows terminal profile",
        ).toBeGreaterThan(0);
        const failures: string[] = [];

        for (const profile of available) {
          console.info(`${LOG_PREFIX} RUN ${profile.id} (${profile.label})`);
          let resolved: ResolvedWindowsTerminalProfile;
          try {
            resolved = await service.resolveForSpawn({
              profileId: profile.id,
              cwd: workingDir,
              ...(profile.id === "custom" ? { customExecutable } : {}),
            });
            assertResolvedIdentity(
              profile,
              resolved,
              catalog,
              customExecutable,
            );
          } catch (error) {
            failures.push(
              `${profile.id} trusted resolution: ${
                error instanceof Error
                  ? error.stack || error.message
                  : String(error)
              }`,
            );
            continue;
          }

          try {
            await exerciseDirectPty(profile, resolved, catalog);
            console.info(`${LOG_PREFIX} PASS ${profile.id} direct-node-pty`);
          } catch (error) {
            failures.push(
              `${profile.id} direct-node-pty: ${
                error instanceof Error
                  ? error.stack || error.message
                  : String(error)
              }`,
            );
          }

          try {
            await exerciseSessionHost(profile, resolved, catalog);
            console.info(
              `${LOG_PREFIX} PASS ${profile.id} session-host-reattach`,
            );
          } catch (error) {
            failures.push(
              `${profile.id} session-host: ${
                error instanceof Error
                  ? error.stack || error.message
                  : String(error)
              }\nHost log tail:\n${hostLogTail()}`,
            );
          }

          if (profile.id.startsWith("wsl:")) {
            try {
              await assertWslCoreFailureSanitized(service, profile);
              await exerciseWslMissingCwd(profile, resolved);
              console.info(
                `${LOG_PREFIX} PASS ${profile.id} missing-cwd-fails-closed`,
              );
            } catch (error) {
              failures.push(
                `${profile.id} missing-cwd fail-closed launch: ${
                  error instanceof Error
                    ? error.stack || error.message
                    : String(error)
                }`,
              );
            }
          }
        }

        if (failures.length > 0) {
          throw new AggregateError(
            failures.map((failure) => new Error(failure)),
            `${failures.length} real Windows profile acceptance path(s) failed:\n${failures.join("\n\n")}`,
          );
        }
      },
      10 * 60_000,
    );

    it(
      "confirms a pre-first-output kill only after the silent Windows process tree and conhost are gone",
      async () => {
        const name = uniqueSessionName("silent-pre-output");
        const cwd = path.join(tempRoot, "silent pre output cwd");
        let evidence: SilentSessionEvidence | null = null;
        try {
          evidence = await attachSilentSession(name, cwd, 1);
          expect(
            evidence.output.text(),
            `${name} painted before the kill request`,
          ).toBe("");
          await confirmedKillSilent(name, evidence);
          removeAcceptanceCwd(cwd);
          console.info(
            `${LOG_PREFIX} PASS silent-pre-output confirmed-process-tree-kill`,
          );
        } finally {
          evidence?.pty.destroy();
          if (createdSessionNames.has(name)) {
            await withTimeout(
              killOwnedSession(name, evidence ? [evidence.client] : []),
              CONFIRMED_KILL_TIMEOUT_MS,
              `cleanup kill for ${name}`,
            );
          }
          if (evidence)
            await requirePidsGone(
              evidence.trackedPids,
              `${name} final cleanup`,
            );
          if (!createdSessionNames.has(name) && fs.existsSync(cwd))
            removeAcceptanceCwd(cwd);
        }
      },
      2 * 60_000,
    );

    it(
      "keeps a replacement generation alive across multi-client kill replay and stale-generation ABA",
      async () => {
        const name = uniqueSessionName("kill-aba");
        const cwd = path.join(tempRoot, "kill replay aba cwd");
        const firstOperationId = `ntrealaba${crypto.randomUUID().replace(/-/g, "")}`;
        const staleOperationId = `ntrealstale${crypto.randomUUID().replace(/-/g, "")}`;
        let first: SilentSessionEvidence | null = null;
        let replacement: SilentSessionEvidence | null = null;
        try {
          first = await attachSilentSession(name, cwd, 1);
          await rawSessionHostRequest<void>({
            cmd: "killSession",
            name,
            operationId: firstOperationId,
            expectedGeneration: first.generation,
            reserveReplacement: false,
          });
          first.pty.destroy();
          await requirePidsGone(
            first.trackedPids,
            `${name} first-generation raw kill`,
          );
          expect(await first.client.hasSession(name)).toBe(false);

          replacement = await attachSilentSession(name, cwd, 2);
          expect(
            replacement.generation,
            "same-name replacement reused an old generation",
          ).not.toBe(first.generation);

          // A third client repeats the exact old operation after its acknowledgement. The host's
          // completed-operation cache must answer without applying it to the replacement process.
          await rawSessionHostRequest<void>({
            cmd: "killSession",
            name,
            operationId: firstOperationId,
            expectedGeneration: first.generation,
            reserveReplacement: false,
          });
          expect(await replacement.client.hasSession(name)).toBe(true);
          await requirePidsAlive(
            replacement.trackedPids,
            `${name} after completed-operation replay`,
          );

          // A fourth client's new operation ID cannot target the replacement through a stale exact
          // generation either. This discriminates the generation guard from only the replay cache.
          await rawSessionHostRequest<void>({
            cmd: "killSession",
            name,
            operationId: staleOperationId,
            expectedGeneration: first.generation,
            reserveReplacement: false,
          });
          expect(await replacement.client.hasSession(name)).toBe(true);
          await requirePidsAlive(
            replacement.trackedPids,
            `${name} after stale-generation kill`,
          );

          await confirmedKillSilent(name, replacement);
          removeAcceptanceCwd(cwd);
          console.info(
            `${LOG_PREFIX} PASS kill-operation-replay-generation-aba`,
          );
        } finally {
          first?.pty.destroy();
          replacement?.pty.destroy();
          if (createdSessionNames.has(name)) {
            await withTimeout(
              killOwnedSession(
                name,
                [replacement?.client, first?.client].filter(
                  (client): client is SessionHostClient => Boolean(client),
                ),
              ),
              CONFIRMED_KILL_TIMEOUT_MS,
              `cleanup kill for ${name}`,
            );
          }
          const tracked = [
            ...(first?.trackedPids ?? []),
            ...(replacement?.trackedPids ?? []),
          ];
          if (tracked.length > 0)
            await requirePidsGone(tracked, `${name} final cleanup`);
          if (!createdSessionNames.has(name) && fs.existsSync(cwd))
            removeAcceptanceCwd(cwd);
        }
      },
      3 * 60_000,
    );

    it(
      "replays a lost reserved-attach reply into one replacement generation and one launch",
      async () => {
        const name = uniqueSessionName("replacement-attach-reply-loss");
        const cwd = path.join(tempRoot, "replacement attach reply loss cwd");
        const reserveOperationId = `ntrealreserve${crypto.randomUUID().replace(/-/g, "")}`;
        const cleanupOperationId = `ntrealcleanup${crypto.randomUUID().replace(/-/g, "")}`;
        const wrongToken = `ntrealwrong${crypto.randomUUID().replace(/-/g, "")}`;
        const launchId = crypto.randomUUID();
        const marker = `NTREPLYLOSS${runId.toLocaleUpperCase("en-US")}`;
        let firstPid: number | undefined;
        let replacementPid: number | undefined;
        let replacementGeneration: string | undefined;

        fs.mkdirSync(cwd, { recursive: true });
        createdSessionNames.add(name);
        try {
          const service = new WindowsTerminalProfileService();
          const catalog = await service.refresh();
          const descriptor = catalog.find((profile) => profile.id === "cmd");
          expect(
            descriptor?.available,
            "cmd is unavailable on the supported Windows target",
          ).toBe(true);
          if (!descriptor)
            throw new Error("Trusted catalog omitted the cmd descriptor.");
          const resolved = await service.resolveForSpawn({
            profileId: "cmd",
            cwd,
          });
          assertResolvedIdentity(descriptor, resolved, catalog);

          const baseSpawn: SessionHostSpawnOptions = {
            cwd: resolved.cwd,
            shell: resolved.shell,
            args: [...resolved.shellArgs],
            env: envRecord(),
            cols: 80,
            rows: 24,
            launchDialect: "cmd",
          };
          const firstAttach = await rawSessionHostRequest<AttachResult>({
            cmd: "attach",
            name,
            spawn: baseSpawn,
            scrollback: SCROLLBACK,
          });
          expect(firstAttach?.fresh).toBe(true);
          expect(firstAttach?.generation).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
          const firstGeneration = firstAttach?.generation as string;
          firstPid = await waitForColdSpawnPid(name, 1);

          const reservation = await rawSessionHostRequest<KillSessionResult>({
            cmd: "killSession",
            name,
            operationId: reserveOperationId,
            expectedGeneration: firstGeneration,
            reserveReplacement: true,
          });
          expect(reservation?.replacementToken).toBe(reserveOperationId);
          await requirePidsGone(
            [firstPid],
            `${name} reserved first-generation kill`,
          );

          const replacementSpawn: SessionHostSpawnOptions = {
            ...baseSpawn,
            initialLaunch: {
              launchId,
              command: `echo ${marker}`,
            },
          };
          await rawSessionHostRequestAndDropReply({
            cmd: "attach",
            name,
            spawn: replacementSpawn,
            scrollback: SCROLLBACK,
            replacementToken: reserveOperationId,
          });

          // The dropped socket conveyed no attach reply. Establish the generation and launch only
          // from independent host probes before replaying the exact same token and spawn request.
          replacementGeneration = await waitForRawSessionGeneration(name);
          expect(replacementGeneration).not.toBe(firstGeneration);
          replacementPid = await waitForColdSpawnPid(name, 2);
          const screenBeforeRetry = await waitForRawCapture(
            name,
            (text) => occurrenceCount(visible(text), marker) === 1,
            `${name} first replacement launch marker`,
          );
          expect(occurrenceCount(visible(screenBeforeRetry), marker)).toBe(1);

          await expect(
            rawSessionHostRequest<AttachResult>({
              cmd: "attach",
              name,
              spawn: replacementSpawn,
              scrollback: SCROLLBACK,
              replacementToken: wrongToken,
            }),
          ).rejects.toThrow("cannot attach a different live generation");
          expect(await waitForRawSessionGeneration(name)).toBe(
            replacementGeneration,
          );
          await requirePidsAlive(
            [replacementPid],
            `${name} after wrong-token attach`,
          );

          const replay = await rawSessionHostRequest<AttachResult>({
            cmd: "attach",
            name,
            spawn: replacementSpawn,
            scrollback: SCROLLBACK,
            replacementToken: reserveOperationId,
          });
          expect(replay?.fresh).toBe(true);
          expect(replay?.generation).toBe(replacementGeneration);
          expect(replay?.initialLaunchStatus).toBe("already-executed");
          expect(replay?.screen).toBe(screenBeforeRetry);
          expect(occurrenceCount(visible(replay?.screen ?? ""), marker)).toBe(
            1,
          );
          expect(coldSpawnPids(name)).toEqual([firstPid, replacementPid]);
          expect(await waitForRawSessionGeneration(name)).toBe(
            replacementGeneration,
          );
          await requirePidsAlive(
            [replacementPid],
            `${name} after same-token attach replay`,
          );

          const finalCapture = await waitForRawCapture(
            name,
            (text) => occurrenceCount(visible(text), marker) === 1,
            `${name} replay-stable launch marker`,
          );
          expect(occurrenceCount(visible(finalCapture), marker)).toBe(1);

          await rawSessionHostRequest<KillSessionResult>({
            cmd: "killSession",
            name,
            operationId: cleanupOperationId,
            expectedGeneration: replacementGeneration,
            reserveReplacement: false,
          });
          createdSessionNames.delete(name);
          await requirePidsGone(
            [replacementPid],
            `${name} replacement cleanup`,
          );
          removeAcceptanceCwd(cwd);
          console.info(
            `${LOG_PREFIX} PASS replacement-attach-reply-loss-exactly-once`,
          );
        } finally {
          if (createdSessionNames.has(name)) {
            await withTimeout(
              killOwnedSession(name, []),
              CONFIRMED_KILL_TIMEOUT_MS,
              `cleanup kill for ${name}`,
            );
          }
          const pids = [firstPid, replacementPid].filter(
            (pid): pid is number => typeof pid === "number",
          );
          if (pids.length > 0)
            await requirePidsGone(pids, `${name} final cleanup`);
          if (!createdSessionNames.has(name) && fs.existsSync(cwd))
            removeAcceptanceCwd(cwd);
        }
      },
      3 * 60_000,
    );
  },
);
