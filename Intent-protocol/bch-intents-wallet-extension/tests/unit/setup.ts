// Points the shared package at the stubbed chrome.storage below, as the wallet UI does at start-up.
import '@/lib/core-setup';

/**
 * A chrome.storage that lives in memory, so the modules that persist through it can be tested in Node.
 * `globalThis.__store` exposes the two areas for assertions; `resetChrome()` empties them.
 */
type Area = Record<string, unknown>;
const areas: { local: Area; session: Area } = { local: {}, session: {} };
const listeners = new Set<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>();

function area(name: 'local' | 'session') {
  return {
    async get(keys?: string | string[]) {
      const store = areas[name];
      if (keys === undefined) return { ...store };
      const out: Area = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in store) out[k] = store[k];
      return out;
    },
    async set(items: Area) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) { changes[k] = { oldValue: areas[name][k], newValue: v }; areas[name][k] = v; }
      for (const l of listeners) l(changes, name);
    },
    async remove(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete areas[name][k];
    },
  };
}

(globalThis as any).chrome = {
  storage: {
    local: area('local'),
    session: area('session'),
    onChanged: { addListener: (l: any) => listeners.add(l), removeListener: (l: any) => listeners.delete(l) },
  },
  runtime: { id: 'test', getManifest: () => ({ version: '0.0.0-test' }) },
};
(globalThis as any).__store = areas;
(globalThis as any).resetChrome = () => { areas.local = {}; areas.session = {}; };
