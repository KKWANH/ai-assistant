import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextReceiptCard } from "./ContextReceiptCard.jsx";

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
});
