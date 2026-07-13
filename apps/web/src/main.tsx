import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ToastProvider } from "./components/ui/Toast";
import { applyTheme } from "./lib/theme";
import { applyWallpaper } from "./lib/wallpaper";
import { loadTheme, loadWallpaper } from "./lib/store";
import { initGlassPointer } from "./lib/glass";
import "./styles/globals.css";

// Apply the persisted theme + wallpaper on boot so CSS vars are set before
// first paint (both default to dark / midnight on a fresh install).
const bootTheme = loadTheme();
applyTheme(bootTheme);
applyWallpaper(loadWallpaper(), bootTheme);
// Cursor-tracked specular for glass controls (top bar, composer).
initGlassPointer();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
