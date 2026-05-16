import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConnectionsTab } from "./ConnectionsTab.jsx";

describe("ConnectionsTab", () => {
  it("requests explicit project resource links", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ connections: { connectedResources: [] } });
    render(
      <ConnectionsTab
        activePath={{ projectPath: "diet" }}
        fetchJson={fetchJson}
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
    expect(fetchJson).toHaveBeenCalledWith("/api/project-connections/diet", expect.objectContaining({ method: "POST" }));
  });

  it("shows connected resources only from approved links", () => {
    render(
      <ConnectionsTab
        activePath={{ projectPath: "diet" }}
        fetchJson={vi.fn()}
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
