/**
 * Mock localStorage para ambiente de teste
 * Deve ser importado ANTES de qualquer módulo que use localStorage (como MSW)
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

// Atribuir ao global antes de qualquer import
if (typeof global !== 'undefined') {
  (global as any).localStorage = localStorageMock;
}

if (typeof window !== 'undefined') {
  (window as any).localStorage = localStorageMock;
}

export {};

