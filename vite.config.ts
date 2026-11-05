import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/api": "http://localhost:8787",
    },
  },
  test: { root: ".", include: ["tests/**/*.test.ts"], environment: "node" },
});
