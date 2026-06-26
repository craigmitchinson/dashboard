import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No backend. Single-page app that renders one fixed-dimension slide.
export default defineConfig({
  plugins: [react()],
  // Inline nothing as base64 so font files stay as deterministic, cacheable assets.
  build: {
    assetsInlineLimit: 0,
  },
});
