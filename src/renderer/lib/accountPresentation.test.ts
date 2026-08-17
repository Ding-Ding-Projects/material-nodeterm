import { describe, expect, it } from "vitest";
import { presentAccount } from "./accountPresentation";

describe("presentAccount", () => {
  it("uses a chosen name before the email and identifies a local login", () => {
    expect(presentAccount({ label: "Work", email: "me@example.com" })).toEqual({
      identity: "Work",
      provenance: "Local",
      tooltip: "Work (me@example.com) · This Mac",
    });
  });

  it("falls back to email and never exposes system or managed storage terminology", () => {
    expect(
      presentAccount({
        label: "System Codex account",
        email: "me@example.com",
      }),
    ).toEqual({
      identity: "me@example.com",
      provenance: "Local",
      tooltip: "me@example.com · This Mac",
    });
    expect(presentAccount({ label: "New Codex account" }).identity).toBe(
      "Default account",
    );
  });

  it("uses one SSH provenance format with the friendly machine name", () => {
    expect(
      presentAccount({
        email: "remote@example.com",
        host: "corvin@devbox",
        machineLabel: "Ubuntu WSL",
      }),
    ).toEqual({
      identity: "remote@example.com",
      provenance: "SSH · Ubuntu WSL",
      tooltip: "remote@example.com · SSH corvin@devbox",
    });
  });
});
