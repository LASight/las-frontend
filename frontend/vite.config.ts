import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Allows a safe-path alias when the checkout path contains a literal "%",
  // which Vitest 2's Vite resolver otherwise treats as a malformed URI.
  resolve: { preserveSymlinks: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  test: {
    environment: "jsdom",
  },
});
