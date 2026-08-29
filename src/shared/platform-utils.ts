/**
 * Platform detection + display helpers for keyboard-shortcut labels.
 *
 * Canonical shortcut notation is Windows-native (`Ctrl+Shift+Z`, `Alt`) at every definition
 * site. The previous scheme — mac-glyph canonical strings (`⌘⇧Z`) rewritten per platform at
 * render time — was DELETED with macOS desktop support, not inverted: there is no Ctrl→⌘
 * rewriter, and one must not be added. The only mac surface left is a Server Edition browser
 * tab running on a real Mac, and that surface gets display truth solely through the
 * registry-driven `shortcutKeyParts`/`formatShortcut` (`shared/shortcut.ts`) path, which takes
 * `isMacPlatform()` explicitly.
 */

/**
 * True on macOS. SURVIVOR, deliberately: the desktop app is Windows-only, but the Server
 * Edition serves this same renderer to a browser tab that can run on a real Mac, where the
 * primary modifier is physically ⌘ (`matchesShortcut` keys off `metaKey` there) — so
 * registry-driven badge rendering still needs the true client OS. Navigator-based (not
 * process.platform) for exactly that reason. Outside a DOM (main process, node-env tests)
 * there is no Mac browser client, so the answer is `false`; the old `true` fallback dated from
 * the mac-canonical era and silently rendered mac notation in every non-DOM context.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac/i.test(navigator.platform || navigator.userAgent)
}

/** True on Windows (Electron renderer or browser — same `navigator`-based detection as
 *  `isMacPlatform`, so it is correct in both the desktop app and a Server Edition browser tab). */
export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Win/i.test(navigator.platform || navigator.userAgent)
}

/**
 * Normalize leftover mac chord glyphs in a hint string to canonical Ctrl/Shift notation.
 * Unconditional — the per-platform branch is gone: canonical notation is Windows-native
 * everywhere now, so a definition site that still says `⌘⇧E` is an unmigrated straggler, not a
 * platform variant. Rendering such a string untouched would show mac glyphs in the Windows UI —
 * the failure this normalizer remains to prevent while call sites migrate. Once no caller
 * passes a ⌘/⇧ string this is an identity function and can be dropped along with its callers.
 */
export function hintLabel(text: string): string {
  return text
    .replace(/⌘⇧/g, 'Ctrl+Shift+')
    .replace(/⌘(?=[A-Za-z0-9,/↵])/g, 'Ctrl+')
    .replace(/⌘/g, 'Ctrl')
    .replace(/⇧/g, 'Shift+')
}

/**
 * Map a single key badge token to canonical notation (`⌘`→`Ctrl`, `⇧`→`Shift`, all else
 * passes through). The second parameter is DEAD: it was the mac display branch (`⌘` passed
 * through when true), kept in the signature only so two-argument call sites that other rewire
 * lanes still own (ContextMenu, onboarding) compile until they migrate their token arrays.
 * It must not grow a reader — honoring it again resurrects mac notation on those surfaces.
 * Note: registry-driven badges (`shortcutKeyParts`) must NOT be routed through this function;
 * they already emit the platform-true token, and normalizing would smash the ⌘ badge a Server
 * Edition tab on a real Mac genuinely matches.
 */
export function keyLabel(key: string, _legacyIsMac?: boolean): string {
  if (key === '⌘') return 'Ctrl'
  if (key === '⇧') return 'Shift'
  return key
}
