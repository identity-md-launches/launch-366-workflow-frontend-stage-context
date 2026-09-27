import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { imdDeployment } from "./plugins/imd-deployment";

// Static export for content-addressed hosting: relative base, one page, no server rewrites.
export default defineConfig({
  base: "./",
  plugins: [react(), imdDeployment()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    modulePreload: { polyfill: false },
    // viem is the bulk of the single bundle; still far below the export budget.
    chunkSizeWarningLimit: 700,
  },
  server: { port: 5173 },
});
