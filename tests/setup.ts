// ---------------------------------------------------------------------------
// tests/setup.ts
// ---------------------------------------------------------------------------
// Runs once before the test suite. Installs a minimal in-memory Storage
// polyfill on globalThis so src/reference/reference-store.ts's
// loadOverlay/saveOverlay/clearOverlay (which read/write `localStorage`
// directly, guarded by try/catch) can be exercised under plain node — no
// jsdom/happy-dom dependency needed for that. Every other module under test
// is a pure function with no browser-global dependency at all.
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
