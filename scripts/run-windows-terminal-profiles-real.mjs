#!/usr/bin/env node
/**
 * Safe launcher for the opt-in real-Windows profile acceptance suite.
 *
 * The outer process can be ordinary Node. The suite itself is always started by THIS repository's
 * Electron binary with ELECTRON_RUN_AS_NODE=1, because postinstall rebuilds node-pty for the
 * Electron ABI. The session-host bundle is rebuilt first so the verdict covers the current tree.
 *
 * Optional custom fixture (PowerShell example):
 *   $env:NODETERM_WINDOWS_PROFILE_CUSTOM='C:\Program Files\PowerShell\7\pwsh.exe'
 *   $env:NODETERM_WINDOWS_PROFILE_CUSTOM_DIALECT='powershell'
 *   node scripts/run-windows-terminal-profiles-real.mjs
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function fail(message, code = 1) {
  process.stderr.write(`[real-windows-profiles] ${message}\n`);
  process.exit(code);
}

if (process.platform !== "win32") {
  fail(
    "This acceptance runner is Windows-only; no profile result was recorded.",
  );
}

const electronExe = path.join(
  repoRoot,
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const vitestEntry = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const testFile = path.join(
  repoRoot,
  "src",
  "core",
  "windows-terminal-profiles.realwindows.test.ts",
);
const configFile = path.join(repoRoot, "vitest.config.ts");

for (const [label, candidate] of [
  ["repository Electron binary", electronExe],
  ["Vitest entry point", vitestEntry],
  ["real-Windows acceptance file", testFile],
  ["Vitest configuration", configFile],
]) {
  if (!fs.existsSync(candidate)) fail(`${label} is missing at ${candidate}`);
}

process.stdout.write(
  "[real-windows-profiles] Building the current session-host bundle...\n",
);
const npmCommand = process.env.ComSpec || process.env.COMSPEC || "cmd.exe";
const hostBuild = spawnSync(
  npmCommand,
  ["/d", "/s", "/c", "npm run host:build"],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);
if (hostBuild.error)
  fail(`Could not start the session-host build: ${hostBuild.error.message}`);
if (hostBuild.status !== 0) {
  fail(
    `The session-host build failed with exit code ${hostBuild.status ?? "unknown"}.`,
    hostBuild.status || 1,
  );
}

process.stdout.write(
  "[real-windows-profiles] Launching Vitest under repository Electron (ELECTRON_RUN_AS_NODE=1)...\n",
);
const result = spawnSync(
  electronExe,
  [
    vitestEntry,
    "run",
    testFile,
    "--config",
    configFile,
    "--pool=forks",
    "--maxWorkers=1",
    "--no-file-parallelism",
    "--reporter=verbose",
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODETERM_WINDOWS_PROFILE_REAL: "1",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error)
  fail(`Could not start repository Electron: ${result.error.message}`);
if (result.signal)
  fail(`Repository Electron ended from signal ${result.signal}.`);
process.exit(result.status ?? 1);
