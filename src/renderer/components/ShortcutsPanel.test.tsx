// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/types";
import { SHORTCUT_DEFS } from "@shared/shortcuts";
import { shortcutKeyParts } from "@shared/shortcut";
import { useSettings } from "../state/settings";
import { usePersonalVocabulary } from "../state/personalVocabulary";
import { useSchoolMode } from "../state/schoolMode";
import { setKeybindingOverride } from "../lib/keybindingOverrides";
import {
  buildSections,
  mapShortcutSections,
  ShortcutsPanel,
} from "./ShortcutsPanel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Same platform reader the component uses, so badge expectations track the test host's navigator
// (jsdom is never a Mac here, which the mac-glyph absence test below relies on and asserts).
import { isMacPlatform } from "@shared/platform-utils";
const isMac = isMacPlatform();

/** ShortcutsPanel portals into document.body; read the rendered rows there. */
function renderedText(): string {
  return document.body.textContent ?? "";
}

describe("ShortcutsPanel", () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    useSettings.setState({ settings: DEFAULT_SETTINGS, hydrated: true });
    usePersonalVocabulary.setState({
      entries: {},
      status: "no-file",
      entryCount: 0,
      loadedAt: null,
      lastError: null,
    });
    useSchoolMode.setState({ enabled: false, hydrated: true });
    root = createRoot(host);
    await act(async () => {
      root.render(<ShortcutsPanel onClose={() => {}} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
    usePersonalVocabulary.setState({
      entries: {},
      status: "no-file",
      entryCount: 0,
      loadedAt: null,
      lastError: null,
    });
    useSchoolMode.setState({ enabled: false, hydrated: false });
  });

  it("renders a row for every configurable shortcut from the registry, grouped", () => {
    const text = renderedText();
    for (const d of SHORTCUT_DEFS) {
      expect(text, `row for ${d.label}`).toContain(d.label);
    }
    for (const title of ["General", "Canvas", "Terminal", "Source Control"]) {
      expect(text, `group ${title}`).toContain(title);
    }
  });

  it("shows the current combo from settings.shortcuts, so a rebind reflects immediately", async () => {
    // The kbd badges render each part as its own element (keyLabel), so the textContent is the
    // parts concatenated — e.g. Ctrl + K for the palette on a non-mac test host.
    const badgeFor = (combo: string): string =>
      shortcutKeyParts(combo, isMac).join("");
    const defaultBadge = badgeFor(DEFAULT_SETTINGS.shortcuts.commandPalette);
    expect(renderedText()).toContain(defaultBadge);

    // Rebinding the palette shortcut re-renders the panel's badge on the next frame — no
    // reload, no re-open needed.
    await act(async () => {
      setKeybindingOverride("app.commandPalette", ["Cmd+Shift+P"]);
    });
    expect(renderedText()).toContain(badgeFor("Cmd+Shift+P"));
    expect(renderedText()).not.toContain(defaultBadge);
  });

  it("leads the General group with the dictation row from settings.speech.shortcut", () => {
    const text = renderedText();
    expect(text).toContain("Dictate");
    expect(text).toContain(
      shortcutKeyParts(DEFAULT_SETTINGS.speech.shortcut, isMac).join(""),
    );
  });

  it("documents the fixed mouse-gesture reference rows under their groups", () => {
    const text = renderedText();
    expect(text).toContain("Right-click");
    expect(text).toContain("Box-select");
    expect(text).toContain("Pan the canvas");
    expect(text).toContain("Zoom in / out");
    expect(text).toContain("Actions menu (empty space or node)");
  });

  it("renders every badge in canonical Ctrl/Shift notation on a non-mac host — no mac glyphs", () => {
    // Guard the premise so the absence assertions below cannot green-wash on a mis-detected
    // platform: jsdom's navigator is not a Mac, so nothing in this panel may emit ⌘/⇧/⌥.
    // Failure prevented: reintroducing a mac-glyph token in GESTURE_ROWS (or a display path that
    // stops rewriting through shortcutKeyParts) would show mac notation in the Windows UI.
    expect(isMac).toBe(false);
    const text = renderedText();
    expect(text).toContain("Ctrl");
    expect(text).toContain("Shift");
    expect(text).not.toContain("⌘");
    expect(text).not.toContain("⇧");
    expect(text).not.toContain("⌥");
  });

  it("maps section and row labels while preserving shortcut keys and accessible names", async () => {
    const source = buildSections(DEFAULT_SETTINGS.speech.shortcut);
    const mapped = mapShortcutSections(
      source,
      (text) =>
        (typeof text === "string"
          ? text
              .replaceAll("General", "Basics")
              .replaceAll("Command palette", "Action finder")
          : text) as typeof text,
    );
    expect(
      mapped.find((section) => section.title === "Basics")?.rows[0].label,
    ).toBe("Action finder");
    expect(mapped[0].rows[0].keys).toEqual(source[0].rows[0].keys);

    await act(async () => {
      usePersonalVocabulary.setState({
        status: "loaded",
        entries: {
          "Keyboard shortcuts": "Hotkeys",
          General: "Basics",
          "Command palette": "Action finder",
        },
        entryCount: 3,
        loadedAt: Date.now(),
        lastError: null,
      });
    });
    const heading = document.querySelector(".shortcuts__head h2");
    expect(heading?.textContent).toBe("Hotkeys");
    expect(heading?.getAttribute("aria-label") ?? heading?.textContent).toBe(
      "Hotkeys",
    );
    expect(renderedText()).toContain("Basics");
    expect(renderedText()).toContain("Action finder");
    expect(renderedText()).toContain("Ctrl");
  });
});
