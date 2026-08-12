import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountIdentityPills } from "./AccountIdentityPills";

describe("AccountIdentityPills", () => {
  it("renders identity and provenance from the same presentation object", () => {
    const html = renderToStaticMarkup(
      <AccountIdentityPills
        account={{
          identity: "Work",
          provenance: "SSH · Ubuntu WSL",
          tooltip: "Work (me@example.com) · SSH corvin@devbox",
        }}
        selected
      />,
    );
    expect(html).toContain("Work");
    expect(html).toContain("SSH · Ubuntu WSL");
    expect(html).toContain("Selected");
    expect(html).not.toContain("system");
    expect(html).not.toContain("managed");
  });
});
