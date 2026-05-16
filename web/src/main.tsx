import React from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "./app/providers";
import { AppRouter } from "./app/router";

const root = document.getElementById("root");

if (!root) {
  throw new Error("AIWS root element was not found.");
}

createRoot(root).render(
  <React.StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </React.StrictMode>
);
