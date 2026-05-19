import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../ui/theme/tokens.css";
import "../ui/theme/reset.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
