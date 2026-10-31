// A stand-in for AsyncStorage: a Map with the same promises.
const map = new Map<string, string>();

export default {
  getItem: async (key: string) => map.get(key) ?? null,
  setItem: async (key: string, value: string) => { map.set(key, value); },
  removeItem: async (key: string) => { map.delete(key); },
  getAllKeys: async () => [...map.keys()],
  multiRemove: async (keys: string[]) => { for (const key of keys) map.delete(key); },
  clear: async () => { map.clear(); },
};
