/** Browser `localStorage` for node:test: the API client reads its Bearer token from it. */
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
} as Storage;
export {};
