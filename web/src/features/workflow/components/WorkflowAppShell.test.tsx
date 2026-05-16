import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewerPane } from "./ViewerPane";
import { WorkflowAppShell } from "./WorkflowAppShell";
import type { WorkflowAppDefinition } from "../../../entities/workflow-app/types";

const app: WorkflowAppDefinition = {
  id: "investment_rebalancer",
  title: "Investment Rebalancer",
  description: "Portfolio CSV to rebalance outputs.",
  category: "finance",
  inputSchema: [{ id: "portfolio", label: "Portfolio CSV", type: "file", required: true, accept: [".csv"] }],
  outputSchema: [{ id: "report", path: "artifacts/rebalance-report.md", type: "report", viewer_id: "reportViewer" }],
  runPolicy: { mode: "approval_required", requiresConfirmation: true, network: "approval_required", fileWrite: "artifacts_only", cloud: "blocked" },
  defaultViewerLayout: [{ id: "report", title: "Report", viewer_id: "reportViewer", position: "center" }],
  supportedResources: ["portfolio"],
  permissions: { network: "approval_required" },
};

describe("WorkflowAppShell", () => {
  it("renders launcher, viewer slots, and chat dock", async () => {
    const onRun = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkflowAppShell app={app} projectPath="investing" onRun={onRun} />
      </QueryClientProvider>
    );
    expect(screen.getByText("Investment Rebalancer")).toBeInTheDocument();
    expect(screen.getByText("reportViewer")).toBeInTheDocument();
    expect(screen.getByText("Chat Dock")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /run app/i }));
    expect(onRun).toHaveBeenCalledOnce();
  });
});

describe("ViewerPane", () => {
  it("falls back to safe text viewer for unknown viewer ids", () => {
    render(<ViewerPane artifact={{ viewer_id: "workspacePlugin", type: "markdown", content: "# Safe fallback" }} />);
    expect(screen.getByText("Safe fallback")).toBeInTheDocument();
  });
});
