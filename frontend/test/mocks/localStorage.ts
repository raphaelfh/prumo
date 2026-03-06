/**
 * Mock localStorage for test environment
 * Must be imported BEFORE any module that uses localStorage (e.g. MSW)
 */

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => {
      return store[key] || null;
    },
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

// Assign to global before any import
if (typeof global !== 'undefined') {
  (global as any).localStorage = localStorageMock;
}

if (typeof window !== 'undefined') {
  (window as any).localStorage = localStorageMock;
}

export {};

