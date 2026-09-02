import { defineConfig } from "vitest/config";

// Node environment (default) — the suite targets pure functions in
// src/reference/economics.ts, src/reference/reference-store.ts and
// src/alerts/* that do not touch the DOM. No jsdom/happy-dom dependency is
// needed: the one module (reference-store.ts) that touches `localStorage`
// only does so inside try/catch'd function bodies, and tests/setup.ts
// installs a minimal in-memory localStorage shim on globalThis for the
// handful of tests that exercise that path directly.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
  },
});
