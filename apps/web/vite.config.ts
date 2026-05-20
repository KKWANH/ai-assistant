import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@ariadne/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url)
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split stable third-party deps into their own long-cacheable chunks.
        // CodeMirror is only pulled in by the lazy editor chunks, so it stays
        // out of the initial bundle; react-markdown rides with the chat chunk.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-codemirror": [
            "codemirror",
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/commands",
            "@codemirror/lang-javascript",
            "@codemirror/theme-one-dark",
          ],
          "vendor-markdown": ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4319",
        changeOrigin: true,
      },
      "/healthz": {
        target: "http://localhost:4319",
        changeOrigin: true,
      },
      // Custom project surface host + bundle (served outside /api).
      "/surface": {
        target: "http://localhost:4319",
        changeOrigin: true,
      },
    },
  },
});
