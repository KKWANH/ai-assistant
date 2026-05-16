import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionsTab } from "./ConnectionsTab";

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ConnectionsTab", () => {
  it("requests explicit project resource links", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ connections: { projectId: "diet", exports: [], imports: [], incomingLinks: [], outgoingLinks: [], connectedResources: [], visibleSources: [] } }),
    } as Response);
    renderWithQuery(
      <ConnectionsTab
        activePath={{ projectPath: "diet" }}
        connections={{
          projectId: "diet",
          exports: [],
          imports: [],
          incomingLinks: [],
          outgoingLinks: [],
          connectedResources: [],
          visibleSources: [{ projectId: "food", title: "Food", exports: [{ resourceType: "nutrition_snapshot", artifactPattern: "artifacts/nutrition.json", schemaVersion: "1" }] }],
        }}
      />,
    );
    await userEvent.click(screen.getByLabelText(/nutrition_snapshot/i));
    await userEvent.click(screen.getByRole("button", { name: /request connection/i }));
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/project-connections/diet", expect.objectContaining({ method: "POST" }));
    vi.restoreAllMocks();
  });

  it("shows connected resources only from approved links", () => {
    renderWithQuery(
      <ConnectionsTab
        activePath={{ projectPath: "diet" }}
        connections={{
          projectId: "diet",
          exports: [],
          imports: [],
          incomingLinks: [],
          outgoingLinks: [],
          connectedResources: [{ sourceProjectId: "food", resourceType: "nutrition_snapshot", artifactPattern: "artifacts/nutrition.json", schemaVersion: "1", mode: "read" }],
          visibleSources: [],
        }}
      />,
    );
    expect(screen.getByText(/nutrition_snapshot/)).toBeInTheDocument();
    expect(screen.getByText(/food · read/)).toBeInTheDocument();
  });
});
