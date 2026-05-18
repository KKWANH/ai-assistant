import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextReceiptCard } from "./ContextReceiptCard";

describe("ContextReceiptCard", () => {
  it("summarizes model, files, cost, and CSV parser facts", () => {
    render(
      <ContextReceiptCard
        receipt={{
          provider: "ollama",
          model: "qwen3:8b",
          privacy_mode: "local",
          estimated_cost: 0,
          used_files: [{ filename: "portfolio.csv" }],
          input_tokens: 120,
          output_tokens: 40,
          analysis: {
            computed_profile_sent_to_model: true,
            raw_text_sent_to_model: false,
            csv: [{ parser: "pandas", rows: 10, columns: 4, missing_cells: 0 }],
          },
        }}
      />,
    );
    expect(screen.getByText(/Context receipt · local · 1 file/)).toBeInTheDocument();
    expect(screen.getByText(/qwen3:8b/)).toBeInTheDocument();
    expect(screen.getByText(/CSV parser: pandas/)).toBeInTheDocument();
  });

  it("shows retrieval scores and matched terms", () => {
    render(
      <ContextReceiptCard
        receipt={{
          provider: "ollama",
          model: "qwen3:8b",
          privacy_mode: "local",
          estimated_cost: 0,
          included_chunks: [
            {
              filename: "camera.md",
              token_count: 24,
              privacy: "kept_local",
              rerank_score: 1.25,
              matched_terms: ["canon", "battery"],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText(/score 1.25/)).toBeInTheDocument();
    expect(screen.getByText(/canon, battery/)).toBeInTheDocument();
  });

  it("opens source drawer and pins sources for comparison", () => {
    render(
      <ContextReceiptCard
        receipt={{
          provider: "ollama",
          model: "qwen3:8b",
          privacy_mode: "local",
          estimated_cost: 0,
          included_chunks: [
            {
              source_id: "R1",
              filename: "camera.md",
              path: "files/camera.md",
              token_count: 24,
              privacy: "kept_local",
              text_preview: "battery door notes",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /\[R1\]/ }));
    expect(screen.getByRole("complementary", { name: /Source preview/ })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Pin" })[0]);
    expect(screen.getByText("Pinned sources")).toBeInTheDocument();
    expect(screen.getAllByText(/battery door notes/).length).toBeGreaterThan(1);
  });
});
