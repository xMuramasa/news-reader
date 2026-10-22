import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    // Every asset (fonts included) stays a hashed file: the CSP allows no data: fonts and no inline code.
    assetsInlineLimit: 0,
    sourcemap: false,
    target: "es2022",
    // One ~540 kB chunk (168 kB gzip): React, React Router, TanStack Query and Radix. Fine for a single-user reader.
    chunkSizeWarningLimit: 600,
  },
  server: {
    // `bun run dev` against a local API: VITE_API_PROXY=http://127.0.0.1:8080
    proxy: process.env.VITE_API_PROXY ? { "/api": process.env.VITE_API_PROXY } : {},
  },
});
