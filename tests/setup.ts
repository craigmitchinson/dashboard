// ---------------------------------------------------------------------------
// tests/setup.ts
// ---------------------------------------------------------------------------
// Runs once before the test suite. Installs a minimal in-memory Storage
// polyfill on globalThis so src/reference/reference-store.ts's
// loadOverlay/saveOverlay/clearOverlay (which read/write `localStorage`
// directly, guarded by try/catch) can be exercised under plain node — no
// jsdom/happy-dom dependency needed for that. Every other module under test
// is a pure function with no browser-global dependency at all.
//
// Also installs a minimal `window` stub: src/auth/entra-provider.ts reads
// `window.location.origin` at MODULE LOAD (unconditionally, regardless of
// which auth provider is actually active) as its VITE_ENTRA_REDIRECT_URI
// fallback — so any module that imports src/auth/auth-context.tsx (e.g.
// filters-context.tsx, alerts/alerts-context.tsx, both of which read the
// signed-in user's id for per-user persistence/scoping) throws
// "window is not defined" as soon as it's imported under plain node, even
// though nothing in the test ever touches auth. This stub is just enough
// for that module-load-time read to succeed; it is not a browser polyfill.
// ---------------------------------------------------------------------------
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

(globalThis as unknown as { localStorage: Storage }).localStorage = new MemoryStorage();

if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as unknown as { window: { location: { origin: string } } }).window = {
    location: { origin: "http://localhost" },
  };
}
