import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/new-ui/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/attachment": "http://127.0.0.1:8765",
      "/project-viewers": "http://127.0.0.1:8765"
    }
  },
  preview: {
    host: "127.0.0.1"
  }
});
