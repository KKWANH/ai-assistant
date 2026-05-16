import { describe, expect, it } from "vitest";
import { isWorkflowAppDefinition, parseProjectConnections, parseWorkflowApps } from "./guards";

const validWorkflowApp = {
  id: "investment_rebalancer",
  title: "Investment Rebalancer",
  description: "Portfolio app",
  category: "finance",
  inputSchema: [],
  outputSchema: [{ id: "report", path: "artifacts/report.md", type: "report", viewer_id: "reportViewer" }],
  runPolicy: { mode: "approval_required", requiresConfirmation: true, network: "approval_required", fileWrite: "artifacts_only", cloud: "blocked" },
  defaultViewerLayout: [{ id: "report", title: "Report", viewer_id: "reportViewer", position: "center" }],
  supportedResources: ["portfolio"],
  permissions: { network: "approval_required" },
};

describe("contract guards", () => {
  it("accepts valid workflow apps and rejects unknown viewers", () => {
    expect(isWorkflowAppDefinition(validWorkflowApp)).toBe(true);
    expect(parseWorkflowApps([validWorkflowApp])).toHaveLength(1);
    expect(parseWorkflowApps([{ ...validWorkflowApp, outputSchema: [{ ...validWorkflowApp.outputSchema[0], viewer_id: "workspacePlugin" }] }])).toHaveLength(0);
  });

  it("normalizes project connection payloads from untrusted JSON", () => {
    const parsed = parseProjectConnections({
      projectId: "diet",
      exports: [{ resourceType: "meal_log", artifactPattern: "artifacts/meal.json" }, { bad: true }],
      incomingLinks: [{ linkId: "l1", fromProject: "food", toProject: "diet", allowedResourceTypes: ["nutrition_snapshot"] }],
      connectedResources: [{ resourceType: "nutrition_snapshot", artifactPattern: "artifacts/nutrition.json", sourceProjectId: "food" }],
      visibleSources: [{ projectId: "food", title: "Food", exports: [{ resourceType: "nutrition_snapshot", artifactPattern: "artifacts/nutrition.json" }] }],
    });
    expect(parsed.exports).toHaveLength(1);
    expect(parsed.incomingLinks[0].allowedResourceTypes).toEqual(["nutrition_snapshot"]);
    expect(parsed.connectedResources[0].sourceProjectId).toBe("food");
    expect(parsed.visibleSources[0].exports[0].resourceType).toBe("nutrition_snapshot");
  });
});
