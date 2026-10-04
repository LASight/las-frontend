import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Opt-in local QA proxy, never changes backend CORS or authentication. No token
// handling here. Use VITE_API_BASE_URL='' for browser requests to same-origin /api.
const target = process.env.WELLSIGHT_DEV_API_PROXY;
const proxy = target ? { "/api": { target, changeOrigin: true } } : undefined;

export default defineConfig({
  plugins: [react()],
  // Allows a safe-path alias when the checkout path contains a literal "%",
  // which Vitest 2's Vite resolver otherwise treats as a malformed URI.
  resolve: { preserveSymlinks: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy,
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
  test: {
    environment: "jsdom",
  },
});
