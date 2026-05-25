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
        // Function form: needed so we can pin react/jsx-runtime (+ scheduler)
        // into vendor-react. Otherwise Rollup tucks jsx-runtime into
        // vendor-markdown (its biggest static consumer), which forces every
        // JSX-using chunk to statically depend on the 168 kB markdown bundle —
        // defeating the React.lazy(MarkdownContent) split.
        //
        // CodeMirror language packs (lang-python/cpp/rust/go) deliberately
        // stay OUT of the vendor-codemirror chunk so they ride with the
        // lazy WorkspaceFileEditor route instead of bloating the shared
        // editor vendor chunk.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          if (
            id.includes("/codemirror/") ||
            id.includes("/@codemirror/state/") ||
            id.includes("/@codemirror/view/") ||
            id.includes("/@codemirror/commands/") ||
            id.includes("/@codemirror/lang-javascript/") ||
            id.includes("/@codemirror/language/") ||
            id.includes("/@lezer/highlight/")
          ) {
            return "vendor-codemirror";
          }
          if (
            id.includes("/react-markdown/") ||
            id.includes("/remark-") ||
            id.includes("/micromark") ||
            id.includes("/mdast-") ||
            id.includes("/unist-") ||
            id.includes("/hast-") ||
            id.includes("/unified/") ||
            id.includes("/bail/") ||
            id.includes("/trough/") ||
            id.includes("/vfile") ||
            id.includes("/decode-named-character-reference") ||
            id.includes("/character-entities") ||
            id.includes("/property-information") ||
            id.includes("/space-separated-tokens") ||
            id.includes("/comma-separated-tokens") ||
            id.includes("/zwitch") ||
            id.includes("/html-url-attributes") ||
            id.includes("/devlop")
          ) {
            return "vendor-markdown";
          }
          return undefined;
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
