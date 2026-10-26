/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// Tauri expects a fixed dev port and serves the built files from dist/.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/crates/**"] },
  },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
  test: { environment: "node", include: ["src/**/*.test.ts", "tests/**/*.test.js"] },
});
