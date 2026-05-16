import { describe, expect, it } from "vitest";
import { isViewerId, resolveViewerId, resolveViewerPlugin, VIEWER_REGISTRY } from "./registry";
import { validateChartArtifact } from "./chartViewer";

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

  it("selects the table plugin for quoted multiline CSV artifacts", () => {
    const artifact = { path: "positions.csv", type: "csv", mime: "text/csv", content: 'name,note,value\n"VOO","quoted, comma",10\n"BND","multi\nline",5' };
    const plugin = resolveViewerPlugin("tableViewer", artifact);
    expect(plugin.id).toBe("tableViewer");
    expect(plugin.validateArtifact(artifact)).toBe(true);
  });

  it("accepts vega-lite style chart specs", () => {
    const artifact = {
      path: "chart.json",
      type: "chart",
      content: JSON.stringify({
        mark: "bar",
        data: [{ month: "Jan", total: 100 }, { month: "Feb", total: 120 }],
        encoding: { x: { field: "month" }, y: { field: "total" } },
      }),
    };
    expect(validateChartArtifact(artifact)).toBe(true);
  });
});
