import { describe, expect, it } from "vitest";
import { paneCommandMatchesAgent, paneCommandName } from "./nativeLoopDelivery";

describe("native Loop pane command matching", () => {
  it("matches a Windows executable name to the configured portable Codex command", () => {
    expect(paneCommandMatchesAgent("codex.exe", "codex")).toBe(true);
    expect(paneCommandMatchesAgent("C:\\Tools\\codex.exe", "codex")).toBe(true);
  });

  it("keeps a different process and an unknown observation refused", () => {
    expect(paneCommandMatchesAgent("pwsh.exe", "codex")).toBe(false);
    expect(paneCommandMatchesAgent(null, "codex")).toBe(false);
    expect(paneCommandName(" /usr/local/bin/codex ")).toBe("codex");
  });
});
