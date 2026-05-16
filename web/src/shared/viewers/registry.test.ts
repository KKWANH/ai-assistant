import { describe, expect, it } from "vitest";
import { isViewerId, resolveViewerId, VIEWER_REGISTRY } from "./registry";

describe("viewer registry", () => {
  it("resolves only allowlisted viewer ids", () => {
    expect(isViewerId("tableViewer")).toBe(true);
    expect(resolveViewerId("tableViewer")).toBe("tableViewer");
    expect(isViewerId("../workspace/plugin.ts")).toBe(false);
    expect(resolveViewerId("../workspace/plugin.ts")).toBe("textViewer");
    expect(resolveViewerId("javascript:alert(1)")).toBe("textViewer");
  });

  it("does not expose arbitrary plugin code hooks", () => {
    expect(Object.keys(VIEWER_REGISTRY)).not.toContain("remote");
    expect(Object.keys(VIEWER_REGISTRY)).not.toContain("plugin");
    expect(Object.values(VIEWER_REGISTRY).every((viewer) => typeof viewer.render === "function")).toBe(true);
    expect(Object.values(VIEWER_REGISTRY).every((viewer) => typeof viewer.validateArtifact === "function")).toBe(true);
  });
});
