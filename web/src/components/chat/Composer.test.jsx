import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";

describe("Composer", () => {
  it("opens the tool picker and exposes table input", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <Composer activePath={{ projectPath: "demo", sessionSlug: "chat" }} onAsk={vi.fn()} account={{ profile: { language: "en" } }} power={false} />
      </QueryClientProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: /open input tools/i }));
    expect(screen.getByText("Add photos or files")).toBeInTheDocument();
    expect(screen.getByText("Add table")).toBeInTheDocument();
  });
});
