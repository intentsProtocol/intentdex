/**
 * Async wrappers around chrome.storage.local and chrome.storage.session.
 * Drop-in replacement for localStorage / sessionStorage used in the frontend.
 * Always use these — never use localStorage or sessionStorage in the extension.
 */

export const extLocal = {
  async getItem(key: string): Promise<string | null> {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

const sessionMemoryStore: Record<string, string> = {};

export const extSession = {
  async getItem(key: string): Promise<string | null> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        const result = await chrome.storage.session.get(key);
        return result[key] ?? null;
      } catch (e) {
        console.warn('chrome.storage.session.get failed, falling back to memory/local:', e);
      }
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get(`_session_${key}`);
      return result[`_session_${key}`] ?? null;
    }
    return sessionMemoryStore[key] ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        await chrome.storage.session.set({ [key]: value });
        return;
      } catch (e) {
        console.warn('chrome.storage.session.set failed, falling back to memory/local:', e);
      }
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [`_session_${key}`]: value });
    }
    sessionMemoryStore[key] = value;
  },
  async removeItem(key: string): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        await chrome.storage.session.remove(key);
        return;
      } catch (e) {
        console.warn('chrome.storage.session.remove failed, falling back to memory/local:', e);
      }
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.remove(`_session_${key}`);
    }
    delete sessionMemoryStore[key];
  },
};

