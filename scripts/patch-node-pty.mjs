#!/usr/bin/env node
/**
 * patch-node-pty.mjs — version-pinned local fix for node-pty 1.1.0:
 *   - the Windows ConPTY baton/handle race during pre-first-output teardown.
 *
 * The script deliberately owns only the Windows native fix. Unix-specific native patches were
 * removed when desktop delivery became Windows-only, so this file cannot silently reintroduce a
 * second platform's native behavior during installation.
 *
 * WINDOWS FAILURE
 *   node-pty deletes its native `pty_baton` as soon as the shell process handle signals. The
 *   baton owns the only HPCON, but has no destructor that closes it. If a caller first terminates
 *   a silent shell tree, the exit thread wins, later `conpty.kill(id)` silently finds no baton,
 *   and the host-parented conhost remains alive until the whole Node process exits. The Windows
 *   patch serializes baton access, closes the exact HPCON before deletion, and makes `kill(id)`
 *   return a boolean proof that it found and closed that exact handle.
 *
 * WHY A SCRIPT AND NOT patch-package: patch-package is not a dependency of this
 * repo and adding one would require an `npm install` against a node_modules
 * tree that is shared with live dev sessions. This script needs no install: it
 * is a guarded, idempotent text patch wired into `postinstall` (and `rebuild`)
 * ahead of electron-rebuild, so the native module is always compiled from
 * patched sources.
 *
 * PROPERTIES
 *   - Idempotent: re-running is a no-op (detected via the patch marker below).
 *   - Verifiable: if any anchor is missing (e.g. after a node-pty upgrade that
 *     reshapes this function) the script exits non-zero and explains what to do
 *     rather than silently producing an unpatched build.
 *
 * REMOVAL CONDITION
 *   Delete this script, its postinstall/rebuild wiring, and
 *   src/main/node-pty-patch.test.ts as soon as we upgrade to a node-pty
 *   release that closes the exact HPCON before baton deletion. The guard test
 *   in src/main/node-pty-patch.test.ts will fail loudly if a node-pty upgrade
 *   silently drops this patch, which is the signal to check whether the fix
 *   landed upstream.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const ptyDir = path.join(repoRoot, 'node_modules', 'node-pty');
const conptyCc = path.join(ptyDir, 'src', 'win', 'conpty.cc');

export const WINDOWS_CONPTY_PATCH_MARKER = 'NODETERM-PATCH(node-pty-conpty-exact-close)';
const EXPECTED_VERSION = '1.1.0';

/** Anchor -> replacement. Every anchor must match exactly once. */
const WINDOWS_EDITS = [
  {
    name: 'ConPTY baton lifetime, exact close, and synchronization',
    find: `#include <sstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>
#include <Windows.h>
#include <strsafe.h>
#include "path_util.h"
#include "conpty.h"

// Taken from the RS5 Windows SDK, but redefined here in case we're targeting <= 17134
#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE \\
  ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)

typedef VOID* HPCON;
typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(COORD c, HANDLE hIn, HANDLE hOut, DWORD dwFlags, HPCON* phpcon);
typedef HRESULT (__stdcall *PFNRESIZEPSEUDOCONSOLE)(HPCON hpc, COORD newSize);
typedef HRESULT (__stdcall *PFNCLEARPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNCLOSEPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNRELEASEPSEUDOCONSOLE)(HPCON hpc);

#endif

struct pty_baton {
  int id;
  HANDLE hIn;
  HANDLE hOut;
  HPCON hpc;

  HANDLE hShell;

  pty_baton(int _id, HANDLE _hIn, HANDLE _hOut, HPCON _hpc) : id(_id), hIn(_hIn), hOut(_hOut), hpc(_hpc) {};
};

static std::vector<std::unique_ptr<pty_baton>> ptyHandles;
static volatile LONG ptyCounter;

static pty_baton* get_pty_baton(int id) {
  auto it = std::find_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  if (it != ptyHandles.end()) {
    return it->get();
  }
  return nullptr;
}

static bool remove_pty_baton(int id) {
  auto it = std::remove_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  if (it != ptyHandles.end()) {
    ptyHandles.erase(it);
    return true;
  }
  return false;
}`,
    replace: `#include <sstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>
#include <mutex>
#include <Windows.h>
#include <strsafe.h>
#include "path_util.h"
#include "conpty.h"

// Taken from the RS5 Windows SDK, but redefined here in case we're targeting <= 17134
#ifndef PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE
#define PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE \\
  ProcThreadAttributeValue(22, FALSE, TRUE, FALSE)

typedef VOID* HPCON;
typedef HRESULT (__stdcall *PFNCREATEPSEUDOCONSOLE)(COORD c, HANDLE hIn, HANDLE hOut, DWORD dwFlags, HPCON* phpcon);
typedef HRESULT (__stdcall *PFNRESIZEPSEUDOCONSOLE)(HPCON hpc, COORD newSize);
typedef HRESULT (__stdcall *PFNCLEARPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNCLOSEPSEUDOCONSOLE)(HPCON hpc);
typedef void (__stdcall *PFNRELEASEPSEUDOCONSOLE)(HPCON hpc);

#endif

struct pty_baton {
  int id;
  HANDLE hIn;
  HANDLE hOut;
  HPCON hpc;
  PFNCLOSEPSEUDOCONSOLE closePseudoConsole;

  HANDLE hShell = nullptr;

  pty_baton(int _id, HANDLE _hIn, HANDLE _hOut, HPCON _hpc, PFNCLOSEPSEUDOCONSOLE _closePseudoConsole) :
      id(_id), hIn(_hIn), hOut(_hOut), hpc(_hpc), closePseudoConsole(_closePseudoConsole) {};

  // ${WINDOWS_CONPTY_PATCH_MARKER}: callers hold g_ptyHandlesMutex. Exchange the handle before
  // ClosePseudoConsole can signal hShell, so the exit callback can never double-close it.
  bool closeExactPseudoConsole() {
    if (hpc == nullptr || closePseudoConsole == nullptr) {
      return false;
    }
    HPCON exact = hpc;
    hpc = nullptr;
    closePseudoConsole(exact);
    return true;
  }
};

static std::vector<std::unique_ptr<pty_baton>> ptyHandles;
static std::mutex g_ptyHandlesMutex;
static volatile LONG ptyCounter;

// The scoped-lock parameter makes the ownership precondition impossible to omit accidentally.
static pty_baton* get_pty_baton(const std::lock_guard<std::mutex>&, int id) {
  auto it = std::find_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  if (it != ptyHandles.end()) {
    return it->get();
  }
  return nullptr;
}

static bool remove_pty_baton(const std::lock_guard<std::mutex>&, int id) {
  auto it = std::remove_if(ptyHandles.begin(), ptyHandles.end(), [id](const auto& ptyHandle) {
    return ptyHandle->id == id;
  });
  if (it != ptyHandles.end()) {
    ptyHandles.erase(it);
    return true;
  }
  return false;
}`
  },
  {
    name: 'close exact HPCON before shell-exit baton deletion',
    find: `    // Wait for process to complete.
    WaitForSingleObject(baton->hShell, INFINITE);
    // Get process exit code.
    GetExitCodeProcess(baton->hShell, (LPDWORD)(&exit_event->exit_code));
    // Clean up handles
    CloseHandle(baton->hShell);
    assert(remove_pty_baton(baton->id));`,
    replace: `    // Wait for process to complete.
    WaitForSingleObject(baton->hShell, INFINITE);
    {
      std::lock_guard<std::mutex> lock(g_ptyHandlesMutex);
      // ${WINDOWS_CONPTY_PATCH_MARKER}: a taskkill-first teardown reaches this thread before JS can
      // call kill(id). Close the exact HPCON while its baton still exists, then delete the baton.
      baton->closeExactPseudoConsole();
      // Get process exit code.
      GetExitCodeProcess(baton->hShell, (LPDWORD)(&exit_event->exit_code));
      // Clean up handles
      CloseHandle(baton->hShell);
      assert(remove_pty_baton(lock, baton->id));
    }`
  },
  {
    name: 'resolve exact close primitive before ConPTY creation',
    find: `  HPCON hpc;
  HRESULT hr = CreateNamedPipesAndPseudoConsole(info, {cols, rows}, inheritCursor ? 1/*PSEUDOCONSOLE_INHERIT_CURSOR*/ : 0, &hIn, &hOut, &hpc, inName, outName, pipeName, useConptyDll);`,
    replace: `  HANDLE closeLibrary = LoadConptyDll(info, useConptyDll);
  PFNCLOSEPSEUDOCONSOLE const closePseudoConsole = closeLibrary == nullptr ? nullptr :
    (PFNCLOSEPSEUDOCONSOLE)GetProcAddress(
      (HMODULE)closeLibrary,
      useConptyDll ? "ConptyClosePseudoConsole" : "ClosePseudoConsole");
  if (closePseudoConsole == nullptr) {
    throw errorWithCode(info, "Cannot resolve exact pseudoconsole close primitive");
  }

  HPCON hpc;
  HRESULT hr = CreateNamedPipesAndPseudoConsole(info, {cols, rows}, inheritCursor ? 1/*PSEUDOCONSOLE_INHERIT_CURSOR*/ : 0, &hIn, &hOut, &hpc, inName, outName, pipeName, useConptyDll);`
  },
  {
    name: 'synchronize new ConPTY baton insertion',
    find: `    ptyHandles.emplace_back(
        std::make_unique<pty_baton>(ptyId, hIn, hOut, hpc));`,
    replace: `    std::lock_guard<std::mutex> lock(g_ptyHandlesMutex);
    ptyHandles.emplace_back(
        std::make_unique<pty_baton>(ptyId, hIn, hOut, hpc, closePseudoConsole));`
  },
  {
    name: 'synchronize ConPTY connect lookup',
    find: `  // Fetch pty handle from ID and start process
  pty_baton* handle = get_pty_baton(id);
  if (!handle) {
    throw Napi::Error::New(env, "Invalid pty handle");
  }`,
    replace: `  // Fetch pty handle from ID and start process. This baton has no exit callback yet,
  // so it remains alive after the lookup lock is released.
  pty_baton* handle;
  {
    std::lock_guard<std::mutex> lock(g_ptyHandlesMutex);
    handle = get_pty_baton(lock, id);
    if (!handle) {
      throw Napi::Error::New(env, "Invalid pty handle");
    }
  }`
  },
  {
    name: 'synchronize ConPTY resize',
    find: `  SHORT rows = static_cast<SHORT>(info[2].As<Napi::Number>().Uint32Value());
  const bool useConptyDll = info[3].As<Napi::Boolean>().Value();

  const pty_baton* handle = get_pty_baton(id);

  if (handle != nullptr) {
    HANDLE hLibrary = LoadConptyDll(info, useConptyDll);`,
    replace: `  SHORT rows = static_cast<SHORT>(info[2].As<Napi::Number>().Uint32Value());
  const bool useConptyDll = info[3].As<Napi::Boolean>().Value();

  std::lock_guard<std::mutex> lock(g_ptyHandlesMutex);
  const pty_baton* handle = get_pty_baton(lock, id);

  if (handle != nullptr && handle->hpc != nullptr) {
    HANDLE hLibrary = LoadConptyDll(info, useConptyDll);`
  },
  {
    name: 'synchronize ConPTY clear',
    find: `  if (!useConptyDll) {
    return env.Undefined();
  }

  const pty_baton* handle = get_pty_baton(id);

  if (handle != nullptr) {
    HANDLE hLibrary = LoadConptyDll(info, useConptyDll);`,
    replace: `  if (!useConptyDll) {
    return env.Undefined();
  }

  std::lock_guard<std::mutex> lock(g_ptyHandlesMutex);
  const pty_baton* handle = get_pty_baton(lock, id);

  if (handle != nullptr && handle->hpc != nullptr) {
    HANDLE hLibrary = LoadConptyDll(info, useConptyDll);`
  },
  {
    name: 'make ConPTY kill exact and positively acknowledged',
    find: `  const pty_baton* handle = get_pty_baton(id);

  if (handle != nullptr) {
    HANDLE hLibrary = LoadConptyDll(info, useConptyDll);
    bool fLoadedDll = hLibrary != nullptr;
    if (fLoadedDll)
    {
      PFNCLOSEPSEUDOCONSOLE const pfnClosePseudoConsole = (PFNCLOSEPSEUDOCONSOLE)GetProcAddress(
        (HMODULE)hLibrary,
        useConptyDll ? "ConptyClosePseudoConsole" : "ClosePseudoConsole");
      if (pfnClosePseudoConsole)
      {
        pfnClosePseudoConsole(handle->hpc);
      }
    }
    if (useConptyDll) {
      TerminateProcess(handle->hShell, 1);
    }
  }

  return env.Undefined();`,
    replace: `  bool closed = false;
  {
    std::lock_guard<std::mutex> lock(g_ptyHandlesMutex);
    pty_baton* handle = get_pty_baton(lock, id);

    if (handle != nullptr) {
      // ${WINDOWS_CONPTY_PATCH_MARKER}: unlike stock 1.1.0's void result, true is positive proof
      // that this exact baton existed and its one HPCON was synchronously closed.
      closed = handle->closeExactPseudoConsole();
      if (useConptyDll && handle->hShell != nullptr) {
        TerminateProcess(handle->hShell, 1);
      }
    }
  }

  return Napi::Boolean::New(env, closed);`
  }
];

function fail(msg) {
  console.error(`\n[patch-node-pty] ERROR: ${msg}\n`);
  console.error(`  Patch script : scripts/patch-node-pty.mjs`);
  console.error(`  Windows bug  : node-pty 1.1.0 ConPTY baton deletion before HPCON close`);
  console.error(
    `  If node-pty was upgraded: check whether the exact-HPCON-close fix landed upstream. If it\n` +
      `  did, delete this script, its postinstall/rebuild wiring and src/main/node-pty-patch.test.ts.\n` +
      `  If it did not, re-derive the exact anchors against the new native sources.\n`
  );
  process.exit(1);
}

function patchOne(file, marker, edits) {
  if (!fs.existsSync(file)) {
    fail(`required node-pty source is missing:\n  ${file}`);
  }
  const original = fs.readFileSync(file, 'utf8');
  if (original.includes(marker)) {
    return false;
  }

  let patched = original;
  for (const edit of edits) {
    const occurrences = patched.split(edit.find).length - 1;
    if (occurrences !== 1) {
      fail(
        `anchor "${edit.name}" matched ${occurrences} times (expected exactly 1) in\n  ${file}`
      );
    }
    patched = patched.replace(edit.find, edit.replace);
  }
  fs.writeFileSync(file, patched, 'utf8');
  return true;
}

function main() {
  if (!fs.existsSync(ptyDir)) {
    // node-pty is optional in some install shapes (e.g. docs-only CI installs).
    console.log('[patch-node-pty] node-pty sources not present, nothing to patch.');
    return;
  }

  let installedVersion = 'unknown';
  try {
    installedVersion = JSON.parse(
      fs.readFileSync(path.join(ptyDir, 'package.json'), 'utf8')
    ).version;
  } catch {
    /* fall through — the anchor check below is the real guard */
  }

  if (installedVersion !== EXPECTED_VERSION) {
    fail(
      `expected node-pty ${EXPECTED_VERSION}, found ${installedVersion}; refusing to apply ` +
        `private native lifecycle patches to an unreviewed version`
    );
  }

  // The Windows source ships in every install and only compiles for the win32 native target;
  // patching it unconditionally keeps packaged rebuilds honest on every host.
  const windowsChanged = patchOne(
    conptyCc,
    WINDOWS_CONPTY_PATCH_MARKER,
    WINDOWS_EDITS
  );
  if (!windowsChanged) {
    console.log(`[patch-node-pty] already applied (node-pty ${installedVersion}), skipping.`);
  } else {
    console.log(
      `[patch-node-pty] applied node-pty ${installedVersion} native patch: Windows exact ConPTY close`
    );
  }
}

// Only patch when executed directly (`node scripts/patch-node-pty.mjs`), never as
// a side effect of importing this module.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
