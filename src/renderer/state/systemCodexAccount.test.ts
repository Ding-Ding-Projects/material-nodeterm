import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSystemCodexAccount } from "./systemCodexAccount";

describe("useSystemCodexAccount remote identity cache", () => {
  const systemIdentity = vi.fn();

  beforeEach(() => {
    systemIdentity.mockReset();
    vi.stubGlobal("window", {
      nodeTerminal: { codexAccounts: { systemIdentity } },
    });
    useSystemCodexAccount.setState({
      email: null,
      loaded: false,
      remoteEmails: {},
      remoteLoading: {},
    });
  });

  it("loads one identity per SSH host and shares it with every renderer consumer", async () => {
    systemIdentity.mockResolvedValue({ email: "remote@example.com" });
    useSystemCodexAccount.getState().ensureRemote("corvin@devbox", "project-1");
    useSystemCodexAccount.getState().ensureRemote("corvin@devbox", "project-1");

    await vi.waitFor(() => {
      expect(
        useSystemCodexAccount.getState().remoteEmails["corvin@devbox"],
      ).toBe("remote@example.com");
    });
    expect(systemIdentity).toHaveBeenCalledTimes(1);
    expect(systemIdentity).toHaveBeenCalledWith({ projectId: "project-1" });
  });
});
