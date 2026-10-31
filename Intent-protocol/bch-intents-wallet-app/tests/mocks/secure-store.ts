// A stand-in for expo-secure-store. `__store` lets a test look at, or clear, what was written.
export const __store = new Map<string, string>();

export const getItemAsync = async (key: string) => __store.get(key) ?? null;
export const setItemAsync = async (key: string, value: string) => { __store.set(key, value); };
export const deleteItemAsync = async (key: string) => { __store.delete(key); };
