// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePersonalVocabulary } from "../state/personalVocabulary";
import { useSchoolMode } from "../state/schoolMode";
import type { LogRecord } from "@shared/types";
import { LogPanel } from "./LogPanel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("LogPanel personal vocabulary boundary", () => {
  let root: Root;
  let host: HTMLDivElement;
  const record: LogRecord = {
    seq: 7,
    ts: Date.UTC(2026, 0, 2, 3, 4, 5),
    level: "info",
    tag: "terminal",
    msg: "terminal output C:/workspace/terminal",
  };

  beforeEach(async () => {
    usePersonalVocabulary.setState({
      entries: {},
      status: "no-file",
      entryCount: 0,
      loadedAt: null,
      lastError: null,
    });
    useSchoolMode.setState({ enabled: false, hydrated: true });
    (window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
      logs: {
        snapshot: vi.fn(async () => [record]),
        onBatch: vi.fn(() => () => {}),
        clear: vi.fn(),
      },
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<LogPanel onClose={() => {}} />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.replaceChildren();
    usePersonalVocabulary.setState({
      entries: {},
      status: "no-file",
      entryCount: 0,
      loadedAt: null,
      lastError: null,
    });
    useSchoolMode.setState({ enabled: false, hydrated: false });
  });

  it("keeps original authored copy and exact log facts without a file", () => {
    expect(document.querySelector(".logpanel__head h2")?.textContent).toBe(
      "Debug log",
    );
    expect(document.querySelector(".logpanel__level")?.textContent).toBe(
      "info",
    );
    expect(document.querySelector(".logpanel__tag")?.textContent).toBe(
      "[terminal]",
    );
    expect(document.querySelector(".logpanel__msg")?.textContent).toBe(
      record.msg,
    );
    expect(
      document.querySelector('input[aria-label="Filter log lines"]'),
    ).not.toBeNull();
  });

  it("maps authored chrome and accessible search names while preserving log records", async () => {
    await act(async () => {
      usePersonalVocabulary.setState({
        status: "loaded",
        entries: {
          "Debug log": "Diagnostics",
          "Filter log lines": "Find diagnostics",
        },
        entryCount: 2,
        loadedAt: Date.now(),
        lastError: null,
      });
    });
    expect(document.querySelector(".logpanel__head h2")?.textContent).toBe(
      "Diagnostics",
    );
    const filter = document.querySelector<HTMLInputElement>("input");
    expect(filter?.getAttribute("aria-label")).toBe("Find diagnostics");
    expect(filter?.getAttribute("placeholder")).toBe("Filter…");
    expect(document.querySelector(".logpanel__level")?.textContent).toBe(
      "info",
    );
    expect(document.querySelector(".logpanel__tag")?.textContent).toBe(
      "[terminal]",
    );
    expect(document.querySelector(".logpanel__msg")?.textContent).toBe(
      record.msg,
    );
  });
});
